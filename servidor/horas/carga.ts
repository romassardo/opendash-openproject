import type { Database } from 'better-sqlite3';
import { duracionIso } from '../../compartido/horas.js';
import type { Tramo } from '../../compartido/tipos.js';
import { marcarTokenVencido } from '../auth/clientes.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { REGISTRO_MUDO, type Registro } from '../registro.js';
import { crearCache } from '../sync/cache.js';
import { descartarSinEntrada, guardarEntrada, MOTIVO_TAREA_BORRADA, registrarCarga, tramo } from './repositorio.js';

export interface DepsCarga {
  db: Database;
  ahora: () => Date;
  /** El cliente con el token de esa persona; null si no tiene o está vencido. */
  clientePara: (usuarioId: number) => ClienteOp | null;
  registro?: Registro;
}

const MOTIVO_403 = 'No tenés permiso para cargar horas en ese proyecto (o el proyecto no tiene habilitado el registro de tiempo)';
const MOTIVO_404 = MOTIVO_TAREA_BORRADA;
const MOTIVO_QUITAR = 'No se pudo quitar la carga de la tarea anterior en OpenProject';
const enCarga = new Set<number>();

const comentarioDe = (id: number): string => `OpenDash · tramo ${id}`;

/**
 * Borra una entrada de OpenProject; que ya no exista es lo mismo que borrada. Un rechazo definitivo (permiso,
 * validación) se informa con su propio motivo y no con el del alta; la red y el token se dejan pasar tal cual.
 */
async function borrarEntrada(cliente: ClienteOp, entradaId: number): Promise<void> {
  try {
    await cliente.borrarEntradaTiempo(entradaId);
  } catch (e) {
    if (e instanceof ErrorOp && e.tipo === 'no-encontrado') return;
    if (e instanceof ErrorOp && (e.tipo === 'prohibido' || e.tipo === 'validacion')) throw new ErrorOp('validacion', MOTIVO_QUITAR, e.estadoHttp, { cause: e });
    throw e;
  }
}

/** Una entrada de ese tramo en cualquier tarea del día (la de un alta incierta que quedó en la tarea anterior). */
async function buscarEntradaDelTramo(cliente: ClienteOp, t: Tramo): Promise<number | null> {
  const delDia = await cliente.entradasDeTiempo({ dia: t.dia });
  return delDia.find((e) => e.comentario === comentarioDe(t.id))?.id ?? null;
}

/**
 * Deja la entrada de OpenProject con las horas del tramo, sin duplicar. Devuelve su id. `alConocer` se llama en
 * cuanto se sabe cuál es la entrada (adoptada o creada), para no perderla si lo que sigue falla.
 */
async function sincronizar(cliente: ClienteOp, t: Tramo, horasIso: string, alConocer: (entradaId: number) => void): Promise<number> {
  const filtro = { tareaId: t.tareaId, dia: t.dia };
  let entradaId = t.entradaOpId;
  let existentes = await cliente.entradasDeTiempo(filtro);
  if (entradaId !== null && !existentes.some((e) => e.id === entradaId)) {
    // La entrada quedó en la tarea anterior (o se borró a mano): se saca y se crea de nuevo.
    await borrarEntrada(cliente, entradaId);
    entradaId = null;
    existentes = await cliente.entradasDeTiempo(filtro);
  }
  // Un alta que quizá llegó (incierto) se reconoce por su comentario y se adopta.
  entradaId ??= existentes.find((e) => e.comentario === comentarioDe(t.id))?.id ?? null;
  if (entradaId === null) {
    // Si no está en esta tarea pero sí en otra del mismo día (el tramo se pasó de tarea), se saca de ahí.
    const ajena = await buscarEntradaDelTramo(cliente, t);
    if (ajena !== null) await borrarEntrada(cliente, ajena);
  }
  if (entradaId !== null) {
    alConocer(entradaId);
    await cliente.editarEntradaTiempo(entradaId, horasIso);
    return entradaId;
  }
  const creada = (await cliente.crearEntradaTiempo({ tareaId: t.tareaId, dia: t.dia, horasIso, comentario: comentarioDe(t.id) })).id;
  alConocer(creada);
  return creada;
}

/**
 * Descarta a pedido un tramo que no tiene entrada anotada: antes busca en OpenProject si un alta incierta dejó una
 * (en cualquier tarea del día) y la borra. Si no se puede averiguar, el tramo queda como está para reintentar.
 */
export async function descartarTramoSinEntrada(deps: DepsCarga, id: number): Promise<void> {
  const t = tramo(deps.db, id);
  if (t === null) throw new Error(`No existe el tramo de trabajo ${id}`);
  const cliente = deps.clientePara(t.usuarioId);
  if (cliente === null) return descartarSinEntrada(deps.db, id);
  try {
    const huerfana = await buscarEntradaDelTramo(cliente, t);
    if (huerfana !== null) await borrarEntrada(cliente, huerfana);
    descartarSinEntrada(deps.db, id);
  } catch (e) {
    if (e instanceof ErrorOp && e.tipo === 'no-autorizado') marcarTokenVencido(deps.db, t.usuarioId);
    (deps.registro ?? REGISTRO_MUDO).warn(`[horas] tramo ${id}: no se pudo descartar todavía (${e instanceof ErrorOp ? e.tipo : e instanceof Error ? e.name : 'error'})`);
  }
}

async function releerTarea(deps: DepsCarga, cliente: ClienteOp, tareaId: number, registro: Registro): Promise<void> {
  try {
    // Cargar horas no siempre cambia el updatedAt de la tarea: se guarda como leída ahora.
    crearCache(deps.db, deps.ahora).guardarTareas([await cliente.tarea(tareaId)], { leidaDesde: deps.ahora().toISOString() });
  } catch (e) {
    // La carga ya está hecha; la caché se pone al día en la próxima sincronización.
    registro.warn(`[horas] tarea ${tareaId}: no se pudo releer tras cargar (${e instanceof ErrorOp ? e.tipo : e instanceof Error ? e.name : 'error'})`);
  }
}

/** Carga un tramo cerrado y pendiente. Nunca lanza por OpenProject: lo que no se puede resolver queda pendiente o rechazado. */
export async function cargarTramo(deps: DepsCarga, id: number): Promise<Tramo> {
  const t = tramo(deps.db, id);
  if (t === null) throw new Error(`No existe el tramo de trabajo ${id}`);
  if (t.fin === null || t.estado !== 'pendiente' || t.segundos === null || enCarga.has(id)) return t;
  const descartar = Math.round(t.segundos / 60) < 1;
  // Sin entrada que borrar, un tramo de menos de un minuto se descarta sin tocar OpenProject.
  if (descartar && t.entradaOpId === null) {
    descartarSinEntrada(deps.db, id);
    return tramo(deps.db, id) as Tramo;
  }
  const cliente = deps.clientePara(t.usuarioId);
  if (cliente === null) return t;
  enCarga.add(id);
  const registro = deps.registro ?? REGISTRO_MUDO;
  const datos = { entradaOpId: t.entradaOpId, segundos: t.segundos, tareaId: t.tareaId };
  try {
    if (descartar) {
      // No se da por descartado hasta borrar la entrada; si falla por red queda pendiente y se reintenta.
      await borrarEntrada(cliente, t.entradaOpId as number);
      descartarSinEntrada(deps.db, id);
    } else {
      const entradaOpId = await sincronizar(cliente, t, duracionIso(t.segundos), (entradaId) => guardarEntrada(deps.db, id, entradaId));
      registrarCarga(deps.db, id, { ...datos, entradaOpId, estado: 'cargado', motivo: null });
      await releerTarea(deps, cliente, t.tareaId, registro);
    }
  } catch (e) {
    if (!(e instanceof ErrorOp)) {
      registro.warn(`[horas] tramo ${id}: error inesperado al cargar (${e instanceof Error ? e.name : 'error'})`);
    } else if (e.tipo === 'no-autorizado') {
      marcarTokenVencido(deps.db, t.usuarioId);
    } else if (e.tipo === 'prohibido' || e.tipo === 'no-encontrado' || e.tipo === 'validacion') {
      const motivo = e.tipo === 'prohibido' ? MOTIVO_403 : e.tipo === 'no-encontrado' ? MOTIVO_404 : e.message;
      // La entrada que se alcanzó a conocer queda anotada para que descartar o pasar de tarea la encuentren.
      registrarCarga(deps.db, id, { ...datos, entradaOpId: tramo(deps.db, id)?.entradaOpId ?? datos.entradaOpId, estado: 'rechazado', motivo });
    }
  } finally {
    enCarga.delete(id);
  }
  return tramo(deps.db, id) as Tramo;
}
