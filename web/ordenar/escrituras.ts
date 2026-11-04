import type { QueryClient } from '@tanstack/react-query';
import type { Tarea } from '../../compartido/tipos.js';
import { ErrorApi, pedir } from '../api/cliente.js';
import { CLAVES, type ListaTareas } from '../api/consultas.js';
import { ponerTarea, reemplazar } from '../tareas/acciones.js';

/**
 * Cambia el responsable de una tarea (o lo quita con `null`): la fila cambia al instante en la caché y después se guarda en OpenProject
 * con el `lockVersion` de la tarea. Si falla vuelve a su lugar (solo si nadie la tocó en el medio) y se vuelve a lanzar el error;
 * ante un conflicto (409) además se relee la lista y el detalle.
 */
export async function cambiarResponsable(cliente: QueryClient, tarea: Tarea, responsableId: number | null): Promise<void> {
  await cliente.cancelQueries({ queryKey: CLAVES.tareas });
  const cambiada: Tarea = { ...tarea, responsableId, actualizada: new Date().toISOString() };
  cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => reemplazar(lista, cambiada));
  try {
    const guardada = await pedir<Tarea>('PATCH', `/api/tareas/${tarea.id}`, { lockVersion: tarea.lockVersion, cambios: { responsableId } });
    await cliente.cancelQueries({ queryKey: CLAVES.tareas });
    ponerTarea(cliente, guardada);
    void cliente.invalidateQueries({ queryKey: CLAVES.tarea(tarea.id) });
  } catch (error) {
    const enCache = cliente.getQueryData<ListaTareas>(CLAVES.tareas)?.tareas.find((t) => t.id === tarea.id);
    if (enCache?.actualizada === cambiada.actualizada) {
      cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => reemplazar(lista, tarea));
    }
    if (error instanceof ErrorApi && (error.codigo === 'conflicto' || error.estado === 409)) {
      void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
      void cliente.invalidateQueries({ queryKey: CLAVES.tarea(tarea.id) });
    }
    throw error;
  }
}
