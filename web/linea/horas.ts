import { duracionTexto } from '../../compartido/horas.js';
import type { Tarea } from '../../compartido/tipos.js';

/** Horas decimales en el formato de toda la app («7 h 8 m», «45 m», «8 h»). */
export const horasTexto = (h: number): string => duracionTexto(h * 3600);
// Menos de medio minuto se lee «0 m»: es como no tener horas.
export const conHoras = (h: number | null): number | null => (h !== null && h * 60 >= 0.5 ? h : null);

/** Horas de una tarea como se muestran en la línea y en Tareas: el texto corto, si ya se pasó de lo estimado y una frase para leer. */
export interface Horas { texto: string; pasada: boolean; descripcion: string }

/**
 * Abierta: lo trabajado contra lo estimado («2 h / ~5 h»), o lo que haya de los dos («6 h 10 m», «~5 h»).
 * Cerrada: las trabajadas y, si no hay, la estimación (el equipo solía escribir lo real en «Estimado» al terminar).
 * Null si no hay horas que mostrar.
 */
export function horasDe(tarea: Pick<Tarea, 'estimacionHoras' | 'horasReales'>, cerrada: boolean): Horas | null {
  const est = conHoras(tarea.estimacionHoras);
  const reales = conHoras(tarea.horasReales);
  const trabajadas = (h: number): Horas => ({ texto: horasTexto(h), pasada: false, descripcion: `${horasTexto(h)} trabajadas` });
  const estimadas = (h: number, aprox: boolean): Horas => ({ texto: `${aprox ? '~' : ''}${horasTexto(h)}`, pasada: false, descripcion: `${horasTexto(h)} estimadas` });
  if (cerrada) return reales !== null ? trabajadas(reales) : est === null ? null : estimadas(est, false);
  if (reales !== null && est !== null) {
    return {
      texto: `${horasTexto(reales)} / ~${horasTexto(est)}`,
      pasada: reales > est,
      descripcion: `${horasTexto(reales)} trabajadas de ${horasTexto(est)} estimadas`,
    };
  }
  if (reales !== null) return trabajadas(reales);
  return est === null ? null : estimadas(est, true);
}

/** Las de la barra de la línea: a las cerradas se les suma «✓» («3 h ✓»). */
export function horasDeBarra(tarea: Pick<Tarea, 'estimacionHoras' | 'horasReales'>, cerrada: boolean): Horas | null {
  const horas = horasDe(tarea, cerrada);
  return horas !== null && cerrada ? { ...horas, texto: `${horas.texto} ✓` } : horas;
}
