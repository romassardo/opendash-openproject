import type { FastifyInstance, FastifyReply } from 'fastify';
import { exito, falla } from '../../compartido/api.js';
import type { Actividad, Catalogo, CatalogoOp, Tarea } from '../../compartido/tipos.js';
import type { DepsApp } from '../app.js';
import { clientePara } from '../auth/clientes.js';
import { responderError, responderTokenVencido } from '../errores.js';
import { PATRON_ID } from '../identificadores.js';
import { requerirSesion } from '../auth/rutas.js';
import { ErrorOp } from '../openproject/errores.js';
import { contarComentarios, fechaDeCierre } from '../openproject/historial.js';
import { conAvatarPropio } from '../personas/avatar.js';
import { leerPlantillas, leerTablero } from '../ajustes/repositorio.js';
import { plantillasVisibles } from '../proyectos/plantillas.js';
import { crearCache } from '../sync/cache.js';
import { registrarRutasEscritura } from './escritura.js';
import { personasVisibles } from './visibilidad.js';

type DepsTareas = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'sync' | 'registro'>;

const CATALOGO_VACIO: CatalogoOp = { estados: [], tipos: [], prioridades: [], proyectos: [], versiones: [], personas: [], asignables: {}, semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [] };

interface Visibles { tareas: ReadonlySet<number>; versiones: ReadonlySet<number> }

// Saca de la tarea los ids de madre y versión que apuntan a algo que esta persona no puede ver.
export function sanearTarea(t: Tarea, visibles: Visibles): Tarea {
  return {
    ...t,
    madreId: t.madreId !== null && visibles.tareas.has(t.madreId) ? t.madreId : null,
    versionId: t.versionId !== null && visibles.versiones.has(t.versionId) ? t.versionId : null,
  };
}

export function registrarRutasTareas(app: FastifyInstance, deps: DepsTareas): void {
  const cache = crearCache(deps.db, deps.ahora);
  const sesion = requerirSesion(deps);
  const desactualizado = (): boolean => deps.sync.estado().desactualizado;

  const versionesVisibles = (proyectos: ReadonlySet<number>): Set<number> =>
    new Set((cache.catalogo()?.versiones ?? []).filter((v) => proyectos.has(v.proyectoId)).map((v) => v.id));

  // La madre solo cuenta si está en la caché y en un proyecto visible.
  const visiblesDeDetalle = (t: Tarea, proyectos: ReadonlySet<number>): Visibles => {
    const madre = t.madreId === null ? null : cache.tarea(t.madreId);
    return {
      tareas: new Set(madre !== null && proyectos.has(madre.proyectoId) ? [madre.id] : []),
      versiones: versionesVisibles(proyectos),
    };
  };

  // Reabierta pierde el cierre; cerrada lo recibe solo si hay historial (sin él se conserva el anterior);
  // los comentarios se recuentan cuando hay historial. Si la caché ya tiene una versión más nueva, no se
  // toca nada y devuelve false.
  function guardarFresca(tarea: Tarea, actividades: Actividad[] | null, leidaDesde?: string): boolean {
    if (cache.guardarTareas([tarea], leidaDesde === undefined ? undefined : { leidaDesde }).length === 0) return false;
    const estados = cache.catalogo()?.estados ?? [];
    if (estados.some((e) => e.id === tarea.estadoId && e.cerrado)) {
      const nombres = estados.filter((e) => e.cerrado).map((e) => e.nombre);
      if (actividades !== null) cache.guardarCierre(tarea.id, fechaDeCierre(actividades, nombres) ?? tarea.actualizada);
    } else {
      cache.quitarCierre(tarea.id);
    }
    if (actividades !== null) cache.guardarComentarios(tarea.id, contarComentarios(actividades));
    return true;
  }

  // Tras una escritura: guarda la tarea que devolvió OpenProject y la responde saneada para quien actuó.
  // Sin historial a mano, una tarea recién cerrada toma `actualizada` como fecha de cierre.
  const guardarEscrita = (tarea: Tarea, usuarioId: number, leidaDesde?: string): Tarea => {
    const estados = cache.catalogo()?.estados ?? [];
    const cerrada = estados.some((e) => e.id === tarea.estadoId && e.cerrado);
    if (guardarFresca(tarea, null, leidaDesde) && cerrada && cache.tarea(tarea.id)?.cerradaEl == null) {
      cache.guardarCierre(tarea.id, tarea.actualizada);
    }
    const guardada = cache.tarea(tarea.id) ?? tarea;
    return sanearTarea(guardada, visiblesDeDetalle(guardada, new Set(cache.proyectosDe(usuarioId))));
  };

  registrarRutasEscritura(app, deps, { cache, sesion, guardarEscrita, desactualizado });

  // La caché mezcla lo que trajo cada usuario: todo se filtra a los proyectos que este puede leer.
  app.get('/api/catalogo', { preHandler: sesion }, async (req) => {
    const usuario = req.usuario!;
    const visibles = new Set(cache.proyectosDe(usuario.id));
    const catalogo = cache.catalogo() ?? CATALOGO_VACIO;
    const personas = personasVisibles(cache, usuario.id);
    const asignables = Object.fromEntries(Object.entries(catalogo.asignables ?? {}).filter(([id]) => visibles.has(Number(id))));
    return exito<Catalogo>(
      {
        ...catalogo,
        proyectos: catalogo.proyectos.filter((p) => visibles.has(p.id)),
        versiones: catalogo.versiones.filter((v) => visibles.has(v.proyectoId)),
        asignables,
        semanaNoLaborable: catalogo.semanaNoLaborable ?? [0, 6],
        diasNoLaborables: catalogo.diasNoLaborables ?? [],
        tablero: leerTablero(deps.db),
        plantillas: plantillasVisibles(catalogo.plantillasOp ?? [], leerPlantillas(deps.db), visibles),
        personas: catalogo.personas.filter((p) => personas.has(p.id)).map(conAvatarPropio),
      },
      desactualizado(),
    );
  });

  app.get('/api/tareas', { preHandler: sesion }, async (req) => {
    const proyectos = cache.proyectosDe(req.usuario!.id);
    const crudas = cache.tareas(proyectos);
    const ids = new Set(crudas.map((t) => t.id));
    const visibles: Visibles = { tareas: ids, versiones: versionesVisibles(new Set(proyectos)) };
    const dependencias = cache.dependencias().filter((d) => ids.has(d.sucesoraId) && ids.has(d.predecesoraId));
    return exito({ tareas: crudas.map((t) => sanearTarea(t, visibles)), dependencias }, desactualizado());
  });

  app.get('/api/tareas/:id', { preHandler: sesion }, async (req, res) => {
    const crudo = (req.params as { id: string }).id;
    if (!PATRON_ID.test(crudo)) return res.code(400).send(falla('validacion', 'El identificador no es válido'));
    const id = Number(crudo);
    const usuario = req.usuario!;
    const proyectos = new Set(cache.proyectosDe(usuario.id));
    const enCache = cache.tarea(id);
    // La caché solo respalda tareas cacheadas y legibles; lo demás se resuelve siempre con OpenProject,
    // así un id oculto responde igual que uno inexistente.
    const respaldo = enCache !== null && proyectos.has(enCache.proyectoId) ? enCache : null;
    const cliente = clientePara(deps, usuario.id);
    if (cliente === null) return responderTokenVencido(res);
    let tarea: Tarea;
    try {
      tarea = await cliente.tarea(id);
    } catch (e) {
      if (respaldo !== null && e instanceof ErrorOp && e.tipo === 'red') {
        return exito({ tarea: sanearTarea(respaldo, visiblesDeDetalle(respaldo, proyectos)), actividades: [] as Actividad[] }, true);
      }
      return responderError(res, e, { db: deps.db, usuarioId: usuario.id });
    }
    let actividades: Actividad[] | null = null;
    let incompleto = false;
    try {
      actividades = await cliente.actividades(id);
    } catch (e) {
      if (e instanceof ErrorOp && e.tipo === 'red') incompleto = true;
      else return responderError(res, e, { db: deps.db, usuarioId: usuario.id });
    }
    guardarFresca(tarea, actividades);
    const guardada = cache.tarea(tarea.id) ?? tarea;
    return exito(
      { tarea: sanearTarea(guardada, visiblesDeDetalle(guardada, proyectos)), actividades: actividades ?? [] },
      incompleto || desactualizado(),
    );
  });
}
