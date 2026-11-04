import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import type { DepsApp } from '../app.js';
import { clientePara } from '../auth/clientes.js';
import { requerirSesion } from '../auth/rutas.js';
import { responderError, responderTokenVencido } from '../errores.js';
import { PATRON_ID } from '../identificadores.js';
import { ErrorOp } from '../openproject/errores.js';
import { crearCache } from '../sync/cache.js';

type DepsVersiones = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'registro'>;

const MSG_INVALIDA = 'La solicitud no es válida';
const MSG_FECHAS = 'La fecha de fin no puede ser anterior a la de inicio';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
const nombre = z.string().trim().min(1).max(60);
const estado = z.enum(['abierta', 'bloqueada', 'cerrada']);

const esquemaNueva = z.strictObject({ nombre, inicio: fecha.nullable(), fin: fecha.nullable() });
const esquemaCambios = z.strictObject({
  nombre: nombre.optional(), inicio: fecha.nullable().optional(), fin: fecha.nullable().optional(), estado: estado.optional(),
}).refine((c) => Object.keys(c).length > 0);

const finAntesDeInicio = (inicio: string | null | undefined, fin: string | null | undefined): boolean =>
  inicio != null && fin != null && fin < inicio;

export function registrarRutasVersiones(app: FastifyInstance, deps: DepsVersiones): void {
  const cache = crearCache(deps.db, deps.ahora);
  const sesion = requerirSesion(deps);
  const idDe = (crudo: string): number | null => (PATRON_ID.test(crudo) ? Number(crudo) : null);
  const invalida = falla('validacion', MSG_INVALIDA);
  const noEncontrada = falla('no-encontrado', 'No encontramos ese proyecto o esa versión');

  app.get('/api/proyectos/:id/versiones', { preHandler: sesion }, async (req, res) => {
    const proyectoId = idDe((req.params as { id: string }).id);
    if (proyectoId === null) return res.code(400).send(invalida);
    const usuarioId = req.usuario!.id;
    if (!cache.proyectosDe(usuarioId).includes(proyectoId)) return res.code(404).send(noEncontrada);
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      const [versiones, puedeCrear] = await Promise.all([cliente.versiones(proyectoId), cliente.puedeCrearVersion(proyectoId)]);
      // Lo leído es la verdad de OpenProject: el catálogo se pone al día (y pierde lo que ya no está).
      const vigentes = new Set(versiones.map((v) => v.id));
      for (const previa of cache.catalogo()?.versiones ?? []) {
        if (previa.proyectoId === proyectoId && !vigentes.has(previa.id)) cache.quitarVersion(previa.id);
      }
      for (const { puedeCambiar: _c, puedeBorrar: _b, ...v } of versiones) cache.guardarVersion(v);
      const porVersion = new Map<number, number>();
      for (const t of cache.tareas([proyectoId])) {
        if (t.versionId !== null) porVersion.set(t.versionId, (porVersion.get(t.versionId) ?? 0) + 1);
      }
      return exito({ versiones: versiones.map((v) => ({ ...v, tareas: porVersion.get(v.id) ?? 0 })), puedeCrear });
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.post('/api/proyectos/:id/versiones', { preHandler: sesion }, async (req, res) => {
    const proyectoId = idDe((req.params as { id: string }).id);
    const cuerpo = esquemaNueva.safeParse(req.body);
    if (proyectoId === null || !cuerpo.success) return res.code(400).send(invalida);
    if (finAntesDeInicio(cuerpo.data.inicio, cuerpo.data.fin)) return res.code(400).send(falla('validacion', MSG_FECHAS));
    const usuarioId = req.usuario!.id;
    if (!cache.proyectosDe(usuarioId).includes(proyectoId)) return res.code(404).send(noEncontrada);
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      const creada = await cliente.crearVersion(proyectoId, cuerpo.data);
      cache.guardarVersion(creada);
      return exito(creada);
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  /** La versión del catálogo si está en un proyecto que la persona ve. */
  const versionVisible = (id: number, usuarioId: number) => {
    const v = cache.catalogo()?.versiones.find((x) => x.id === id);
    return v !== undefined && cache.proyectosDe(usuarioId).includes(v.proyectoId) ? v : null;
  };

  app.patch('/api/versiones/:id', { preHandler: sesion }, async (req, res) => {
    const id = idDe((req.params as { id: string }).id);
    const cuerpo = esquemaCambios.safeParse(req.body);
    if (id === null || !cuerpo.success) return res.code(400).send(invalida);
    const usuarioId = req.usuario!.id;
    const actual = versionVisible(id, usuarioId);
    if (actual === null) return res.code(404).send(noEncontrada);
    const inicio = cuerpo.data.inicio !== undefined ? cuerpo.data.inicio : actual.inicio;
    const fin = cuerpo.data.fin !== undefined ? cuerpo.data.fin : actual.fin;
    if ((cuerpo.data.inicio !== undefined || cuerpo.data.fin !== undefined) && finAntesDeInicio(inicio, fin)) {
      return res.code(400).send(falla('validacion', MSG_FECHAS));
    }
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      const guardada = await cliente.cambiarVersion(id, cuerpo.data, actual.proyectoId);
      cache.guardarVersion(guardada);
      return exito(guardada);
    } catch (e) {
      if (e instanceof ErrorOp && e.tipo === 'no-encontrado') cache.quitarVersion(id);
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.delete('/api/versiones/:id', { preHandler: sesion }, async (req, res) => {
    const id = idDe((req.params as { id: string }).id);
    if (id === null) return res.code(400).send(invalida);
    const usuarioId = req.usuario!.id;
    const actual = versionVisible(id, usuarioId);
    if (actual === null) return res.code(404).send(noEncontrada);
    const tareas = cache.tareas([actual.proyectoId]).filter((t) => t.versionId === id).length;
    if (tareas > 0) {
      return res.code(422).send(falla('validacion', `«${actual.nombre}» tiene ${tareas} ${tareas === 1 ? 'tarea' : 'tareas'}: pasalas a otra versión antes de borrarla`));
    }
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      await cliente.borrarVersion(id);
      cache.quitarVersion(id);
      return exito({});
    } catch (e) {
      if (e instanceof ErrorOp && e.tipo === 'no-encontrado') cache.quitarVersion(id);
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });
}
