import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import { calendarioDe, habilesEntre } from '../../compartido/calendarioOp.js';
import {
  finConPausa, finSinPausa, MAX_DIAS_PAUSA, motivoPausaInvalida, motivoSinPausa, type Pausa, type PausasPorTarea,
} from '../../compartido/pausas.js';
import type { CambiosTarea, CatalogoOp, Tarea } from '../../compartido/tipos.js';
import type { DepsApp } from '../app.js';
import { responderError } from '../errores.js';
import type { ClienteOp } from '../openproject/cliente.js';
import type { CacheOp } from '../sync/cache.js';
import { borrarPausa, guardarPausa, pausa as leerPausa, pausasDe, todasLasPausas } from './pausas-repositorio.js';

// Pausas de tareas: viven en OpenDash; en OpenProject solo se corre el fin (o la duración, en una automática).

type DepsPausas = Pick<DepsApp, 'db' | 'ahora'>;

/** Lo que las rutas de pausas toman prestado de las de escritura de tareas. */
export interface HerramientasPausas {
  cache: CacheOp;
  sesion: preHandlerAsyncHookHandler;
  guardarEscrita: (tarea: Tarea, usuarioId: number, leidaDesde?: string) => Tarea;
  desactualizado: () => boolean;
  idDe: (req: FastifyRequest, res: FastifyReply) => number | null;
  clienteDe: (req: FastifyRequest, res: FastifyReply) => ClienteOp | null;
  tareaVisible: (id: number, usuarioId: number) => boolean;
  /** La tarea con todos sus descendientes que conoce la caché. */
  conDescendientes: (id: number) => number[];
  traerReprogramadas: (req: FastifyRequest, usuarioId: number) => Promise<void>;
  siYaNoExiste: (res: FastifyReply, e: unknown, id: number, usuarioId: number) => FastifyReply | null;
}

const MSG_INVALIDA = 'La solicitud no es válida';
const MSG_NO_ENCONTRADA = 'No encontramos esa tarea';
const MSG_SIN_PAUSA = 'Esa pausa ya no existe';
const MSG_CONFLICTO = 'Alguien modificó la tarea antes que vos';
const MSG_SIN_CATALOGO = 'Todavía se están cargando los datos de OpenProject; probá en un momento.';

const esquemaPausa = z.strictObject({
  lockVersion: z.number().int().nonnegative(),
  despues: z.number().int().positive().max(3650),
  dias: z.number().int().positive().max(MAX_DIAS_PAUSA),
});

/** Un fin nuevo escrito como OpenProject lo acepta: el fin en una manual, la duración hábil en una automática. */
function cambiosDeFin(tarea: Tarea & { inicio: string }, fin: string, catalogo: CatalogoOp): CambiosTarea {
  return tarea.programacionManual ? { fin } : { duracionDias: habilesEntre(tarea.inicio, fin, calendarioDe(catalogo)) };
}

export function registrarRutasPausas(app: FastifyInstance, deps: DepsPausas, h: HerramientasPausas): void {
  const { cache, sesion, guardarEscrita, desactualizado } = h;
  const conHijas = (id: number): boolean => h.conDescendientes(id).length > 1;

  app.get('/api/pausas', { preHandler: sesion }, async (req) => {
    const proyectos = new Set(cache.proyectosDe(req.usuario!.id));
    const porTarea: PausasPorTarea = {};
    for (const p of todasLasPausas(deps.db)) {
      const tarea = cache.tarea(p.tareaId);
      if (tarea !== null && proyectos.has(tarea.proyectoId)) (porTarea[p.tareaId] ??= []).push(p);
    }
    return exito(porTarea, desactualizado());
  });

  app.post('/api/tareas/:id/pausas', { preHandler: sesion }, async (req, res) => {
    const id = h.idDe(req, res);
    if (id === null) return res;
    const cuerpo = esquemaPausa.safeParse(req.body);
    if (!cuerpo.success) return res.code(400).send(falla('validacion', MSG_INVALIDA));
    const catalogo = cache.catalogo();
    if (catalogo === null) return res.code(503).send(falla('sin-conexion', MSG_SIN_CATALOGO));
    const usuarioId = req.usuario!.id;
    if (!h.tareaVisible(id, usuarioId)) return res.code(404).send(falla('no-encontrado', MSG_NO_ENCONTRADA));
    const cliente = h.clienteDe(req, res);
    if (cliente === null) return res;
    try {
      // Se calcula sobre lo que tiene OpenProject ahora, no sobre la caché.
      const actual = await cliente.tarea(id);
      if (actual.lockVersion !== cuerpo.data.lockVersion) {
        guardarEscrita(actual, usuarioId, deps.ahora().toISOString());
        return res.code(409).send(falla('conflicto', MSG_CONFLICTO));
      }
      const esHito = catalogo.tipos.find((t) => t.id === actual.tipoId)?.esHito === true;
      const motivo = motivoSinPausa(actual, esHito, conHijas(id));
      if (motivo !== null) return res.code(422).send(falla('validacion', motivo));
      const { inicio, fin } = actual as Tarea & { inicio: string; fin: string };
      const cal = calendarioDe(catalogo);
      const nueva = { despues: cuerpo.data.despues, dias: cuerpo.data.dias };
      const invalida = motivoPausaInvalida(inicio, fin, pausasDe(deps.db, id), nueva, cal);
      if (invalida !== null) return res.code(422).send(falla('validacion', invalida));
      const escrita = await cliente.actualizarTarea(id, actual.lockVersion, cambiosDeFin({ ...actual, inicio }, finConPausa(fin, nueva.dias, cal), catalogo));
      const tarea = guardarEscrita(escrita, usuarioId);
      const guardada: Pausa = guardarPausa(deps.db, id, nueva, usuarioId, deps.ahora());
      await h.traerReprogramadas(req, usuarioId);
      return exito({ tarea, pausa: guardada }, desactualizado());
    } catch (e) {
      const borrada = h.siYaNoExiste(res, e, id, usuarioId);
      if (borrada !== null) return borrada;
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.delete('/api/pausas/:id', { preHandler: sesion }, async (req, res) => {
    const id = h.idDe(req, res);
    if (id === null) return res;
    const usuarioId = req.usuario!.id;
    const existente = leerPausa(deps.db, id);
    if (existente === null || !h.tareaVisible(existente.tareaId, usuarioId)) return res.code(404).send(falla('no-encontrado', MSG_SIN_PAUSA));
    const catalogo = cache.catalogo();
    if (catalogo === null) return res.code(503).send(falla('sin-conexion', MSG_SIN_CATALOGO));
    const cliente = h.clienteDe(req, res);
    if (cliente === null) return res;
    const tareaId = existente.tareaId;
    try {
      const actual = await cliente.tarea(tareaId);
      const fin = actual.inicio === null || actual.fin === null
        ? null
        : finSinPausa(actual.inicio, actual.fin, pausasDe(deps.db, tareaId), id, calendarioDe(catalogo));
      // Si la pausa ya no cae dentro de la tarea (alguien la acortó), no hay fechas que devolver.
      let tarea: Tarea | null = null;
      if (fin !== null) {
        const escrita = await cliente.actualizarTarea(tareaId, actual.lockVersion, cambiosDeFin({ ...actual, inicio: actual.inicio! }, fin, catalogo));
        tarea = guardarEscrita(escrita, usuarioId);
      }
      borrarPausa(deps.db, id);
      return exito({ tarea }, desactualizado());
    } catch (e) {
      const borrada = h.siYaNoExiste(res, e, tareaId, usuarioId);
      if (borrada !== null) {
        borrarPausa(deps.db, id);
        return borrada;
      }
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });
}
