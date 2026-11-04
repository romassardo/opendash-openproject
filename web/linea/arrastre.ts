import type { Tarea } from '../../compartido/tipos.js';
import { diasEntre, sumarDias } from '../fechas.js';

// Cuentas de los gestos sobre una barra: qué fechas quedan al mover o estirar. Todo puro.

export type Gesto = 'mover' | 'inicio' | 'fin';
export interface FechasBarra { inicio: string | null; fin: string | null }

/** Días enteros que representa un desplazamiento en píxeles (al día más cercano). */
export const deltaDiasDe = (px: number, pxPorDia: number): number => Math.round(px / pxPorDia) || 0;

const mayor = (a: string, b: string): string => (a > b ? a : b);
const menor = (a: string, b: string): string => (a < b ? a : b);

/**
 * Fechas que quedan tras aplicar `gesto` con `deltaDias` a la tarea. Mover corre las dos fechas; estirar corre un borde
 * sin dejar la duración por debajo de un día. Un hito (`esHito`) solo se mueve. Con una sola fecha, mover corre esa y
 * estirar completa la que falta. Si el gesto no cambia nada, devuelve las fechas tal como estaban.
 */
export function fechasTrasGesto(tarea: Pick<Tarea, 'inicio' | 'fin'>, gesto: Gesto, deltaDias: number, esHito = false): FechasBarra {
  return calcular(tarea, gesto, deltaDias, esHito);
}

function calcular(tarea: Pick<Tarea, 'inicio' | 'fin'>, gesto: Gesto, deltaDias: number, esHito: boolean): FechasBarra {
  const { inicio, fin } = tarea;
  const igual: FechasBarra = { inicio, fin };
  if (inicio === null && fin === null) return igual;
  if (deltaDias === 0 || (esHito && gesto !== 'mover')) return igual;
  if (gesto === 'mover') {
    return { inicio: inicio === null ? null : sumarDias(inicio, deltaDias), fin: fin === null ? null : sumarDias(fin, deltaDias) };
  }
  // Una tarea con una sola fecha es una barra de un día en esa fecha.
  const desde = (inicio ?? fin)!;
  const hasta = (fin ?? inicio)!;
  const nuevo = gesto === 'inicio'
    ? { inicio: menor(sumarDias(desde, deltaDias), hasta), fin: hasta }
    : { inicio: desde, fin: mayor(sumarDias(hasta, deltaDias), desde) };
  return diasEntre(nuevo.inicio, desde) === 0 && diasEntre(nuevo.fin, hasta) === 0 ? igual : nuevo;
}
