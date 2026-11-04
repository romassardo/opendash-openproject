import type { Catalogo } from '../../compartido/tipos.js';
import { calendarioDe, sumarHabiles } from '../../compartido/calendarioOp.js';
import type { Ventana } from './modelo.js';

// La tarea nueva que se crea desde la línea de tiempo: nace con barra para poder moverla, unirla y completarla. Todo puro.

/** Un día hábil: una tarea recién creada vence el mismo día. */
export const DIAS_TAREA_NUEVA = 1;

/**
 * Inicio y fin de una tarea nueva: hoy (o el comienzo de la ventana, si hoy no se ve), en un solo día hábil del
 * calendario de OpenProject. Si ese día no es hábil, la tarea queda en el hábil siguiente.
 */
export function fechasDeNueva(
  hoy: string, ventana: Pick<Ventana, 'desde' | 'hasta'>, catalogo: Pick<Catalogo, 'semanaNoLaborable' | 'diasNoLaborables'>,
): { inicio: string; fin: string } {
  const cal = calendarioDe(catalogo);
  const base = hoy >= ventana.desde && hoy <= ventana.hasta ? hoy : ventana.desde;
  const inicio = sumarHabiles(base, 0, cal);
  return { inicio, fin: sumarHabiles(inicio, DIAS_TAREA_NUEVA - 1, cal) };
}
