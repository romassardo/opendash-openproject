import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
// Servidor falso que hace de Outlook y de ArgentinaDatos (pruebas/e2e/servidor-falso.ts).
import { ORIGEN_FALSO } from './pruebas/e2e/puertos.js';

// Base SQLite temporal y clave generada en cada corrida; nunca se usa un .env. La carpeta se publica en el
// entorno para que los workers (que releen esta configuración) y las ayudas de los specs usen la misma base.
process.env.OPENDASH_E2E_CARPETA ??= mkdtempSync(join(tmpdir(), 'opendash-e2e-'));
const carpeta = process.env.OPENDASH_E2E_CARPETA;
const PUERTO = 5199;
const ORIGEN = `http://127.0.0.1:${PUERTO}`;

const DIA_MS = 86_400_000;

/**
 * Las horas de trabajo no cuentan en fin de semana ni a la medianoche del servidor: el reloj de prueba arranca
 * siempre en el último mediodía hábil que ya pasó (hoy a las 12:00 hora argentina si es de lunes a viernes y ya es
 * más de mediodía; si no, el día hábil anterior) y desde ahí corre solo. Así ni el día de la semana ni la hora de la
 * corrida cambian lo que miden las pruebas del cronómetro. Nunca queda en el futuro: el refresco incremental le pide
 * a OpenProject lo cambiado desde la última sincronización, y con el reloj adelantado no traería nada.
 */
function relojDePrueba(ahora: Date): string {
  const zona = 'America/Argentina/Buenos_Aires';
  for (let atras = 0; ; atras++) {
    const dia = new Date(ahora.getTime() - atras * DIA_MS);
    const semana = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zona }).format(dia);
    if (semana === 'Sat' || semana === 'Sun') continue;
    const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(dia);
    const mediodia = new Date(`${fecha}T12:00:00-03:00`);
    if (mediodia.getTime() <= ahora.getTime()) return mediodia.toISOString();
  }
}

// Se publica en el entorno para que los specs que miran la fecha en el navegador usen el mismo reloj.
process.env.OPENDASH_AHORA_PRUEBA ??= relojDePrueba(new Date());
const reloj = process.env.OPENDASH_AHORA_PRUEBA;

export default defineConfig({
  testDir: 'pruebas/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  globalSetup: './pruebas/e2e/preparacion.ts',
  use: { baseURL: ORIGEN, channel: 'chrome', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node --import tsx pruebas/e2e/servidor-falso.ts',
      url: `${ORIGEN_FALSO}/salud`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: reloj === undefined ? {} : { OPENDASH_AHORA_PRUEBA: reloj },
    },
    // Se compila la web y el servidor y se corre el compilado en producción (así lo sirve el servidor).
    {
      command: 'npm run build && node dist/servidor/servidor/main.js',
      url: `${ORIGEN}/api/salud`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'production',
        OPENPROJECT_URL: 'http://localhost:8090',
        OPENDASH_DB: join(carpeta, 'opendash.db'),
        OPENDASH_CLAVE_CIFRADO: randomBytes(32).toString('base64'),
        OPENDASH_PUERTO: String(PUERTO),
        OPENDASH_HOST: '127.0.0.1',
        OPENDASH_ICS_ORIGENES_PRUEBA: ORIGEN_FALSO,
        OPENDASH_FERIADOS_URL: `${ORIGEN_FALSO}/feriados`,
        ...(reloj === undefined ? {} : { OPENDASH_AHORA_PRUEBA: reloj }),
      },
    },
  ],
});
