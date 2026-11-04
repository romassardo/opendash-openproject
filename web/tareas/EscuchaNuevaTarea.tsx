import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { EVENTO_NUEVA_TAREA } from '../marco/BarraSuperior.js';
import { seccionDe } from '../marco/secciones.js';

/** Estado de navegación con el que se llega a Tareas para abrir el alta rápida. */
export interface EstadoNuevaTarea { nuevaTarea: true }

export const esPedidoDeNuevaTarea = (estado: unknown): boolean =>
  typeof estado === 'object' && estado !== null && (estado as Partial<EstadoNuevaTarea>).nuevaTarea === true;

/** Pantallas que atienden el evento ellas mismas: Tareas abre su alta rápida y la Línea de tiempo, su diálogo. */
const CON_ALTA_PROPIA = new Set(['tareas', 'linea-de-tiempo']);

/**
 * En las demás pantallas, el «+» de la barra superior (o cualquier «Nueva tarea») lleva a Tareas con el
 * alta rápida abierta.
 */
export function EscuchaNuevaTarea(): null {
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const conAltaPropia = CON_ALTA_PROPIA.has(seccionDe(pathname));

  useEffect(() => {
    if (conAltaPropia) return;
    const alPedir = () => {
      const estado: EstadoNuevaTarea = { nuevaTarea: true };
      navegar('/tareas', { state: estado });
    };
    window.addEventListener(EVENTO_NUEVA_TAREA, alPedir);
    return () => window.removeEventListener(EVENTO_NUEVA_TAREA, alPedir);
  }, [conAltaPropia, navegar]);

  return null;
}
