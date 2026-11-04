import type { Catalogo } from './tipos.js';

/** Qué días cuentan como hábiles según OpenProject (fines de semana y feriados propios, no los de ArgentinaDatos). */
export interface CalendarioOp { esHabil(fecha: string): boolean }

const DIA_MS = 86_400_000;
/** Tope de días que se miran para hallar uno hábil: con los 7 días de la semana no laborables no habría ninguno. */
const TOPE_DIAS = 366;
const aMs = (f: string): number => Date.parse(`${f}T00:00:00Z`);
const aFecha = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function calendarioDe(catalogo: Pick<Catalogo, 'semanaNoLaborable' | 'diasNoLaborables'>): CalendarioOp {
  const semana = new Set(catalogo.semanaNoLaborable);
  const dias = new Set(catalogo.diasNoLaborables);
  return { esHabil: (fecha) => !semana.has(new Date(aMs(fecha)).getUTCDay()) && !dias.has(fecha) };
}

/** El día hábil estrictamente posterior a `fecha`. */
export function siguienteHabil(fecha: string, cal: CalendarioOp): string {
  let ms = aMs(fecha) + DIA_MS;
  for (let i = 0; i < TOPE_DIAS; i++, ms += DIA_MS) {
    if (cal.esHabil(aFecha(ms))) return aFecha(ms);
  }
  throw new Error(`El calendario de OpenProject no tiene ningún día hábil en el año siguiente al ${fecha}. Revisá los días no laborables.`);
}

/** El día hábil estrictamente anterior a `fecha`. */
export function anteriorHabil(fecha: string, cal: CalendarioOp): string {
  let ms = aMs(fecha) - DIA_MS;
  for (let i = 0; i < TOPE_DIAS; i++, ms -= DIA_MS) {
    if (cal.esHabil(aFecha(ms))) return aFecha(ms);
  }
  throw new Error(`El calendario de OpenProject no tiene ningún día hábil en el año anterior al ${fecha}. Revisá los días no laborables.`);
}

/** Resta `n` (>= 0) días hábiles; si `fecha` no es hábil, cuenta desde el hábil anterior. */
export function restarHabiles(fecha: string, n: number, cal: CalendarioOp): string {
  let actual = cal.esHabil(fecha) ? fecha : anteriorHabil(fecha, cal);
  for (let i = 0; i < n; i++) actual = anteriorHabil(actual, cal);
  return actual;
}

/** Suma `n` (>= 0) días hábiles; si `fecha` no es hábil, cuenta desde el hábil siguiente. */
export function sumarHabiles(fecha: string, n: number, cal: CalendarioOp): string {
  let actual = cal.esHabil(fecha) ? fecha : siguienteHabil(fecha, cal);
  for (let i = 0; i < n; i++) actual = siguienteHabil(actual, cal);
  return actual;
}

/** Días hábiles entre dos fechas, ambas incluidas; 0 si `hasta < desde`. */
export function habilesEntre(desde: string, hasta: string, cal: CalendarioOp): number {
  let n = 0;
  for (let ms = aMs(desde); ms <= aMs(hasta); ms += DIA_MS) if (cal.esHabil(aFecha(ms))) n++;
  return n;
}
