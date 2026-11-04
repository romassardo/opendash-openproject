import { useMemo } from 'react';
import { useAjustes, useCatalogo, useEquipo, useFeriados, usePausas, useTareas, useYo } from '../api/consultas.js';
import { hoyArgentina } from '../fechas.js';
import { cuentaMia, type EntradaOrdenar } from './logica.js';

/** Todo lo que necesita «Para ordenar»; `null` hasta tener tareas, catálogo, equipo, ajustes, feriados y la persona. */
export function useEntradaOrdenar(): EntradaOrdenar | null {
  const tareas = useTareas().data;
  const catalogo = useCatalogo().data;
  const equipo = useEquipo().data;
  const ajustes = useAjustes().data;
  const feriados = useFeriados().data;
  const pausas = usePausas().data;
  const yoId = useYo().data?.id;
  const hoy = hoyArgentina();
  return useMemo(() => {
    if (!tareas || !catalogo || !equipo || !ajustes || !feriados || yoId === undefined) return null;
    return {
      tareas: tareas.tareas, dependencias: tareas.dependencias, catalogo, miembros: equipo, metricas: ajustes.metricas,
      feriados: new Set(feriados.feriados.map((f) => f.fecha)), yoId, hoy, pausas,
    };
  }, [tareas, catalogo, equipo, ajustes, feriados, yoId, hoy, pausas]);
}

/** El número del menú: cuántas cosas para ordenar son tuyas. `null` mientras algo no cargó (no se muestra ni un «0» que después salte). */
export function useCuentaParaOrdenar(): number | null {
  const entrada = useEntradaOrdenar();
  return useMemo(() => (entrada === null ? null : cuentaMia(entrada)), [entrada]);
}
