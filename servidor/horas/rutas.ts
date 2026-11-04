import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import { hoyArgentina, sumarDias } from '../../compartido/fechas.js';
import { esDiaLaborable } from '../../compartido/horas.js';
import type { EstadoHoras, Tramo } from '../../compartido/tipos.js';
import { leerHoras } from '../ajustes/repositorio.js';
import type { DepsApp } from '../app.js';
import { clientePara } from '../auth/clientes.js';
import { requerirSesion } from '../auth/rutas.js';
import { fechasFeriado } from '../feriados/repositorio.js';
import { PATRON_ID } from '../identificadores.js';
import { crearCache, type CacheOp } from '../sync/cache.js';
import { personasVisibles, tareaVisible } from '../tareas/visibilidad.js';
import { cargarTramo, descartarTramoSinEntrada, type DepsCarga } from './carga.js';
import { aplicarFrenos, cerrarTramos, msVivosDe, totalDelDiaMs } from './reglas.js';
import {
  abiertosDe, abiertosDeTodos, avisosDe, cerradosDelDia, conHorasExtra, corregirSegundos, crearTramo, horasPorDia,
  inicioUltimoPedazo, marcarAvisoVisto, marcarEstado, marcarHorasExtra, pasarATarea, pausarTramo, seguirTramo, tramo,
  ultimoDiaTrabajado, variasALaVez,
} from './repositorio.js';

type DepsHoras = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'sync' | 'registro'>;

const HORA_MS = 3_600_000;
/** Hasta cuántos días atrás se busca el último día trabajado, para «Retomar». */
const DIAS_RETOMAR = 14;
const MSG_INVALIDA = 'Los datos enviados no son válidos';
const MSG_TAREA = 'Solo se puede trabajar en tareas abiertas de tus proyectos';
const MSG_SIN_ESTADO = 'No se pudo comprobar el estado de la tarea (faltan los estados de OpenProject); probá de nuevo en unos minutos';
const esquemaArrancar = z.strictObject({ tareaId: z.number().int().positive() });
const esquemaCorregir = z.union([
  z.strictObject({ segundos: z.number().int().min(60).max(12 * 3600) }),
  z.strictObject({ tareaId: z.number().int().positive() }),
]);
const esquemaInactividad = z.strictObject({ desde: z.string().datetime({ offset: true }), seguia: z.boolean() });
const esquemaDias = z.object({ dias: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(190)) });

function agrupar<T, K>(items: readonly T[], clave: (item: T) => K): Map<K, T[]> {
  const grupos = new Map<K, T[]>();
  for (const item of items) grupos.set(clave(item), [...(grupos.get(clave(item)) ?? []), item]);
  return grupos;
}

type Trabajable = 'si' | 'no' | 'sin-estado';

/** Sin catálogo, o con un estado que no está en él, no se sabe si la tarea está abierta: no se trabaja. */
function tareaTrabajable(cache: CacheOp, usuarioId: number, tareaId: number): Trabajable {
  if (!tareaVisible(cache, new Set(cache.proyectosDe(usuarioId)), tareaId)) return 'no';
  const t = cache.tarea(tareaId);
  const estado = cache.catalogo()?.estados.find((e) => e.id === t?.estadoId);
  if (estado === undefined) return 'sin-estado';
  return estado.cerrado ? 'no' : 'si';
}

export function registrarRutasHoras(app: FastifyInstance, deps: DepsHoras): void {
  const cache = crearCache(deps.db, deps.ahora);
  const sesion = requerirSesion(deps);
  const invalida = (res: FastifyReply, mensaje = MSG_INVALIDA): FastifyReply => res.code(400).send(falla('validacion', mensaje));
  const conflicto = (res: FastifyReply, mensaje: string): FastifyReply => res.code(409).send(falla('conflicto', mensaje));

  const depsCarga: DepsCarga = {
    db: deps.db, ahora: deps.ahora, registro: deps.registro,
    clientePara: (usuarioId) => clientePara({ config: deps.config, db: deps.db, crearCliente: deps.crearCliente, registro: deps.registro }, usuarioId),
  };
  /** Los tramos que se cierran de rebote se cargan antes de responder, para no mostrar un «pendiente» falso; si falla, los toma el servicio. */
  const cargarAparte = async (tramos: readonly Tramo[]): Promise<void> => {
    await Promise.all(tramos.map((t) => cargarTramo(depsCarga, t.id).catch(() => undefined)));
  };

  /** null si se puede trabajar en la tarea; si no, ya respondió el rechazo. */
  const rechazarTarea = (res: FastifyReply, usuarioId: number, tareaId: number): FastifyReply | null => {
    const veredicto = tareaTrabajable(cache, usuarioId, tareaId);
    if (veredicto === 'si') return null;
    return veredicto === 'no' ? invalida(res, MSG_TAREA) : conflicto(res, MSG_SIN_ESTADO);
  };

  const jornadaHoras = (): number => leerHoras(deps.db).jornadaHoras;
  const jornadaMs = (): number => jornadaHoras() * HORA_MS;

  /** Aplica los frenos vencidos y devuelve el momento de la consulta. */
  const alDia = (): { ahora: Date; hoy: string } => {
    const ahora = deps.ahora();
    const hoy = hoyArgentina(ahora);
    // aplicarFrenos conserva el parámetro de feriados por la firma del plan pero no los usa: no se consultan.
    aplicarFrenos(deps.db, ahora, new Set<string>(), jornadaMs());
    return { ahora, hoy };
  };

  const estadoDe = (usuarioId: number, ahora: Date, hoy: string): EstadoHoras => ({
    enMarcha: abiertosDe(deps.db, usuarioId).map((t) => ({ ...t, segundosVivos: Math.round(msVivosDe(deps.db, t, ahora) / 1000) })),
    hoy: cerradosDelDia(deps.db, usuarioId, hoy),
    avisos: avisosDe(deps.db, usuarioId),
    totalHoySegundos: Math.round(totalDelDiaMs(deps.db, usuarioId, hoy, ahora) / 1000),
    jornadaSegundos: jornadaHoras() * 3600,
    variasALaVez: variasALaVez(deps.db, usuarioId),
    horasExtra: conHorasExtra(deps.db, usuarioId, hoy),
    ultimoDia: ultimoDiaTrabajado(deps.db, usuarioId, hoy, sumarDias(hoy, -DIAS_RETOMAR)),
  });

  const propio = (req: FastifyRequest, res: FastifyReply): Tramo | null => {
    const crudo = (req.params as { id: string }).id;
    const t = PATRON_ID.test(crudo) ? tramo(deps.db, Number(crudo)) : null;
    if (t === null || t.usuarioId !== req.usuario!.id) {
      res.code(404).send(falla('no-encontrado', 'No existe ese tramo de trabajo'));
      return null;
    }
    return t;
  };

  /** Termina los tramos abiertos de la persona (por día) cuando arranca otra tarea sin «varias a la vez». */
  const terminarAbiertos = (usuarioId: number, ahora: Date): Tramo[] =>
    [...agrupar(abiertosDe(deps.db, usuarioId), (t) => t.dia)]
      .flatMap(([dia, tramos]) => cerrarTramos(deps.db, usuarioId, dia, tramos.map((t) => t.id), ahora, null, jornadaMs()));

  // Con horas extra confirmadas, el día no se llena.
  const diaLleno = (res: FastifyReply, usuarioId: number, hoy: string, ahora: Date): FastifyReply | null =>
    !conHorasExtra(deps.db, usuarioId, hoy) && totalDelDiaMs(deps.db, usuarioId, hoy, ahora) >= jornadaMs()
      ? conflicto(res, `Ya llegaste a las ${jornadaHoras()} h de hoy`) : null;

  app.get('/api/horas', { preHandler: sesion }, async (req) => {
    const { ahora, hoy } = alDia();
    return exito(estadoDe(req.usuario!.id, ahora, hoy), deps.sync.estado().desactualizado);
  });

  app.post('/api/horas', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaArrancar.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const usuarioId = req.usuario!.id;
    const { tareaId } = cuerpo.data;
    const rechazo = rechazarTarea(res, usuarioId, tareaId);
    if (rechazo !== null) return rechazo;
    const { ahora, hoy } = alDia();
    const feriados = fechasFeriado(deps.db, hoy, hoy);
    if (!esDiaLaborable(hoy, feriados)) return conflicto(res, 'No se cuentan horas los fines de semana ni los feriados');
    if (abiertosDe(deps.db, usuarioId).some((t) => t.tareaId === tareaId)) return conflicto(res, 'Ya estás trabajando en esa tarea');
    const lleno = diaLleno(res, usuarioId, hoy, ahora);
    if (lleno !== null) return lleno;
    try {
      const { nuevo, cerrados } = deps.db.transaction(() => {
        const cerrados = variasALaVez(deps.db, usuarioId) ? [] : terminarAbiertos(usuarioId, ahora);
        return { cerrados, nuevo: crearTramo(deps.db, usuarioId, tareaId, hoy, ahora) };
      })();
      await cargarAparte(cerrados);
      return exito(nuevo);
    } catch (e) {
      // El índice único parcial es la última barrera si dos pedidos llegan a la vez.
      if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return conflicto(res, 'Ya estás trabajando en esa tarea');
      throw e;
    }
  });

  const sobreAbierto = (ruta: string, aplicar: (t: Tramo, ahora: Date, hoy: string, res: FastifyReply) => Tramo | FastifyReply | Promise<Tramo | FastifyReply>): void => {
    app.post(`/api/horas/:id/${ruta}`, { preHandler: sesion }, async (req, res) => {
      const { ahora, hoy } = alDia();
      const t = propio(req, res);
      if (t === null) return res;
      const actual = tramo(deps.db, t.id) as Tramo;
      if (actual.fin !== null) return conflicto(res, 'Ese tramo ya terminó');
      const resultado = await aplicar(actual, ahora, hoy, res);
      return 'tareaId' in resultado ? exito(resultado) : resultado;
    });
  };
  sobreAbierto('pausa', (t, ahora) => {
    pausarTramo(deps.db, t.id, ahora);
    return tramo(deps.db, t.id) as Tramo;
  });
  sobreAbierto('seguir', async (t, ahora, hoy, res) => {
    if (!t.pausado) return t;
    const lleno = diaLleno(res, t.usuarioId, hoy, ahora);
    if (lleno !== null) return lleno;
    const { cerrados, seguido } = deps.db.transaction(() => {
      const cerrados = variasALaVez(deps.db, t.usuarioId) ? [] : [...agrupar(abiertosDe(deps.db, t.usuarioId).filter((o) => o.id !== t.id), (o) => o.dia)]
        .flatMap(([dia, otros]) => cerrarTramos(deps.db, t.usuarioId, dia, otros.map((o) => o.id), ahora, null, jornadaMs()));
      seguirTramo(deps.db, t.id, ahora);
      return { cerrados, seguido: tramo(deps.db, t.id) as Tramo };
    })();
    await cargarAparte(cerrados);
    return seguido;
  });
  // Al terminar se carga en el momento: la respuesta ya trae el estado de la carga.
  sobreAbierto('terminar', (t, ahora) => cargarTramo(depsCarga, (cerrarTramos(deps.db, t.usuarioId, t.dia, [t.id], ahora, null, jornadaMs())[0] as Tramo).id));

  app.patch('/api/horas/:id', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaCorregir.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const { ahora } = alDia();
    const t = propio(req, res);
    if (t === null) return res;
    const actual = tramo(deps.db, t.id) as Tramo;
    if (actual.fin === null) return conflicto(res, 'Terminá el tramo antes de corregirlo');
    if (actual.estado === 'descartado') return conflicto(res, 'Ese tramo se descartó');
    const datos = cuerpo.data;
    if ('segundos' in datos) {
      const nuevoDia = totalDelDiaMs(deps.db, actual.usuarioId, actual.dia, ahora) - (actual.segundos ?? 0) * 1000 + datos.segundos * 1000;
      if (!conHorasExtra(deps.db, actual.usuarioId, actual.dia) && nuevoDia > jornadaMs()) return invalida(res, `El día no puede pasar las ${jornadaHoras()} h`);
      corregirSegundos(deps.db, actual.id, datos.segundos);
    } else {
      const rechazo = rechazarTarea(res, actual.usuarioId, datos.tareaId);
      if (rechazo !== null) return rechazo;
      pasarATarea(deps.db, actual.id, datos.tareaId);
    }
    return exito(await cargarTramo(depsCarga, actual.id));
  });

  const sobreCerrado = (ruta: string, estados: readonly string[], aplicar: (t: Tramo) => void | Promise<void>): void => {
    app.post(`/api/horas/:id/${ruta}`, { preHandler: sesion }, async (req, res) => {
      const t = propio(req, res);
      if (t === null) return res;
      if (t.fin === null || !estados.includes(t.estado)) return conflicto(res, 'Esa acción no se puede hacer con este tramo');
      await aplicar(t);
      return exito(tramo(deps.db, t.id));
    });
  };
  // Con entrada en OpenProject no se descarta hasta borrarla: queda en 0 s pendiente y cargarTramo la borra (o reintenta).
  sobreCerrado('descartar', ['pendiente', 'rechazado'], async (t) => {
    if (t.entradaOpId === null) return descartarTramoSinEntrada(depsCarga, t.id);
    corregirSegundos(deps.db, t.id, 0);
    await cargarTramo(depsCarga, t.id);
  });
  sobreCerrado('reintentar', ['pendiente', 'rechazado'], async (t) => {
    marcarEstado(deps.db, t.id, 'pendiente');
    await cargarTramo(depsCarga, t.id);
  });
  sobreCerrado('aviso-visto', ['pendiente', 'cargado', 'rechazado'], (t) => marcarAvisoVisto(deps.db, t.id));

  // «Seguir con horas extra»: hoy el tope deja de frenar y de bloquear. Lo frenado por el tope se retoma aparte.
  app.post('/api/horas/extra', { preHandler: sesion }, async (req, res) => {
    const { ahora, hoy } = alDia();
    const usuarioId = req.usuario!.id;
    if (!esDiaLaborable(hoy, fechasFeriado(deps.db, hoy, hoy))) return conflicto(res, 'No se cuentan horas los fines de semana ni los feriados');
    marcarHorasExtra(deps.db, usuarioId, hoy, ahora);
    return exito(estadoDe(usuarioId, ahora, hoy));
  });

  app.post('/api/horas/inactividad', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaInactividad.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const { ahora, hoy } = alDia();
    const usuarioId = req.usuario!.id;
    if (!cuerpo.data.seguia) {
      const desde = Date.parse(cuerpo.data.desde);
      // Cada tramo corta en el máximo entre el aviso y el arranque de su último pedazo: uno retomado después no suma nada.
      const cerrados: Tramo[] = [];
      // Un tramo en pausa no estaba contando: sigue abierto para que ▶ lo retome.
      for (const t of abiertosDe(deps.db, usuarioId).filter((a) => !a.pausado)) {
        const ultimoInicio = Date.parse(inicioUltimoPedazo(deps.db, t.id) ?? t.inicio);
        const fin = new Date(Math.min(ahora.getTime(), Math.max(desde, ultimoInicio)));
        cerrados.push(...cerrarTramos(deps.db, usuarioId, t.dia, [t.id], fin, null, jornadaMs()));
      }
      await cargarAparte(cerrados);
    }
    return exito(estadoDe(usuarioId, ahora, hoy));
  });

  app.get('/api/horas/equipo', { preHandler: sesion }, async (req, res) => {
    const consulta = esquemaDias.safeParse(req.query);
    if (!consulta.success) return invalida(res);
    const { ahora, hoy } = alDia();
    const usuarioId = req.usuario!.id;
    const personas = personasVisibles(cache, usuarioId);
    const proyectos = new Set(cache.proyectosDe(usuarioId));
    const dias = horasPorDia(deps.db, [...personas], sumarDias(hoy, 1 - consulta.data.dias), ahora);
    const corriendo = abiertosDeTodos(deps.db).filter((t) => personas.has(t.usuarioId) && !t.pausado);
    const enMarcha = [...agrupar(corriendo, (t) => t.usuarioId)].map(([id, tramos]) => ({
      usuarioId: id,
      // No se revela en qué tarea trabaja alguien si esta persona no la ve.
      tareaIds: tramos.map((t) => t.tareaId).filter((tarea) => tareaVisible(cache, proyectos, tarea)),
    }));
    return exito({ dias, enMarcha }, deps.sync.estado().desactualizado);
  });
}
