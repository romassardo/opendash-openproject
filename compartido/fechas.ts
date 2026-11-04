// Fechas 'YYYY-MM-DD' en hora argentina: cálculo de días corridos y laborables (lunes a viernes).

const ZONA = 'America/Argentina/Buenos_Aires';
const MS_DIA = 86_400_000;
const DIAS_LABORABLES_SEMANA = 5;

const formatoFechaArgentina = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Fecha de hoy en Buenos Aires. */
export function hoyArgentina(ahora: Date = new Date()): string {
  return formatoFechaArgentina.format(ahora);
}

/** Día (en Buenos Aires) de un instante ISO; '' si no es una fecha válida. */
export function fechaArgentina(instante: string): string {
  const fecha = new Date(instante);
  return Number.isNaN(fecha.getTime()) ? '' : formatoFechaArgentina.format(fecha);
}

export const aUtc = (fecha: string): Date => new Date(`${fecha}T00:00:00Z`);

/** Días corridos de `desde` a `hasta` (`hasta − desde`). */
export const diasEntre = (desde: string, hasta: string): number => Math.round((aUtc(hasta).getTime() - aUtc(desde).getTime()) / MS_DIA);

export function sumarDias(fecha: string, dias: number): string {
  return new Date(aUtc(fecha).getTime() + dias * MS_DIA).toISOString().slice(0, 10);
}

/** Lunes y domingo de la semana de `hoy`. */
export function semanaDe(hoy: string): { lunes: string; domingo: string } {
  const desdeLunes = (aUtc(hoy).getUTCDay() + 6) % 7;
  const lunes = sumarDias(hoy, -desdeLunes);
  return { lunes, domingo: sumarDias(lunes, 6) };
}

/** Todos los días de `desde` a `hasta`, ambos incluidos; vacío si `hasta < desde`. */
export function rangoDias(desde: string, hasta: string): string[] {
  const total = diasEntre(desde, hasta) + 1;
  return Array.from({ length: Math.max(0, total) }, (_, i) => sumarDias(desde, i));
}

/** Días de lunes a viernes entre `desde` y `hasta`, ambos incluidos; 0 si `hasta < desde`. */
export function diasLaborables(desde: string, hasta: string): number {
  const total = diasEntre(desde, hasta) + 1;
  if (total <= 0) return 0;
  const semanasEnteras = Math.floor(total / 7);
  const inicio = aUtc(desde).getUTCDay(); // 0 = domingo
  let laborables = semanasEnteras * DIAS_LABORABLES_SEMANA;
  for (let i = 0; i < total % 7; i += 1) {
    const dia = (inicio + i) % 7;
    if (dia !== 0 && dia !== 6) laborables += 1;
  }
  return laborables;
}

/** Mes de una fecha, 'YYYY-MM'. */
export const mesDe = (fecha: string): string => fecha.slice(0, 7);

const esFinDeSemana = (fecha: string): boolean => {
  const dia = aUtc(fecha).getUTCDay();
  return dia === 0 || dia === 6;
};

/** El día laborable estrictamente posterior a `fecha`. */
export function siguienteLaborable(fecha: string): string {
  let siguiente = sumarDias(fecha, 1);
  while (esFinDeSemana(siguiente)) siguiente = sumarDias(siguiente, 1);
  return siguiente;
}

/** `n` (≥ 0) días laborables después de `fecha`; si `fecha` cae en fin de semana, se cuenta desde el lunes siguiente. */
export function sumarLaborables(fecha: string, n: number): string {
  let actual = esFinDeSemana(fecha) ? siguienteLaborable(fecha) : fecha;
  for (let i = 0; i < n; i += 1) actual = siguienteLaborable(actual);
  return actual;
}

const formatoDiaMesCorto = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** «19 oct». */
export const diaMesCorto = (fecha: string): string => formatoDiaMesCorto.format(aUtc(fecha)).replace(/\./g, '').trim();

/** Medianoche argentina (UTC−3) del día `fecha`. */
export const instanteArgentino = (fecha: string): Date => new Date(`${fecha}T00:00:00-03:00`);

/** `true` si es 'YYYY-MM-DD' y el día existe en el calendario. */
export function esFechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const fecha = aUtc(texto);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}
