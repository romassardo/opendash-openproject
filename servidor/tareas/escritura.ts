import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import { columnaDeEstado, estadoDeColumna, mensajeFaltaEstado, versionParaColumna } from '../../compartido/columnas.js';
import { hoyArgentina } from '../../compartido/fechas.js';
import type { Actividad, CambiosTarea, CatalogoOp, MotivoSinReleer, NuevaTarea, RespuestaComentario, ResumenBorrado, Tarea } from '../../compartido/tipos.js';
import type { DepsApp } from '../app.js';
import { leerTablero } from '../ajustes/repositorio.js';
import { clientePara, marcarTokenVencido } from '../auth/clientes.js';
import { PATRON_ID } from '../identificadores.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { responderError, responderTokenVencido } from '../errores.js';
import { ErrorOp } from '../openproject/errores.js';
import { contarComentarios } from '../openproject/historial.js';
import type { CacheOp } from '../sync/cache.js';
import { abiertosDeTodos, rechazarPorTareaBorrada } from '../horas/repositorio.js';
import { registrarRutasPausas } from './pausas.js';
import { borrarPausasDe } from './pausas-repositorio.js';
import { buscarComentario, buscarDependencia, buscarTareaCreada } from './recuperacion.js';

type DepsEscritura = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'sync' | 'registro'>;

export interface AyudasEscritura {
  cache: CacheOp;
  sesion: preHandlerAsyncHookHandler;
  /** Guarda la tarea que devolvió OpenProject en la caché y la devuelve saneada para quien actuó. */
  guardarEscrita: (tarea: Tarea, usuarioId: number, leidaDesde?: string) => Tarea;
  desactualizado: () => boolean;
}

const MSG_SIN_CATALOGO = 'Todavía se están cargando los datos de OpenProject; probá en un momento.';
const MSG_AUTO_ESPERA = 'Una tarea no puede esperarse a sí misma';
const MSG_CIRCULO = 'Esa dependencia formaría un círculo entre tareas.';
const MSG_INVALIDA = 'La solicitud no es válida';
const MSG_YA_NO_EXISTE = 'Esa tarea ya no existe en OpenProject';
const MSG_NO_ENCONTRADA = 'No encontramos esa tarea';
export const MSG_SOLO_QUIEN_LA_CREO = 'Solo quien creó la tarea la puede borrar.';
export const MSG_SUBTAREAS_AJENAS = 'No se puede borrar: tiene subtareas que creó otra persona.';
export const MSG_OP_NO_DEJA_BORRAR = 'Tu rol en OpenProject no permite borrar tareas en este proyecto.';
/** Pedidos de adjuntos a OpenProject a la vez al contar los de una tarea y sus subtareas. */
const CONCURRENCIA_ADJUNTOS = 4;
// Margen hacia atrás al buscar un alta incierta: cubre la diferencia de relojes con OpenProject.
const MARGEN_BUSQUEDA_MS = 2 * 60_000;
/** Lo máximo que un guardado de fechas espera al refresco de lo que OpenProject reprogramó; después responde y el refresco sigue solo. */
export const ESPERA_REFRESCO_MS = 3000;

const entero = z.number().int().positive();
const lockVersion = z.number().int().nonnegative();
const titulo = z.string().trim().min(1).max(255);

// 'YYYY-MM-DD' que además exista en el calendario.
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
});

const esquemaCambios = z.strictObject({
  titulo: titulo.optional(),
  descripcion: z.string().optional(),
  estadoId: entero.optional(),
  prioridadId: entero.optional(),
  responsableId: entero.nullable().optional(),
  inicio: fecha.nullable().optional(),
  fin: fecha.nullable().optional(),
  fecha: fecha.nullable().optional(),
  estimacionHoras: z.number().finite().nonnegative().nullable().optional(),
  restanteHoras: z.number().finite().nonnegative().nullable().optional(),
  madreId: entero.nullable().optional(),
  versionId: entero.nullable().optional(),
  proyectoId: entero.optional(),
  programacionManual: z.boolean().optional(),
  duracionDias: z.number().int().positive().max(3650).optional(),
});
const esquemaPatch = z.strictObject({ lockVersion, cambios: esquemaCambios });
const esquemaMover = z.strictObject({ lockVersion, columna: z.enum(['nuevo', 'curso', 'pausa', 'cerrado']) });
const esquemaNueva = z.strictObject({
  titulo,
  proyectoId: entero,
  tipoId: entero.optional(),
  estadoId: entero.optional(),
  responsableId: entero.nullable().optional(),
  madreId: entero.nullable().optional(),
  inicio: fecha.nullable().optional(),
  fin: fecha.nullable().optional(),
  programacionManual: z.boolean().optional(),
}).refine((n) => n.inicio == null || n.fin == null || n.inicio <= n.fin);
const esquemaComentario = z.strictObject({ texto: z.string().trim().min(1).max(10000) });
const esquemaDependencia = z.strictObject({ esperaA: entero, retraso: z.number().int().min(-365).max(365).optional() });

const MSG_SIN_TIPO = 'OpenProject no tiene un tipo de tarea disponible para crearla.';

// Tipo por defecto de una tarea nueva: «Task»; si no existe, el primero que no sea hito.
/** Por qué no se pudo releer: lo que la persona puede hacer al respecto depende del motivo. */
function motivoSinReleer(e: unknown): MotivoSinReleer {
  if (!(e instanceof ErrorOp)) return 'sin-conexion';
  if (e.tipo === 'no-autorizado') return 'token-vencido';
  if (e.tipo === 'prohibido' || e.tipo === 'no-encontrado') return 'sin-acceso';
  return 'sin-conexion';
}

function tipoPorDefecto(catalogo: CatalogoOp): number | null {
  const tipo = catalogo.tipos.find((t) => t.nombre === 'Task') ?? catalogo.tipos.find((t) => !t.esHito);
  return tipo?.id ?? null;
}

/**
 * Fechas que se escriben al cerrar una tarea: el fin pasa a ser el día del cierre (y el inicio también, si
 * empezaba después). Los hitos y las tareas con subtareas no se tocan: sus fechas son un evento o salen de las hijas.
 * Null si no hay nada que cambiar.
 */
export function fechasAlCerrar(tarea: Pick<Tarea, 'inicio' | 'fin'>, hoy: string, esHito: boolean, tieneHijas: boolean): Pick<CambiosTarea, 'inicio' | 'fin'> | null {
  if (esHito || tieneHijas) return null;
  const correInicio = tarea.inicio !== null && tarea.inicio > hoy;
  if (tarea.fin === hoy && !correInicio) return null;
  return correInicio ? { inicio: hoy, fin: hoy } : { fin: hoy };
}
type ExtrasCierre = Pick<CambiosTarea, 'inicio' | 'fin' | 'restanteHoras'>;
/**
 * Lo que OpenProject rechazó de lo que se suma al cerrar (una sucesora automática no arranca antes de su predecesora):
 * lo de antes sin esa parte, para cerrar igual; null si el rechazo no era de eso.
 */
function sinRechazado(extras: ExtrasCierre, e: unknown): ExtrasCierre | null {
  if (!(e instanceof ErrorOp && e.tipo === 'validacion')) return null;
  const fechas = e.atributos.some((a) => a === 'startDate' || a === 'dueDate' || a === 'date') && ('inicio' in extras || 'fin' in extras);
  const restante = e.atributos.some((a) => a === 'remainingTime' || a === 'remainingHours') && 'restanteHoras' in extras;
  if (!fechas && !restante) return null;
  const { inicio, fin, restanteHoras } = extras;
  return {
    ...(!fechas && inicio !== undefined && { inicio }), ...(!fechas && fin !== undefined && { fin }),
    ...(!restante && restanteHoras !== undefined && { restanteHoras }),
  };
}

export function registrarRutasEscritura(app: FastifyInstance, deps: DepsEscritura, ayudas: AyudasEscritura): void {
  const { cache, sesion, guardarEscrita, desactualizado } = ayudas;

  const invalido = (res: FastifyReply, mensaje = MSG_INVALIDA): FastifyReply =>
    res.code(400).send(falla('validacion', mensaje));
  const sinCatalogo = (res: FastifyReply): FastifyReply => res.code(503).send(falla('sin-conexion', MSG_SIN_CATALOGO));

  // Id de la ruta ya validado, o null tras responder 400.
  const idDe = (req: FastifyRequest, res: FastifyReply): number | null => {
    const crudo = (req.params as { id: string }).id;
    if (PATRON_ID.test(crudo)) return Number(crudo);
    invalido(res, 'El identificador no es válido');
    return null;
  };

  // Cliente con el token de quien actúa, o null tras responder 401.
  const clienteDe = (req: FastifyRequest, res: FastifyReply): ClienteOp | null => {
    const cliente = clientePara(deps, req.usuario!.id);
    if (cliente === null) responderTokenVencido(res);
    return cliente;
  };

  // Ante un conflicto se relee la tarea (mejor esfuerzo, con el token de quien actúa) y se guarda en la
  // caché: así la lista que la web vuelve a pedir ya trae el lockVersion nuevo. Si falla, el 409 sale igual.
  const releerTrasConflicto = async (req: FastifyRequest, cliente: ClienteOp, id: number, e: unknown): Promise<void> => {
    if (!(e instanceof ErrorOp && e.tipo === 'conflicto')) return;
    try {
      // La relectura es la verdad de OpenProject: entra aunque su lockVersion sea menor (base restaurada),
      // salvo que la caché se haya escrito después de empezar a leer.
      const leidaDesde = deps.ahora().toISOString();
      guardarEscrita(await cliente.tarea(id), req.usuario!.id, leidaDesde);
    } catch (fallo) {
      req.log.warn({ motivo: fallo instanceof ErrorOp ? fallo.tipo : 'interno' }, 'no se pudo releer la tarea tras un conflicto');
    }
  };

  // Al crear un «follows», OpenProject pasa la sucesora a automática y la corre: se relee (mejor esfuerzo) para que
  // la lista que pide la web traiga su lockVersion y sus fechas nuevas. Si falla, la dependencia ya existe y se responde igual.
  const releerSucesora = async (req: FastifyRequest, cliente: ClienteOp, id: number, usuarioId: number): Promise<void> => {
    try {
      guardarEscrita(await cliente.tarea(id), usuarioId, deps.ahora().toISOString());
    } catch (fallo) {
      req.log.warn({ motivo: fallo instanceof ErrorOp ? fallo.tipo : 'interno' }, 'no se pudo releer la sucesora tras crear la dependencia');
    }
  };

  // Si el alta quedó incierta, pregunta a OpenProject si llegó a guardarse. Devuelve lo hallado, o null si no
  // está o si no se pudo preguntar (en ambos casos se responde `resultado-incierto`).
  const confirmarAlta = async <T>(req: FastifyRequest, e: unknown, buscar: () => Promise<T | null>): Promise<T | null> => {
    if (!(e instanceof ErrorOp && e.tipo === 'incierto')) return null;
    try {
      return await buscar();
    } catch (fallo) {
      req.log.warn({ motivo: fallo instanceof ErrorOp ? fallo.tipo : 'interno' }, 'no se pudo confirmar un alta incierta');
      return null;
    }
  };
  const desdeBusqueda = (): string => new Date(deps.ahora().getTime() - MARGEN_BUSQUEDA_MS).toISOString();

  // OpenProject corre solo a las sucesoras en programación automática al mover una predecesora: se trae lo que
  // reprogramó antes de responder, así la línea ya las muestra movidas. Si falla, el guardado sigue valiendo.
  const traerReprogramadas = async (req: FastifyRequest, usuarioId: number): Promise<void> => {
    const refresco = (async () => {
      try {
        await deps.sync.refrescoIncremental(usuarioId);
      } catch (fallo) {
        req.log.warn({ motivo: fallo instanceof ErrorOp ? fallo.tipo : 'interno' }, 'no se pudo traer lo que OpenProject reprogramó tras guardar fechas');
      }
    })();
    // Con un tope: si el refresco tarda (por ejemplo, detrás de una carga completa), se responde igual y él sigue solo.
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const tope = new Promise<void>((resolver) => { temporizador = setTimeout(resolver, ESPERA_REFRESCO_MS); });
    try {
      await Promise.race([refresco, tope]);
    } finally {
      clearTimeout(temporizador);
    }
  };
  const tocaFechas = (cambios: object): boolean => 'inicio' in cambios || 'fin' in cambios || 'fecha' in cambios;

  /** La tarea está en la caché y en un proyecto que la persona ve (si no, OpenProject también puede dar 404 por permisos). */
  const tareaVisible = (id: number, usuarioId: number): boolean => {
    const t = cache.tarea(id);
    return t !== null && cache.proyectosDe(usuarioId).includes(t.proyectoId);
  };

  // Propia = la creó esta persona (usuarios.id es el id de OpenProject). Sin autor conocido no es de nadie.
  const esPropia = (id: number, usuarioId: number): boolean => cache.tarea(id)?.autorId === usuarioId;
  const ajenasDe = (ids: number[], usuarioId: number): number => ids.filter((x) => !esPropia(x, usuarioId)).length;
  const motivoAjena = (id: number): string => {
    const autor = cache.tarea(id)?.autorId ?? null;
    const nombre = autor === null ? undefined : cache.catalogo()?.personas.find((p) => p.id === autor)?.nombre;
    return nombre === undefined ? MSG_SOLO_QUIEN_LA_CREO : `Solo quien creó la tarea la puede borrar, y esta la creó ${nombre}.`;
  };
  // Las tareas de afuera que esperan a alguna de `ids`.
  const sucesorasDe = (ids: number[]): number[] => {
    const conjunto = new Set(ids);
    return [...new Set(cache.dependencias().filter((d) => conjunto.has(d.predecesoraId) && !conjunto.has(d.sucesoraId)).map((d) => d.sucesoraId))];
  };

  // La tarea con todos sus descendientes que la caché conoce, aunque estén en otro proyecto.
  const conDescendientes = (id: number): number[] => {
    const todas = cache.tareas((cache.catalogo()?.proyectos ?? []).map((p) => p.id));
    const ids = new Set([id]);
    for (let creció = true; creció;) {
      creció = false;
      for (const t of todas) {
        if (t.madreId !== null && ids.has(t.madreId) && !ids.has(t.id)) { ids.add(t.id); creció = true; }
      }
    }
    return [...ids];
  };

  // Nombre de quien tiene un tramo abierto en alguna de esas tareas, o null.
  const quienTrabaja = (ids: number[]): string | null => {
    const abierto = abiertosDeTodos(deps.db).find((t) => ids.includes(t.tareaId));
    if (abierto === undefined) return null;
    const nombre = deps.db.prepare('select nombre from usuarios where id = ?').pluck().get(abierto.usuarioId) as string | undefined;
    return nombre ?? 'Alguien';
  };

  /** Cuenta los adjuntos de esas tareas con pocos pedidos a la vez. */
  const contarAdjuntos = async (cliente: ClienteOp, ids: number[]): Promise<number> => {
    let total = 0;
    let siguiente = 0;
    const trabajador = async (): Promise<void> => {
      while (siguiente < ids.length) {
        const lista = await cliente.adjuntos(ids[siguiente++]!);
        total += lista.length;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_ADJUNTOS, ids.length) }, trabajador));
    return total;
  };

  // Con `?sinAdjuntos=1` solo se responde el permiso y lo barato (para mostrar el «⋯»); el conteo se pide al abrir el diálogo.
  app.get('/api/tareas/:id/borrado', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return res;
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    const usuarioId = req.usuario!.id;
    if (!tareaVisible(id, usuarioId)) return res.code(404).send(falla('no-encontrado', MSG_NO_ENCONTRADA));
    const sinAdjuntos = (req.query as { sinAdjuntos?: unknown }).sinAdjuntos === '1';
    try {
      const ids = conDescendientes(id);
      // Solo quien la creó: el permiso de OpenProject va por rol y alcanza a las tareas de todos.
      const propia = esPropia(id, usuarioId);
      const puede = propia && await cliente.puedeBorrarTarea(id);
      const motivo = puede ? null : propia ? MSG_OP_NO_DEJA_BORRAR : motivoAjena(id);
      // Sin permiso no hace falta contar adjuntos: el resumen solo sirve para explicar por qué no.
      const adjuntos = puede && !sinAdjuntos ? await contarAdjuntos(cliente, ids) : 0;
      // `horasReales` de OpenProject ya suma a las descendientes: sumar las de cada una las contaría dos veces.
      const horas = cache.tarea(id)?.horasReales ?? 0;
      const resumen: ResumenBorrado = {
        puede, subtareas: ids.length - 1, horas: Math.round(horas * 100) / 100,
        adjuntos, trabajando: quienTrabaja(ids), ajenas: ajenasDe(ids, usuarioId),
        sucesoras: sucesorasDe(ids).map((s) => cache.tarea(s)?.titulo ?? `Tarea ${s}`), motivo,
      };
      return exito(resumen, desactualizado());
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.delete('/api/tareas/:id', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return res;
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    const usuarioId = req.usuario!.id;
    // Un 404 de OpenProject también es «no la ves»: sin esto, cualquiera podría limpiar la caché y las horas de proyectos ajenos.
    if (!tareaVisible(id, usuarioId)) return res.code(404).send(falla('no-encontrado', MSG_NO_ENCONTRADA));
    if (!esPropia(id, usuarioId)) return res.code(403).send(falla('prohibido', MSG_SOLO_QUIEN_LA_CREO));
    const ids = conDescendientes(id);
    if (ajenasDe(ids, usuarioId) > 0) return res.code(409).send(falla('conflicto', MSG_SUBTAREAS_AJENAS));
    const trabajando = quienTrabaja(ids);
    if (trabajando !== null) return res.code(409).send(falla('conflicto', `${trabajando} está trabajando en esta tarea ahora`));
    // Las que esperaban a alguna de las borradas: OpenProject las pasa a manual y les cambia el lockVersion.
    const sucesoras = sucesorasDe(ids);
    let yaNoEstaba = false;
    try {
      await cliente.borrarTarea(id);
    } catch (e) {
      // Si ya no estaba en OpenProject, igual se limpia la caché; los tramos no se tocan (quien la borró ya los rechazó).
      if (!(e instanceof ErrorOp && e.tipo === 'no-encontrado')) return responderError(res, e, { db: deps.db, usuarioId });
      yaNoEstaba = true;
    }
    cache.quitarTareas(ids);
    borrarPausasDe(deps.db, ids);
    if (!yaNoEstaba) rechazarPorTareaBorrada(deps.db, ids);
    for (const sucesora of sucesoras) await releerSucesora(req, cliente, sucesora, usuarioId);
    return res.code(204).send();
  });

  // Un guardado contra una tarea que otra persona ya borró: se saca de la caché y se dice que ya no existe.
  // Solo si la persona ve el proyecto: si no, el 404 puede ser de permisos y no hay que tocar lo compartido.
  const siYaNoExiste = (res: FastifyReply, e: unknown, id: number, usuarioId: number): FastifyReply | null => {
    if (!(e instanceof ErrorOp && e.tipo === 'no-encontrado')) return null;
    if (tareaVisible(id, usuarioId)) {
      const ids = conDescendientes(id);
      cache.quitarTareas(ids);
      rechazarPorTareaBorrada(deps.db, ids);
    }
    return res.code(404).send(falla('no-encontrado', MSG_YA_NO_EXISTE));
  };

  registrarRutasPausas(app, deps, {
    cache, sesion, guardarEscrita, desactualizado, idDe, clienteDe, tareaVisible, conDescendientes, traerReprogramadas, siYaNoExiste,
  });

  app.patch('/api/tareas/:id', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return res;
    const cuerpo = esquemaPatch.safeParse(req.body);
    if (!cuerpo.success || Object.keys(cuerpo.data.cambios).length === 0) return invalido(res);
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    const usuarioId = req.usuario!.id;
    try {
      const tarea = await cliente.actualizarTarea(id, cuerpo.data.lockVersion, cuerpo.data.cambios as CambiosTarea);
      const guardada = guardarEscrita(tarea, usuarioId);
      if (tocaFechas(cuerpo.data.cambios)) await traerReprogramadas(req, usuarioId);
      return exito(guardada, desactualizado());
    } catch (e) {
      const borrada = siYaNoExiste(res, e, id, usuarioId);
      if (borrada !== null) return borrada;
      await releerTrasConflicto(req, cliente, id, e);
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.post('/api/tareas/:id/mover', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return res;
    const cuerpo = esquemaMover.safeParse(req.body);
    if (!cuerpo.success) return invalido(res);
    const catalogo = cache.catalogo();
    if (catalogo === null) return sinCatalogo(res);
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    const usuarioId = req.usuario!.id;
    const { lockVersion: lock, columna } = cuerpo.data;
    try {
      const actual = cache.tarea(id) ?? await cliente.tarea(id);
      const estado = estadoDeColumna(columna, catalogo.estados, leerTablero(deps.db));
      if (estado === null) return res.code(422).send(falla('validacion', mensajeFaltaEstado(columna)));
      const version = versionParaColumna(columna, catalogo.versiones.filter((v) => v.proyectoId === actual.proyectoId));
      // Sin versión que aplicar no se manda `versionId`: mandar null borraría la versión de la tarea.
      const cambios: CambiosTarea = version === null ? { estadoId: estado.id } : { estadoId: estado.id, versionId: version.id };
      const yaCerrada = catalogo.estados.some((e) => e.id === actual.estadoId && e.cerrado);
      const esHito = catalogo.tipos.some((t) => t.id === actual.tipoId && t.esHito);
      const cierra = estado.cerrado && !yaCerrada;
      // Al cerrar no queda trabajo pendiente: sin esto OpenProject la muestra cerrada con su % completado en 0.
      let extras: ExtrasCierre = !cierra ? {} : {
        ...fechasAlCerrar(actual, hoyArgentina(deps.ahora()), esHito, conDescendientes(id).length > 1),
        ...((actual.restanteHoras ?? 0) > 0 && { restanteHoras: 0 }),
      };
      let tarea: Tarea;
      for (;;) {
        try {
          tarea = await cliente.actualizarTarea(id, lock, { ...cambios, ...extras });
          break;
        } catch (e) {
          const menos = sinRechazado(extras, e);
          if (menos === null) throw e;
          extras = menos;
        }
      }
      const guardada = guardarEscrita(tarea, usuarioId);
      // Al correr el fin, OpenProject corre a las sucesoras automáticas.
      if (extras.fin !== undefined && tarea.fin === extras.fin) await traerReprogramadas(req, usuarioId);
      return exito(guardada, desactualizado());
    } catch (e) {
      if (e instanceof ErrorOp && e.tipo === 'validacion') {
        // Solo un 422 que habla del estado es una transición rechazada; el resto (versión, fecha…) es validación.
        const deTransicion = e.estadoHttp === 422 && /estado|status/i.test(e.message);
        return res.code(422).send(falla(deTransicion ? 'transicion-no-permitida' : 'validacion', e.message, e.atributos));
      }
      const borrada = siYaNoExiste(res, e, id, usuarioId);
      if (borrada !== null) return borrada;
      await releerTrasConflicto(req, cliente, id, e);
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.post('/api/tareas', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaNueva.safeParse(req.body);
    if (!cuerpo.success) return invalido(res);
    const catalogo = cache.catalogo();
    if (catalogo === null) return sinCatalogo(res);
    const tipoId = cuerpo.data.tipoId ?? tipoPorDefecto(catalogo);
    if (tipoId === null) return res.code(422).send(falla('validacion', MSG_SIN_TIPO));
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    const usuarioId = req.usuario!.id;
    const desde = desdeBusqueda();
    // Crear directamente en una columna aplica la versión que le corresponde, igual que al moverla.
    const tablero = leerTablero(deps.db);
    const estado = catalogo.estados.find((e) => e.id === cuerpo.data.estadoId);
    const version = estado === undefined ? null
      : versionParaColumna(columnaDeEstado(estado, tablero), catalogo.versiones.filter((v) => v.proyectoId === cuerpo.data.proyectoId));
    const nueva: NuevaTarea = { ...cuerpo.data, tipoId, ...(version === null ? {} : { versionId: version.id }) };
    // Una hija con fechas estira a su madre automática: se trae lo que OpenProject reprogramó, como al guardar fechas.
    const estiraMadre = nueva.madreId != null && (nueva.inicio != null || nueva.fin != null);
    try {
      const tarea = await cliente.crearTarea(nueva);
      const guardada = guardarEscrita(tarea, usuarioId);
      if (estiraMadre) await traerReprogramadas(req, usuarioId);
      return exito(guardada, desactualizado());
    } catch (e) {
      const hallada = await confirmarAlta(req, e, () => buscarTareaCreada(cliente, nueva, usuarioId, desde));
      if (hallada !== null) return exito(guardarEscrita(hallada, usuarioId), desactualizado());
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.post('/api/tareas/:id/comentarios', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return res;
    const cuerpo = esquemaComentario.safeParse(req.body);
    if (!cuerpo.success) return invalido(res);
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    const usuarioId = req.usuario!.id;
    const desde = desdeBusqueda();
    try {
      await cliente.comentar(id, cuerpo.data.texto);
    } catch (e) {
      const estaba = await confirmarAlta(req, e, async () => (await buscarComentario(cliente, id, usuarioId, cuerpo.data.texto, desde)) || null);
      if (estaba !== true) return responderError(res, e, { db: deps.db, usuarioId });
    }
    // El comentario ya quedó en OpenProject: si falla releer (por lo que sea) no se informa como error,
    // porque un reintento lo duplicaría. Un token rechazado igual queda marcado como vencido.
    try {
      const actividades: Actividad[] = await cliente.actividades(id);
      if (cache.tarea(id) !== null) cache.guardarComentarios(id, contarComentarios(actividades));
      const respuesta: RespuestaComentario = { actividades, sinReleer: null };
      return exito(respuesta, desactualizado());
    } catch (e) {
      if (e instanceof ErrorOp && e.tipo === 'no-autorizado') marcarTokenVencido(deps.db, usuarioId);
      req.log.warn({ motivo: e instanceof ErrorOp ? e.tipo : 'interno' }, 'comentario guardado sin poder releer las actividades');
      const respuesta: RespuestaComentario = { actividades: [], sinReleer: motivoSinReleer(e) };
      return exito(respuesta, true);
    }
  });

  app.post('/api/tareas/:id/dependencias', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return res;
    const cuerpo = esquemaDependencia.safeParse(req.body);
    if (!cuerpo.success) return invalido(res);
    if (cuerpo.data.esperaA === id) return invalido(res, MSG_AUTO_ESPERA);
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    const usuarioId = req.usuario!.id;
    try {
      const dependencia = await cliente.crearDependencia(id, cuerpo.data.esperaA, cuerpo.data.retraso);
      cache.agregarDependencia(dependencia);
      await releerSucesora(req, cliente, id, usuarioId);
      return exito(dependencia, desactualizado());
    } catch (e) {
      const existente = await confirmarAlta(req, e, () => buscarDependencia(cliente, id, cuerpo.data.esperaA));
      if (existente !== null) {
        cache.agregarDependencia(existente);
        await releerSucesora(req, cliente, id, usuarioId);
        return exito(existente, desactualizado());
      }
      if (e instanceof ErrorOp && e.tipo === 'validacion' && e.estadoHttp === 422) {
        return invalido(res, /circular/i.test(e.message) ? MSG_CIRCULO : `OpenProject no permitió esa dependencia: ${e.message}`);
      }
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.delete('/api/dependencias/:id', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return res;
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    const usuarioId = req.usuario!.id;
    try {
      await cliente.borrarDependencia(id);
      cache.quitarDependencia(id);
      return exito(null, desactualizado());
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });
}
