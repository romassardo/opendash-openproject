// Servidor falso de las pruebas E2E: hace de Outlook (ICS publicado) y de ArgentinaDatos (feriados).
// Arma el calendario en el momento a partir de la hora actual, así «Ahora» siempre cae sobre la reunión de prueba.
import { createServer } from 'node:http';

import { MINUTOS_REUNION_PROXIMA, PUERTO_FALSO } from './puertos.js';

const PUERTO = PUERTO_FALSO;
const MS_MINUTO = 60_000;
const MS_DIA = 24 * 60 * MS_MINUTO;
/** Argentina es UTC−3 fijo: la hora local sale de correr el reloj tres horas, sin depender de la zona de la máquina. */
const DESFASE_AR_MS = 3 * 60 * MS_MINUTO;

const dos = (n: number): string => String(n).padStart(2, '0');

/** `20261022T153000`: la hora de pared argentina del instante dado (se lee con los campos UTC del reloj corrido). */
function horaArgentina(instante: number): string {
  const f = new Date(instante - DESFASE_AR_MS);
  return `${f.getUTCFullYear()}${dos(f.getUTCMonth() + 1)}${dos(f.getUTCDate())}T${dos(f.getUTCHours())}${dos(f.getUTCMinutes())}00`;
}

/** Mañana a la hora indicada (HHMMSS), hora argentina. */
function mananaA(ahora: number, hhmmss: string): string {
  const f = new Date(ahora - DESFASE_AR_MS + MS_DIA);
  return `${f.getUTCFullYear()}${dos(f.getUTCMonth() + 1)}${dos(f.getUTCDate())}T${hhmmss}`;
}

function evento(uid: string, titulo: string, inicio: string, fin: string, descripcion: string): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@opendash.test`,
    `SUMMARY:${titulo}`,
    `DTSTART;TZID=Argentina Standard Time:${inicio}`,
    `DTEND;TZID=Argentina Standard Time:${fin}`,
    'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
    `DESCRIPTION:${descripcion}`,
    'END:VEVENT',
  ];
}

function armarIcs(ahora: number, conProxima = false): string {
  const lineas = [
    'BEGIN:VCALENDAR',
    'PRODID:-//OpenDash pruebas//Servidor falso//ES',
    'VERSION:2.0',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Argentina Standard Time',
    'BEGIN:STANDARD',
    'DTSTART:16010101T000000',
    'TZOFFSETFROM:-0300',
    'TZOFFSETTO:-0300',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...evento(
      'reunion-de-prueba',
      'Reunión de prueba',
      horaArgentina(ahora - 10 * MS_MINUTO),
      horaArgentina(ahora + 50 * MS_MINUTO),
      'Unirse a la reunión: <https://teams.microsoft.com/l/meetup-join/19%3ameeting_PRUEBA%40thread.v2/0?context=%7b%7d>',
    ),
    ...(conProxima
      ? evento('reunion-proxima', 'Reunión próxima', horaArgentina(ahora + MINUTOS_REUNION_PROXIMA * MS_MINUTO), horaArgentina(ahora + (MINUTOS_REUNION_PROXIMA + 30) * MS_MINUTO), 'Unirse: <https://meet.google.com/pro-xima-aaa>')
      : []),
    ...evento('manana-con-meet', 'Mañana con Meet', mananaA(ahora, '100000'), mananaA(ahora, '110000'), 'Unirse: <https://meet.google.com/abc-defg-hij>'),
    'END:VCALENDAR',
  ];
  return lineas.join('\r\n') + '\r\n';
}

// Con OPENDASH_AHORA_PRUEBA (fin de semana, ver playwright.config.ts) el servidor de la app corre su reloj a otra
// fecha: la reunión «en curso» tiene que seguir ese mismo reloj.
const desfase = process.env.OPENDASH_AHORA_PRUEBA === undefined ? 0 : Date.parse(process.env.OPENDASH_AHORA_PRUEBA) - Date.now();
const ahoraFalsa = (): number => Date.now() + desfase;

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PUERTO}`);
  const ruta = url.pathname;
  if (ruta === '/salud') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (ruta === '/calendario.ics') {
    res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' }).end(armarIcs(ahoraFalsa(), url.searchParams.get('proxima') === '1'));
    return;
  }
  if (ruta === '/proxima.json') {
    // El instante exacto en que empieza la reunión de `?proxima=1` pedida ahora, para que los specs no lean el ICS.
    const inicio = new Date(ahoraFalsa() + MINUTOS_REUNION_PROXIMA * MS_MINUTO).toISOString();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ inicio }));
    return;
  }
  const feriados = /^\/feriados\/(\d{4})$/.exec(ruta);
  if (feriados) {
    const lista = [{ fecha: `${feriados[1]}-12-08`, tipo: 'inamovible', nombre: 'Inmaculada Concepción de María' }];
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(lista));
    return;
  }
  res.writeHead(404).end();
});

servidor.listen(PUERTO, '127.0.0.1');
for (const senal of ['SIGINT', 'SIGTERM'] as const) process.on(senal, () => servidor.close(() => process.exit(0)));
