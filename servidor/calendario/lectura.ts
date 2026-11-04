import type { FallaCalendario } from '../../compartido/tipos.js';

export const HOSTS_OUTLOOK: readonly string[] = ['outlook.office365.com', 'outlook.office.com', 'outlook.live.com'];

const TIEMPO_MS = 10_000;
const MAX_BYTES = 5_242_880;

/** Host exacto, https y puerto por defecto, sin credenciales; o un origen de prueba idéntico. */
export function enlacePermitido(url: string, origenesPrueba: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username !== '' || u.password !== '') return false;
  if (origenesPrueba.includes(u.origin)) return true;
  return u.protocol === 'https:' && u.port === '' && HOSTS_OUTLOOK.includes(u.hostname);
}

export type ResultadoLectura = { ok: true; texto: string } | { ok: false; falla: FallaCalendario; motivo: string };

export interface OpcionesLectura {
  origenesPrueba: readonly string[];
  fetch?: typeof fetch;
  tiempoMs?: number;
  maxBytes?: number;
}

const caido = (motivo: string): ResultadoLectura => ({ ok: false, falla: 'enlace-caido', motivo });
const sinConexion = (motivo: string): ResultadoLectura => ({ ok: false, falla: 'sin-conexion', motivo });

/** Lee el cuerpo cortando apenas pasa el tope. `null` si lo pasó. */
async function leerAcotado(cuerpo: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (cuerpo === null) return '';
  const lector = cuerpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await lector.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(partes));
}

// Los motivos son fijos: ni el enlace ni el mensaje de la librería de red pasan al registro.
export async function leerCalendario(url: string, o: OpcionesLectura): Promise<ResultadoLectura> {
  if (!enlacePermitido(url, o.origenesPrueba)) return caido('enlace no permitido');
  const maxBytes = o.maxBytes ?? MAX_BYTES;
  try {
    const respuesta = await (o.fetch ?? fetch)(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(o.tiempoMs ?? TIEMPO_MS),
      headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' },
    });
    const { status } = respuesta;
    const soltar = () => respuesta.body?.cancel().catch(() => undefined);
    if (status >= 300 && status < 400) { await soltar(); return caido('redirección'); }
    if ([401, 403, 404, 410].includes(status)) { await soltar(); return caido(`respuesta ${status}`); }
    if (status !== 200) { await soltar(); return sinConexion(`respuesta ${status}`); }
    const declarado = Number(respuesta.headers.get('content-length'));
    if (Number.isFinite(declarado) && declarado > maxBytes) {
      await respuesta.body?.cancel().catch(() => undefined);
      return caido('demasiado grande');
    }
    const texto = await leerAcotado(respuesta.body, maxBytes);
    if (texto === null) return caido('demasiado grande');
    if (!texto.replace(/^﻿/, '').trimStart().startsWith('BEGIN:VCALENDAR')) return caido('no es un calendario');
    return { ok: true, texto };
  } catch {
    return sinConexion('sin respuesta');
  }
}
