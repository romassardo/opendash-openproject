import { useCallback, useMemo } from 'react';
import type { Tarea } from '../../compartido/tipos.js';
import { useCatalogo, useEquipo } from '../api/consultas.js';
import { textoVacaciones, tramoQuePisa, vacacionesPorPersona } from './ausencias.js';

/** Dice si la persona de la tarea está de vacaciones en esas fechas (y cuándo), para el aviso de cuidado. */
export function useVacacionesDe(): (tarea: Tarea) => string | null {
  const catalogo = useCatalogo().data;
  const equipo = useEquipo().data;
  const vacaciones = useMemo(() => vacacionesPorPersona(equipo), [equipo]);
  return useCallback((tarea: Tarea): string | null => {
    if (tarea.responsableId === null) return null;
    const tramo = tramoQuePisa(tarea, vacaciones.get(tarea.responsableId));
    if (tramo === null) return null;
    return textoVacaciones(catalogo?.personas.find((p) => p.id === tarea.responsableId)?.nombre ?? `Persona ${tarea.responsableId}`, tramo);
  }, [vacaciones, catalogo]);
}
