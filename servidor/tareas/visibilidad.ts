import type { CacheOp } from '../sync/cache.js';

/**
 * Las personas que `usuarioId` puede ver: él mismo, quienes figuran como responsable o autor en las
 * tareas de sus proyectos visibles y quienes se pueden asignar en esos proyectos, tengan tareas o no.
 */
export function personasVisibles(cache: CacheOp, usuarioId: number): Set<number> {
  const proyectos = cache.proyectosDe(usuarioId);
  const visibles = new Set(proyectos);
  const personas = new Set<number>([usuarioId]);
  for (const t of cache.tareas(proyectos)) {
    if (t.responsableId !== null) personas.add(t.responsableId);
    if (t.autorId !== null) personas.add(t.autorId);
  }
  for (const [proyecto, ids] of Object.entries(cache.catalogo()?.asignables ?? {})) {
    if (visibles.has(Number(proyecto))) for (const id of ids) personas.add(id);
  }
  return personas;
}

/** La tarea está en la caché y en uno de los proyectos visibles. */
export function tareaVisible(cache: CacheOp, proyectos: ReadonlySet<number>, tareaId: number): boolean {
  const t = cache.tarea(tareaId);
  return t !== null && proyectos.has(t.proyectoId);
}
