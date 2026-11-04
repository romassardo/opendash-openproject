import type { Pausa } from '../../compartido/pausas.js';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';

// Lo que hizo un cambio de la línea, paso por paso: con esto se arma «Deshacer».

export type FechasTarea = { inicio: string | null; fin: string | null };

export type Paso =
  | { tipo: 'fechas'; tareaId: number; titulo: string; antes: FechasTarea; despues: FechasTarea }
  | { tipo: 'union-creada'; dependencia: Dependencia; sucesora: { tareaId: number; titulo: string; antes: FechasTarea; despues: FechasTarea; manualAntes: boolean } }
  | { tipo: 'union-borrada'; dependencia: Dependencia }
  | { tipo: 'orden'; contenedor: string; antes: number[]; despues: number[] }
  | { tipo: 'tarea-creada'; tareaId: number; titulo: string }
  | { tipo: 'pausa-creada'; pausa: Pausa; titulo: string }
  | { tipo: 'pausa-quitada'; pausa: Pausa; titulo: string };

export const mismasFechas = (a: FechasTarea, b: FechasTarea): boolean => a.inicio === b.inicio && a.fin === b.fin;

/** Las tareas de `despues` cuyas fechas cambiaron respecto de `antes` (las que no estaban, no cuentan). */
export function movidasEntre(antes: readonly Tarea[], despues: readonly Tarea[]): Tarea[] {
  const previas = new Map(antes.map((t) => [t.id, t]));
  return despues.filter((t) => {
    const previa = previas.get(t.id);
    return previa !== undefined && !mismasFechas(previa, t);
  });
}
