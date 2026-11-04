// Utilidades compartidas por el preparador del OpenProject de prueba y las pruebas de integración.
// Solo habla con el contenedor local (http://localhost:8090): nunca con el OpenProject real.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const URL_OP_PRUEBA = 'http://localhost:8090';
export const ARCHIVO_COMPOSE = fileURLToPath(new URL('../docker-compose.prueba.yml', import.meta.url));

const PATRON_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/;

/** Lanza si la URL no es el Docker local: ningún script ni prueba habla con un OpenProject real. */
export function asegurarLocal(url: string): void {
  if (!PATRON_LOCAL.test(url)) throw new Error(`Solo se habla con el OpenProject de Docker local (http://localhost:<puerto>), no con ${url}`);
}

/** Corre código Ruby dentro del contenedor con `rails runner -` y devuelve la salida. */
export function ejecutarRails(ruby: string): string {
  asegurarLocal(URL_OP_PRUEBA); // el contenedor es siempre el local
  return execFileSync(
    'docker',
    ['compose', '-f', ARCHIVO_COMPOSE, 'exec', '-T', 'openproject', 'bash', '-lc', 'cd /app && bundle exec rails runner -'],
    { input: ruby, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

/** Valor de una línea `CLAVE=valor` impresa por un script Ruby. */
export function lineaDe(salida: string, clave: string): string {
  const linea = salida.split(/\r?\n/).find((l) => l.startsWith(`${clave}=`));
  if (linea === undefined) throw new Error(`La salida de rails runner no trae ${clave}:\n${salida.slice(-2000)}`);
  return linea.slice(clave.length + 1).trim();
}

export async function esperarOp(url = URL_OP_PRUEBA, limiteMs = 10 * 60_000): Promise<void> {
  asegurarLocal(url);
  const fin = Date.now() + limiteMs;
  for (;;) {
    try {
      const res = await fetch(`${url}/api/v3`, { signal: AbortSignal.timeout(5000) });
      // Sin credenciales /api/v3 responde 401 (hallado en 16.x): 200 o 401 significan listo; un 502/503 es arranque.
      if (res.status === 200 || res.status === 401) return;
    } catch {
      // todavía arrancando
    }
    if (Date.now() > fin) throw new Error('OpenProject de prueba no respondió en 10 minutos');
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Llamada cruda a la API con Basic apikey:token; devuelve estado y cuerpo ya parseado. */
export async function api(
  url: string, token: string, metodo: string, ruta: string, cuerpo?: unknown,
): Promise<{ estado: number; json: any }> {
  asegurarLocal(url); // antes de armar la cabecera con el token
  const res = await fetch(`${url}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Basic ${Buffer.from(`apikey:${token}`).toString('base64')}`,
      Accept: 'application/json',
      ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let json: unknown = null;
  try { json = texto === '' ? null : JSON.parse(texto); } catch { json = texto; }
  return { estado: res.status, json };
}
