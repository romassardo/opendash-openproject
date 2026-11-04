import { z } from 'zod';

export interface Config {
  puerto: number;
  host: string;
  openprojectUrl: string;
  claveCifrado: Buffer;
  rutaDb: string;
  produccion: boolean;
  /** Orígenes (sin ruta) que se aceptan además de Outlook; solo para pruebas. */
  icsOrigenesPrueba: string[];
  feriadosUrl: string;
  /** Cuánto se corre el reloj del servidor (ms); solo para pruebas (OPENDASH_AHORA_PRUEBA). 0 en producción. */
  desfaseRelojMs: number;
}

const esquemaEnv = z.object({
  OPENDASH_PUERTO: z.coerce.number().int().min(1).max(65535).default(5174),
  OPENDASH_HOST: z.string().min(1).default('0.0.0.0'),
  OPENPROJECT_URL: z.string().url('OPENPROJECT_URL debe ser una URL válida'),
  OPENDASH_CLAVE_CIFRADO: z
    .string({ error: 'Falta OPENDASH_CLAVE_CIFRADO (32 bytes en base64)' })
    .min(1, 'Falta OPENDASH_CLAVE_CIFRADO (32 bytes en base64)'),
  OPENDASH_DB: z.string().min(1).default('./datos/opendash.db'),
  OPENDASH_ICS_ORIGENES_PRUEBA: z.string().default(''),
  OPENDASH_FERIADOS_URL: z.string().url('OPENDASH_FERIADOS_URL debe ser una URL válida').default('https://api.argentinadatos.com/v1/feriados'),
  OPENDASH_AHORA_PRUEBA: z.string().datetime({ offset: true, error: 'OPENDASH_AHORA_PRUEBA debe ser una fecha ISO con zona' }).optional(),
  NODE_ENV: z.string().optional(),
});

/** Únicos OpenProject contra los que se acepta el reloj de prueba (el de Docker). */
const HOSTS_DE_PRUEBA = new Set(['localhost', '127.0.0.1']);

type Entorno = Record<string, string | undefined>;

/**
 * `npm start` pasa `--produccion`: sin NODE_ENV en el entorno ni en el .env, corre en producción (así en
 * Windows no hace falta escribir `NODE_ENV=` en la línea). Un NODE_ENV explícito siempre manda.
 */
export function entornoDeArranque(env: Entorno, argumentos: readonly string[]): Entorno {
  if (!argumentos.includes('--produccion') || env.NODE_ENV !== undefined) return env;
  return { ...env, NODE_ENV: 'production' };
}

function origenesDePrueba(texto: string): string[] {
  const origenes = texto.split(',').map((o) => o.trim()).filter((o) => o !== '');
  for (const origen of origenes) {
    let ok = false;
    try {
      const u = new URL(origen);
      ok = (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === origen;
    } catch {
      ok = false;
    }
    if (!ok) throw new Error(`Configuración inválida: OPENDASH_ICS_ORIGENES_PRUEBA: «${origen}» no es un origen (esquema, host y puerto, sin ruta)`);
  }
  return origenes;
}

export function cargarConfig(env: Entorno): Config {
  const parseo = esquemaEnv.safeParse(env);
  if (!parseo.success) {
    const detalle = parseo.error.issues
      .map((i) => `${i.path.join('.') || 'config'}: ${i.message}`)
      .join('; ');
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  const e = parseo.data;
  if (e.OPENDASH_AHORA_PRUEBA !== undefined && !HOSTS_DE_PRUEBA.has(new URL(e.OPENPROJECT_URL).hostname)) {
    throw new Error('Configuración inválida: OPENDASH_AHORA_PRUEBA (reloj corrido) solo se acepta con un OpenProject local (localhost o 127.0.0.1), nunca contra el real');
  }
  const claveCifrado = Buffer.from(e.OPENDASH_CLAVE_CIFRADO, 'base64');
  if (claveCifrado.length !== 32) {
    throw new Error('OPENDASH_CLAVE_CIFRADO debe tener 32 bytes en base64');
  }
  return {
    puerto: e.OPENDASH_PUERTO,
    host: e.OPENDASH_HOST,
    openprojectUrl: e.OPENPROJECT_URL.replace(/\/+$/, ''),
    claveCifrado,
    rutaDb: e.OPENDASH_DB,
    produccion: e.NODE_ENV === 'production',
    icsOrigenesPrueba: origenesDePrueba(e.OPENDASH_ICS_ORIGENES_PRUEBA),
    feriadosUrl: e.OPENDASH_FERIADOS_URL,
    desfaseRelojMs: e.OPENDASH_AHORA_PRUEBA === undefined ? 0 : Date.parse(e.OPENDASH_AHORA_PRUEBA) - Date.now(),
  };
}
