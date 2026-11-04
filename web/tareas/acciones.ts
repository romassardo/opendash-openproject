import { useCallback } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { estadoDeColumna, mensajeFaltaEstado, versionParaColumna } from '../../compartido/columnas.js';
import type { Catalogo, Columna, NuevaTarea, Tarea } from '../../compartido/tipos.js';
import { ErrorApi, pedir } from '../api/cliente.js';
import { CLAVES, type DetalleTarea, type ListaTareas } from '../api/consultas.js';
import { quitarTareaDeLaCache } from '../api/mutaciones.js';
import { useAvisos } from '../ui/avisos.js';

export const MSG_CONFLICTO = 'Alguien cambió esta tarea recién. Ya ves la versión nueva.';

export function reemplazar(lista: ListaTareas | undefined, tarea: Tarea): ListaTareas | undefined {
  if (!lista) return lista;
  return { ...lista, tareas: lista.tareas.map((t) => (t.id === tarea.id ? tarea : t)) };
}

/** Pone la tarea que devolvió el servidor en su detalle (si está cargado) y en la lista. */
export function ponerTarea(cliente: QueryClient, tarea: Tarea): void {
  cliente.setQueryData<DetalleTarea>(CLAVES.tarea(tarea.id), (detalle) => (detalle ? { ...detalle, tarea } : detalle));
  cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => reemplazar(lista, tarea));
}

// Sin la lista cargada no se inventa una: la consulta la trae completa.
function agregar(lista: ListaTareas | undefined, tarea: Tarea): ListaTareas | undefined {
  if (!lista) return lista;
  if (lista.tareas.some((t) => t.id === tarea.id)) return reemplazar(lista, tarea);
  return { ...lista, tareas: [...lista.tareas, tarea] };
}

/** Suma a la lista una tarea recién creada, sin esperar el próximo refresco. */
export async function sumarTarea(cliente: QueryClient, tarea: Tarea): Promise<void> {
  // Una lectura de la lista en curso no la tendría todavía: se cancela antes de sumarla.
  await cliente.cancelQueries({ queryKey: CLAVES.tareas });
  cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => agregar(lista, tarea));
}

/** Otra persona borró la tarea: sale de la lista y el detalle abierto pasa a «No se encontró la tarea». */
export function yaNoExiste(cliente: QueryClient, id: number): void {
  quitarTareaDeLaCache(cliente, id);
  void cliente.invalidateQueries({ queryKey: CLAVES.tarea(id) });
}

/** Texto para la persona a partir de un error de la API (o de la falta de un estado). */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorApi) return error.codigo === 'conflicto' ? MSG_CONFLICTO : error.mensaje;
  if (error instanceof Error) return error.message;
  return 'No se pudo guardar el cambio. Probá de nuevo.';
}

/** Una versión cerrada o bloqueada rechaza la tarea que se le suma al pasar a su columna: se dice cuál y dónde abrirla. */
function mensajeDeMover(error: unknown, tarea: Tarea, columna: Columna, catalogo: Catalogo): string {
  // Solo si OpenProject dice que el rechazo es del campo versión; otro 422 (fechas, permisos…) muestra su motivo real.
  if (error instanceof ErrorApi && error.codigo === 'validacion' && error.atributos.includes('version')) {
    const version = versionParaColumna(columna, catalogo.versiones.filter((v) => v.proyectoId === tarea.proyectoId));
    if (version !== null && version.estado !== 'abierta') {
      return `La versión «${version.nombre}» está ${version.estado} en este proyecto: abrila en Versiones`;
    }
  }
  return mensajeDeError(error);
}

/**
 * Mover de columna: la tarjeta cambia al instante en la caché y después se escribe en OpenProject.
 * Si falla vuelve a su lugar y `alFallar` recibe el motivo (y el error); ante un conflicto se relee la lista.
 * Devuelve la tarea guardada, o `null` si no se pudo.
 */
export function useMoverTarea(alFallar: (mensaje: string, error: unknown) => void) {
  const cliente = useQueryClient();
  return useCallback(async (tarea: Tarea, columna: Columna, catalogo: Catalogo): Promise<Tarea | null> => {
    const estado = estadoDeColumna(columna, catalogo.estados, catalogo.tablero);
    if (estado === null) {
      alFallar(mensajeFaltaEstado(columna), new Error(mensajeFaltaEstado(columna)));
      return null;
    }
    const { id: estadoId, cerrado } = estado;
    // Primero se cancela cualquier lectura en curso: si terminara después, pisaría el movimiento.
    await cliente.cancelQueries({ queryKey: CLAVES.tareas });
    const ahora = new Date().toISOString();
    const movida: Tarea = { ...tarea, estadoId, actualizada: ahora, cerradaEl: cerrado ? ahora : null };
    cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => reemplazar(lista, movida));
    try {
      const guardada = await pedir<Tarea>('POST', `/api/tareas/${tarea.id}/mover`, { lockVersion: tarea.lockVersion, columna });
      await cliente.cancelQueries({ queryKey: CLAVES.tareas });
      ponerTarea(cliente, guardada);
      // Se relee el detalle para traer el historial con el cambio de estado.
      void cliente.invalidateQueries({ queryKey: CLAVES.tarea(tarea.id) });
      return guardada;
    } catch (error) {
      // Solo se devuelve la copia vieja si la tarea sigue siendo la del movimiento optimista: si en el medio
      // llegó una versión más nueva (otra escritura, una relectura), restaurar la copia la pisaría.
      const enCache = cliente.getQueryData<ListaTareas>(CLAVES.tareas)?.tareas.find((t) => t.id === tarea.id);
      if (enCache?.actualizada === movida.actualizada) {
        cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => reemplazar(lista, tarea));
      } else {
        void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
      }
      alFallar(mensajeDeMover(error, tarea, columna, catalogo), error);
      if (error instanceof ErrorApi && error.codigo === 'no-encontrado') yaNoExiste(cliente, tarea.id);
      // Un rechazo por la versión (cerrada o bloqueada) puede venir de un catálogo viejo: el próximo intento lo relee.
      if (error instanceof ErrorApi && error.estado === 422) void cliente.invalidateQueries({ queryKey: CLAVES.catalogo });
      if (error instanceof ErrorApi && error.codigo === 'conflicto') {
        void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
        void cliente.invalidateQueries({ queryKey: CLAVES.tarea(tarea.id) });
      }
      return null;
    }
  }, [cliente, alFallar]);
}

/**
 * Deshace un cierre o una reapertura: devuelve la tarea al estado, la versión, las fechas y el trabajo restante de antes
 * (cerrar corre el fin al día del cierre y deja el restante en 0), pero solo si sigue como quedó (`despuesEstadoId`). Si alguien la cambió en el medio, o el servidor responde 409, no se pisa nada.
 * Cualquier otro error se lanza tal cual, para que el aviso diga el motivo real.
 */
export async function restaurarEstado(
  cliente: QueryClient,
  tareaId: number,
  antes: { estadoId: number; versionId: number | null; inicio?: string | null; fin?: string | null; restanteHoras?: number | null },
  despuesEstadoId: number,
): Promise<'listo' | 'cambio'> {
  const actual = cliente.getQueryData<ListaTareas>(CLAVES.tareas)?.tareas.find((t) => t.id === tareaId);
  if (!actual || actual.estadoId !== despuesEstadoId) return 'cambio';
  try {
    await cliente.cancelQueries({ queryKey: CLAVES.tareas });
    const guardada = await pedir<Tarea>('PATCH', `/api/tareas/${tareaId}`, {
      lockVersion: actual.lockVersion,
      cambios: {
        estadoId: antes.estadoId, versionId: antes.versionId,
        ...(antes.inicio !== undefined && antes.inicio !== actual.inicio && { inicio: antes.inicio }),
        ...(antes.fin !== undefined && antes.fin !== actual.fin && { fin: antes.fin }),
        ...(antes.restanteHoras !== undefined && antes.restanteHoras !== actual.restanteHoras && { restanteHoras: antes.restanteHoras }),
      },
    });
    ponerTarea(cliente, guardada);
    void cliente.invalidateQueries({ queryKey: CLAVES.tarea(tareaId) });
    return 'listo';
  } catch (error) {
    if (error instanceof ErrorApi && error.codigo === 'conflicto') {
      void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
      void cliente.invalidateQueries({ queryKey: CLAVES.tarea(tareaId) });
      return 'cambio';
    }
    throw error;
  }
}

/**
 * Publica «Cerraste «X».» (o «Reabriste…») con «Deshacer» en el aviso flotante. Sirve al círculo de las listas y
 * a las subtareas del detalle: las dos dejan volver al estado, la versión, las fechas y el restante de antes.
 */
export function useAvisoDeCierre(): (tarea: Tarea, estabaCerrada: boolean, guardada: Tarea) => void {
  const cliente = useQueryClient();
  const avisos = useAvisos();
  return useCallback((tarea, estabaCerrada, guardada) => {
    const antes = { estadoId: tarea.estadoId, versionId: tarea.versionId, inicio: tarea.inicio, fin: tarea.fin, restanteHoras: tarea.restanteHoras };
    const deshacer = async (): Promise<void> => {
      try {
        const resultado = await restaurarEstado(cliente, tarea.id, antes, guardada.estadoId);
        if (resultado === 'listo') avisos.avisar({ texto: 'Listo, quedó como estaba.' });
        else avisos.avisar({ texto: `Alguien cambió «${tarea.titulo}» mientras tanto; quedó como está.` });
      } catch (error) {
        avisos.avisar({ texto: `No se pudo deshacer: ${mensajeDeError(error)}`, error: true });
      }
    };
    avisos.avisar({
      texto: `${estabaCerrada ? 'Reabriste' : 'Cerraste'} «${tarea.titulo}».`,
      accion: { etiqueta: 'Deshacer', alHacer: deshacer },
    });
  }, [cliente, avisos]);
}

/** Crear una tarea (`POST /api/tareas`) y sumarla a la lista sin esperar el próximo refresco. */
export function useCrearTarea() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (nueva: NuevaTarea) => pedir<Tarea>('POST', '/api/tareas', nueva),
    onSuccess: (tarea) => sumarTarea(cliente, tarea),
  });
}
