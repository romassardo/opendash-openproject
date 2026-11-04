import type { QueryClient } from '@tanstack/react-query';
import type { OrdenLinea } from '../../compartido/linea.js';
import type { Pausa, PausaNueva, PausasPorTarea } from '../../compartido/pausas.js';
import type { CambiosTarea, Dependencia, NuevaTarea, Tarea } from '../../compartido/tipos.js';
import { ErrorApi, pedir } from '../api/cliente.js';
import { CLAVES, type ListaTareas } from '../api/consultas.js';
import { quitarTareaDeLaCache } from '../api/mutaciones.js';
import { ponerTarea, reemplazar, sumarTarea } from '../tareas/acciones.js';
import type { FechasBarra } from './arrastre.js';

export const MSG_SIN_PERMISO = 'No tenés permiso para cambiar esta tarea en OpenProject.';

/** Lo que la línea de tiempo necesita para guardar las fechas nuevas de una barra. */
export interface EdicionFechas {
  /** Guarda las fechas (la barra queda en el lugar nuevo al instante). Devuelve las fechas guardadas, o `null` si no se pudo. */
  guardar(tarea: Tarea, fechas: FechasBarra, esHito: boolean): Promise<FechasBarra | null>;
  /** Si hay un cambio aplicándose: los gestos nuevos esperan a que termine. */
  guardando(id: number): boolean;
}

export const esError = (error: unknown, codigo: string, estado: number): boolean =>
  error instanceof ErrorApi && (error.codigo === codigo || error.estado === estado);

// Los hitos viajan con su única fecha; el resto con las fechas que cambiaron.
function cambiosDe(tarea: Tarea, fechas: FechasBarra, esHito: boolean, programacionManual?: boolean): CambiosTarea {
  const fechasCambiadas: CambiosTarea = esHito
    ? { fecha: fechas.inicio }
    : {
      ...(fechas.inicio !== tarea.inicio && { inicio: fechas.inicio }),
      ...(fechas.fin !== tarea.fin && { fin: fechas.fin }),
    };
  return programacionManual === undefined ? fechasCambiadas : { ...fechasCambiadas, programacionManual };
}

/**
 * Escribe las fechas de una tarea: la barra cambia al instante en la caché y después se guarda en OpenProject.
 * Si falla vuelve a su lugar (solo si nadie la tocó en el medio) y se vuelve a lanzar el error.
 */
export async function escribirFechas(
  cliente: QueryClient, tarea: Tarea, fechas: FechasBarra, esHito: boolean, programacionManual?: boolean,
): Promise<Tarea> {
  const cambios = cambiosDe(tarea, fechas, esHito, programacionManual);
  // Una lectura en curso podría terminar después y pisar la barra recién movida.
  await cliente.cancelQueries({ queryKey: CLAVES.tareas });
  const movida: Tarea = { ...tarea, inicio: fechas.inicio, fin: fechas.fin, actualizada: new Date().toISOString() };
  cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => reemplazar(lista, movida));
  try {
    const guardada = await pedir<Tarea>('PATCH', `/api/tareas/${tarea.id}`, { lockVersion: tarea.lockVersion, cambios });
    await cliente.cancelQueries({ queryKey: CLAVES.tareas });
    ponerTarea(cliente, guardada);
    void cliente.invalidateQueries({ queryKey: CLAVES.tarea(tarea.id) });
    return guardada;
  } catch (error) {
    const enCache = cliente.getQueryData<ListaTareas>(CLAVES.tareas)?.tareas.find((t) => t.id === tarea.id);
    if (enCache?.actualizada === movida.actualizada) {
      cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => reemplazar(lista, tarea));
    }
    throw error;
  }
}

/**
 * Pide a OpenProject que reprograme una tarea automática: se la guarda de nuevo en automático, sin mandar fechas
 * (con fechas pisadas OpenProject 16 responde 422; sin ellas la corre detrás de su anterior).
 * Con `duracionDias` manda también su duración hábil: sin ella OpenProject puede dejarla de un día.
 */
export async function reprogramarAutomatica(cliente: QueryClient, tarea: Tarea, duracionDias?: number): Promise<Tarea> {
  await cliente.cancelQueries({ queryKey: CLAVES.tareas });
  const cambios = { programacionManual: false, ...(duracionDias !== undefined && { duracionDias }) };
  const guardada = await pedir<Tarea>('PATCH', `/api/tareas/${tarea.id}`, { lockVersion: tarea.lockVersion, cambios });
  await cliente.cancelQueries({ queryKey: CLAVES.tareas });
  ponerTarea(cliente, guardada);
  void cliente.invalidateQueries({ queryKey: CLAVES.tarea(tarea.id) });
  return guardada;
}

/** Cancela la lectura en curso y trae la lista fresca. */
export async function releerTareas(cliente: QueryClient): Promise<ListaTareas> {
  await cliente.cancelQueries({ queryKey: CLAVES.tareas });
  return cliente.fetchQuery({ queryKey: CLAVES.tareas, queryFn: () => pedir<ListaTareas>('GET', '/api/tareas'), staleTime: 0 });
}

export async function crearUnion(cliente: QueryClient, despuesId: number, antesId: number, retraso?: number): Promise<Dependencia> {
  const dependencia = await pedir<Dependencia>('POST', `/api/tareas/${despuesId}/dependencias`, {
    esperaA: antesId, ...(retraso !== undefined && { retraso }),
  });
  cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => (lista && !lista.dependencias.some((d) => d.id === dependencia.id)
    ? { ...lista, dependencias: [...lista.dependencias, dependencia] }
    : lista));
  return dependencia;
}

/** Borra la unión; un 404 cuenta como hecho (ya no estaba). */
export async function borrarUnion(cliente: QueryClient, dependencia: Dependencia): Promise<void> {
  try {
    await pedir<null>('DELETE', `/api/dependencias/${dependencia.id}`);
  } catch (error) {
    if (!esError(error, 'no-encontrado', 404)) throw error;
  }
  cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => (lista
    ? { ...lista, dependencias: lista.dependencias.filter((d) => d.id !== dependencia.id) }
    : lista));
}

/** Crea la tarea en OpenProject y la suma a la lista. */
export async function crearTarea(cliente: QueryClient, nueva: NuevaTarea): Promise<Tarea> {
  const tarea = await pedir<Tarea>('POST', '/api/tareas', nueva);
  await sumarTarea(cliente, tarea);
  return tarea;
}

/** Borra la tarea y la saca de la lista; un 404 cuenta como hecho (ya no estaba). */
export async function borrarTarea(cliente: QueryClient, id: number): Promise<void> {
  try {
    await pedir<null>('DELETE', `/api/tareas/${id}`);
  } catch (error) {
    if (!esError(error, 'no-encontrado', 404)) throw error;
  }
  quitarTareaDeLaCache(cliente, id);
}

const conPausa = (pausas: PausasPorTarea | undefined, nueva: Pausa): PausasPorTarea => ({
  ...(pausas ?? {}), [nueva.tareaId]: [...(pausas?.[nueva.tareaId] ?? []).filter((p) => p.id !== nueva.id), nueva],
});
const sinPausa = (pausas: PausasPorTarea | undefined, vieja: Pausa): PausasPorTarea | undefined => pausas && ({
  ...pausas, [vieja.tareaId]: (pausas[vieja.tareaId] ?? []).filter((p) => p.id !== vieja.id),
});

/** Pausa la tarea: el servidor corre su fin en OpenProject y guarda la pausa. */
export async function crearPausa(cliente: QueryClient, tarea: Tarea, nueva: PausaNueva): Promise<{ tarea: Tarea; pausa: Pausa }> {
  const creada = await pedir<{ tarea: Tarea; pausa: Pausa }>('POST', `/api/tareas/${tarea.id}/pausas`, { lockVersion: tarea.lockVersion, ...nueva });
  await cliente.cancelQueries({ queryKey: CLAVES.tareas });
  ponerTarea(cliente, creada.tarea);
  cliente.setQueryData<PausasPorTarea>(CLAVES.pausas, (pausas) => conPausa(pausas, creada.pausa));
  void cliente.invalidateQueries({ queryKey: CLAVES.tarea(tarea.id) });
  return creada;
}

/** Quita la pausa: el servidor devuelve el fin en OpenProject. Un 404 cuenta como hecho (ya no estaba). */
export async function quitarPausa(cliente: QueryClient, pausa: Pausa): Promise<Tarea | null> {
  let tarea: Tarea | null = null;
  try {
    tarea = (await pedir<{ tarea: Tarea | null }>('DELETE', `/api/pausas/${pausa.id}`)).tarea;
  } catch (error) {
    if (!esError(error, 'no-encontrado', 404)) throw error;
  }
  if (tarea !== null) {
    await cliente.cancelQueries({ queryKey: CLAVES.tareas });
    ponerTarea(cliente, tarea);
  }
  cliente.setQueryData<PausasPorTarea | undefined>(CLAVES.pausas, (pausas) => sinPausa(pausas, pausa));
  void cliente.invalidateQueries({ queryKey: CLAVES.tarea(pausa.tareaId) });
  return tarea;
}

/** Guarda el orden de un contenedor: se ve al instante y, si falla, vuelve el anterior. */
export async function guardarOrden(cliente: QueryClient, contenedor: string, ids: number[]): Promise<void> {
  const anterior = cliente.getQueryData<OrdenLinea>(CLAVES.ordenLinea);
  cliente.setQueryData<OrdenLinea>(CLAVES.ordenLinea, (orden) => ({ ...(orden ?? {}), [contenedor]: ids }));
  try {
    await pedir('PUT', `/api/linea/orden/${contenedor}`, { ids });
  } catch (error) {
    cliente.setQueryData<OrdenLinea | undefined>(CLAVES.ordenLinea, anterior);
    throw error;
  }
}
