import { cuentaComoReunion } from '../../compartido/calendario.js';
import { instanteArgentino, rangoDias, sumarDias } from '../../compartido/fechas.js';
import type { Reunion } from '../../compartido/tipos.js';

const MS_HORA = 3_600_000;
const redondear = (n: number): number => Math.round(n * 100) / 100;

/** Los tramos de las reuniones que cuentan, recortados al día argentino `dia`, en ms. */
function tramosDelDia(reuniones: Reunion[], dia: string): [number, number][] {
  const desde = instanteArgentino(dia).getTime();
  const hasta = instanteArgentino(sumarDias(dia, 1)).getTime();
  const tramos: [number, number][] = [];
  for (const r of reuniones) {
    if (!cuentaComoReunion(r)) continue;
    const inicio = Math.max(Date.parse(r.inicio), desde);
    const fin = Math.min(Date.parse(r.fin), hasta);
    if (fin > inicio) tramos.push([inicio, fin]);
  }
  return tramos;
}

/** Largo de la unión de los tramos: lo que se pisa cuenta una vez. */
function largoDeLaUnion(tramos: [number, number][]): number {
  const orden = [...tramos].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let hasta = -Infinity;
  for (const [i, f] of orden) {
    const desde = Math.max(i, hasta);
    if (f > desde) total += f - desde;
    hasta = Math.max(hasta, f);
  }
  return total;
}

/** Verdadero si alguna reunión que cuenta tiene a `ahora` entre su inicio (incluido) y su fin (excluido). */
export function enReunion(reuniones: Reunion[], ahora: Date): boolean {
  const t = ahora.getTime();
  return reuniones.some((r) => cuentaComoReunion(r) && Date.parse(r.inicio) <= t && t < Date.parse(r.fin));
}

/**
 * Horas de reunión por semana (clave: el lunes). Por cada día hábil que no sea libre suma la unión de los tramos
 * de ese día argentino, con tope en `valorDia`.
 */
export function horasReunionPorSemana(
  reuniones: Reunion[], lunes: string, semanas: number, valorDia: number, diasLibres: ReadonlySet<string>,
): Record<string, number> {
  const resultado: Record<string, number> = {};
  for (let s = 0; s < semanas; s++) {
    const inicioSemana = sumarDias(lunes, 7 * s);
    let horas = 0;
    for (const dia of rangoDias(inicioSemana, sumarDias(inicioSemana, 4))) {
      if (diasLibres.has(dia)) continue;
      horas += Math.min(largoDeLaUnion(tramosDelDia(reuniones, dia)) / MS_HORA, valorDia);
    }
    resultado[inicioSemana] = redondear(horas);
  }
  return resultado;
}
