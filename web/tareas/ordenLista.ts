import type { Catalogo, Tarea } from '../../compartido/tipos.js';

export type OrdenLista = 'vencimiento' | 'prioridad';

export const ORDEN_INICIAL: OrdenLista = 'vencimiento';

export const esOrdenLista = (valor: unknown): valor is OrdenLista => valor === 'vencimiento' || valor === 'prioridad';

const porTitulo = (a: Tarea, b: Tarea): number =>
  a.titulo.localeCompare(b.titulo, 'es', { sensitivity: 'base' }) || a.id - b.id;

/** Fin ascendente; las tareas sin fin quedan al final. */
function porFin(a: Tarea, b: Tarea): number {
  if (a.fin === b.fin) return 0;
  if (a.fin === null) return 1;
  if (b.fin === null) return -1;
  return a.fin < b.fin ? -1 : 1;
}

/** Orden dentro de un grupo: vencimiento (fin, luego título) o prioridad (altas primero, luego fin y título). */
export function ordenarTareas(tareas: Tarea[], orden: OrdenLista, catalogo: Catalogo): Tarea[] {
  const altas = new Set(catalogo.prioridades.filter((p) => p.alta).map((p) => p.id));
  const esAlta = (t: Tarea): number => (altas.has(t.prioridadId) ? 0 : 1);
  return [...tareas].sort((a, b) => {
    const prioridad = orden === 'prioridad' ? esAlta(a) - esAlta(b) : 0;
    return prioridad || porFin(a, b) || porTitulo(a, b);
  });
}
