import type { Catalogo, Tarea } from '../../compartido/tipos.js';

const CLAVE = 'od:estimar-salteadas';

/**
 * Al arrancar el reloj se pide el «Estimado» si falta. No se pide en hitos (no tienen horas) ni en tareas con
 * subtareas (lo suyo sale de las hijas).
 */
export function pideEstimado(tarea: Tarea, tareas: readonly Tarea[], catalogo: Catalogo): boolean {
  if (tarea.estimacionHoras !== null) return false;
  if (catalogo.tipos.find((t) => t.id === tarea.tipoId)?.esHito === true) return false;
  return !tareas.some((t) => t.madreId === tarea.id);
}

interface Salteadas { dia: string; ids: number[] }

function leer(): Salteadas | null {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (crudo === null) return null;
    const valor = JSON.parse(crudo) as Partial<Salteadas>;
    return typeof valor.dia === 'string' && Array.isArray(valor.ids) ? { dia: valor.dia, ids: valor.ids.filter((id) => typeof id === 'number') } : null;
  } catch {
    return null;
  }
}

/** Las tareas en las que hoy se eligió «Ahora no»: mañana se vuelve a pedir. */
export function salteadasHoy(hoy: string): Set<number> {
  const guardado = leer();
  return new Set(guardado?.dia === hoy ? guardado.ids : []);
}

export function saltear(tareaId: number, hoy: string): void {
  const ids = [...salteadasHoy(hoy), tareaId];
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ dia: hoy, ids: [...new Set(ids)] }));
  } catch {
    // Sin almacenamiento se vuelve a pedir la próxima vez: no es grave.
  }
}
