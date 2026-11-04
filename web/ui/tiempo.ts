const relativo = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' });
const fecha = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' });

const horaMinuto = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** «14:05» en hora argentina; '' si no es una fecha. */
export function horaArgentina(instante: string): string {
  const momento = new Date(instante);
  return Number.isNaN(momento.getTime()) ? '' : horaMinuto.format(momento);
}

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** «ahora», «hace 5 minutos», «ayer»; pasadas unas semanas, la fecha corta. '' si no es una fecha. */
export function tiempoRelativo(instante: string, ahora: Date = new Date()): string {
  const momento = new Date(instante).getTime();
  if (Number.isNaN(momento)) return '';
  const pasado = Math.max(0, ahora.getTime() - momento);
  if (pasado < MIN) return 'ahora';
  if (pasado < HORA) return relativo.format(-Math.floor(pasado / MIN), 'minute');
  if (pasado < DIA) return relativo.format(-Math.floor(pasado / HORA), 'hour');
  if (pasado < 14 * DIA) return relativo.format(-Math.floor(pasado / DIA), 'day');
  return fecha.format(momento);
}
