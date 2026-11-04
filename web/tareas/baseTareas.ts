import { createContext, useContext } from 'react';

/** Pantalla que fija un filtro: las tareas de un proyecto o las de una persona. */
export interface ContextoTareas { tipo: 'proyecto' | 'persona'; id: number }

/** Ruta de la pantalla del contexto; sin contexto, la de siempre (`''`, y el detalle cuelga de `/tareas`). */
export function baseDeContexto(contexto: ContextoTareas | undefined): string {
  if (!contexto) return '';
  return contexto.tipo === 'proyecto' ? `/proyectos/${contexto.id}` : `/equipo/${contexto.id}`;
}

/** Id de una ruta (`/tareas/:id`, `/proyectos/:id`…); `NaN` si no es un número entero positivo escrito tal cual. */
export const idDeRuta = (crudo: string): number => (/^[1-9]\d*$/.test(crudo) ? Number(crudo) : Number.NaN);

/** Ruta del detalle de una tarea dentro de la pantalla que la lista. */
export const rutaDetalle = (base: string, tareaId: number): string => `${base}/tareas/${tareaId}`;

const BaseTareas = createContext('');
export const ProveedorBaseTareas = BaseTareas.Provider;

/** Base de las rutas de detalle de la pantalla actual: el tablero, la lista y los enlaces del panel la usan. */
export const useBaseTareas = (): string => useContext(BaseTareas);
