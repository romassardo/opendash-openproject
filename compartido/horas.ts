import { aUtc, instanteArgentino, sumarDias } from './fechas.js';
import type { Pedazo } from './tipos.js';

export const JORNADA_HORAS_DEFECTO = 8;

/** Lunes a viernes que no está en `feriados`. */
export function esDiaLaborable(dia: string, feriados: ReadonlySet<string>): boolean {
  const semana = aUtc(dia).getUTCDay();
  return semana >= 1 && semana <= 5 && !feriados.has(dia);
}

interface Intervalo { tramoId: number; desde: number; hasta: number }

function aIntervalos(pedazos: readonly Pedazo[], ahora: Date): Intervalo[] {
  return pedazos
    .map((p) => ({ tramoId: p.tramoId, desde: Date.parse(p.desde), hasta: p.hasta === null ? ahora.getTime() : Date.parse(p.hasta) }))
    .filter((i) => i.hasta > i.desde);
}

/** Recorre los intervalos elementales entre bordes y avisa quiénes están activos en cada uno. */
function recorrer(intervalos: readonly Intervalo[], alIntervalo: (largo: number, activos: Intervalo[]) => void): void {
  const bordes = [...new Set(intervalos.flatMap((i) => [i.desde, i.hasta]))].sort((a, b) => a - b);
  for (let k = 0; k < bordes.length - 1; k += 1) {
    const a = bordes[k] as number;
    const b = bordes[k + 1] as number;
    const activos = intervalos.filter((i) => i.desde <= a && i.hasta >= b);
    if (activos.length > 0) alIntervalo(b - a, activos);
  }
}

/** Milisegundos de cada tramo: cada uno cuenta su tiempo entero, aunque corra junto con otros. */
export function msPropios(pedazos: readonly Pedazo[], ahora: Date): Map<number, number> {
  const resultado = new Map<number, number>();
  for (const i of aIntervalos(pedazos, ahora)) resultado.set(i.tramoId, (resultado.get(i.tramoId) ?? 0) + i.hasta - i.desde);
  return resultado;
}

/** La unión de los intervalos activos: el tiempo de reloj que corrió algo. */
export function msActivosUnion(pedazos: readonly Pedazo[], ahora: Date): number {
  let total = 0;
  recorrer(aIntervalos(pedazos, ahora), (largo) => { total += largo; });
  return total;
}

/** Un tramo cerrado: cuándo terminó, lo contado y lo medido al cerrar (`null` si no se guardó). */
export interface Contado { tramoId: number; fin: string; segundos: number; medidos: number | null }

/**
 * Las horas de reloj del día en `ahora`, lo que pesa contra la jornada: la unión de lo que corrió más lo corregido a
 * mano en los tramos ya cerrados (lo contado menos lo medido; sin lo medido, lo que dicen sus pedazos).
 */
export function msDeReloj(pedazos: readonly Pedazo[], cerrados: readonly Contado[], ahora: Date): number {
  const propios = msPropios(pedazos, ahora);
  const corregido = cerrados
    .filter((c) => Date.parse(c.fin) <= ahora.getTime())
    .reduce((suma, c) => suma + c.segundos * 1000 - (c.medidos === null ? (propios.get(c.tramoId) ?? 0) : c.medidos * 1000), 0);
  return Math.max(0, msActivosUnion(pedazos, ahora) + corregido);
}

/** Cuándo se alcanzó el tope del día; `null` si con lo de `ahora` todavía no. */
export function instanteDelTope(contadoDelDiaMs: number, activosDesdeMs: number, jornadaMs: number, ahora: Date): Date | null {
  const instante = activosDesdeMs + Math.max(0, jornadaMs - contadoDelDiaMs);
  return instante <= ahora.getTime() ? new Date(instante) : null;
}

/** La medianoche argentina que cierra `dia`. */
export const finDelDia = (dia: string): Date => instanteArgentino(sumarDias(dia, 1));

const minutosRedondeados = (segundos: number): number => Math.round(Math.max(0, segundos) / 60);

export function duracionTexto(segundos: number): string {
  const total = minutosRedondeados(segundos);
  const [h, m] = [Math.floor(total / 60), total % 60];
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

export function duracionIso(segundos: number): string {
  const total = Math.max(1, minutosRedondeados(segundos));
  const [h, m] = [Math.floor(total / 60), total % 60];
  return `PT${h > 0 ? `${h}H` : ''}${m > 0 ? `${m}M` : ''}`;
}

export function relojTexto(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
