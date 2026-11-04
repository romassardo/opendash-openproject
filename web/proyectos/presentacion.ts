import { aUtc, diasEntre } from '../fechas.js';
import type { Tono } from '../ui/tonos.js';

// Textos de la pantalla Proyectos. `hoy` es 'YYYY-MM-DD' en hora argentina.

const formatoDiaMes = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** '23 oct' (con el año si no es el actual). */
export function fechaCorta(fecha: string, hoy: string): string {
  const texto = formatoDiaMes.format(aUtc(fecha)).replace(/\./g, '').trim();
  return fecha.slice(0, 4) === hoy.slice(0, 4) ? texto : `${texto} ${fecha.slice(0, 4)}`;
}

const dias = (n: number): string => `${n} ${n === 1 ? 'día' : 'días'}`;

/** «23 oct · en 4 días», «23 oct · hoy» o «20 oct · vencido hace 2 días». */
export function textoHito(fecha: string, hoy: string): string {
  const faltan = diasEntre(hoy, fecha);
  const cuando = faltan === 0 ? 'hoy' : faltan > 0 ? `en ${dias(faltan)}` : `vencido hace ${dias(-faltan)}`;
  return `${fechaCorta(fecha, hoy)} · ${cuando}`;
}

/** Color de la píldora según el estado que OpenProject le da al proyecto (`undefined`: sin tono). */
const TONO_ESTADO_OP: Record<string, Tono> = {
  on_track: 'verde',
  at_risk: 'naranja',
  off_track: 'rosa',
  not_started: 'indigo',
  finished: 'turquesa',
};

export const tonoDeEstadoOp = (clave: string | null): Tono | undefined => (clave === null ? undefined : TONO_ESTADO_OP[clave]);

/** Markdown sin marcas, en una sola línea de texto corrido (el recorte a dos líneas lo hace el CSS). */
export function textoPlano(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|(?<![\p{L}\p{N}])_)(.+?)\1(?![\p{L}\p{N}])/gu, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
