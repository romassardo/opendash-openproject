import { describe, expect, it } from 'vitest';
import { cargarConfig, entornoDeArranque } from './config.js';

const base = { OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') };

describe('cargarConfig', () => {
  it('usa valores por defecto', () => {
    const c = cargarConfig(base);
    expect(c).toMatchObject({ puerto: 5174, host: '0.0.0.0', openprojectUrl: 'http://op.test', rutaDb: './datos/opendash.db', produccion: false });
    expect(c.claveCifrado.length).toBe(32);
  });
  it('falla con mensaje claro si falta la clave de cifrado', () => {
    expect(() => cargarConfig({ OPENPROJECT_URL: 'http://op.test' })).toThrow(/OPENDASH_CLAVE_CIFRADO/);
  });
  it('falla si la clave no mide 32 bytes', () => {
    expect(() => cargarConfig({ ...base, OPENDASH_CLAVE_CIFRADO: 'corta' })).toThrow(/32 bytes/);
  });
  it('quita la barra final de la URL de OpenProject', () => {
    expect(cargarConfig({ ...base, OPENPROJECT_URL: 'http://op.test/' }).openprojectUrl).toBe('http://op.test');
  });
});

describe('calendario', () => {
  it('lee los orígenes de prueba separados por coma y rechaza los que no son un origen', () => {
    expect(cargarConfig(base).icsOrigenesPrueba).toEqual([]);
    expect(cargarConfig({ ...base, OPENDASH_ICS_ORIGENES_PRUEBA: 'http://127.0.0.1:5198, https://x.test' }).icsOrigenesPrueba).toEqual(['http://127.0.0.1:5198', 'https://x.test']);
    for (const malo of ['http://127.0.0.1:5198/ruta', 'http://127.0.0.1:5198/', 'ftp://x.test', 'x.test', 'http://u:p@x.test']) {
      expect(() => cargarConfig({ ...base, OPENDASH_ICS_ORIGENES_PRUEBA: malo })).toThrow(/OPENDASH_ICS_ORIGENES_PRUEBA/);
    }
  });
  it('la fuente de feriados tiene valor por defecto', () => {
    expect(cargarConfig(base).feriadosUrl).toBe('https://api.argentinadatos.com/v1/feriados');
    expect(cargarConfig({ ...base, OPENDASH_FERIADOS_URL: 'http://f.test/x' }).feriadosUrl).toBe('http://f.test/x');
  });
});

describe('reloj de prueba', () => {
  it('sin OPENDASH_AHORA_PRUEBA no hay desfase', () => {
    expect(cargarConfig(base).desfaseRelojMs).toBe(0);
  });
  it('con una fecha, el desfase lleva el reloj hasta ella', () => {
    const antes = Date.now();
    const objetivo = antes - 3 * 86_400_000;
    const { desfaseRelojMs } = cargarConfig({ ...base, OPENPROJECT_URL: 'http://localhost:8090', OPENDASH_AHORA_PRUEBA: new Date(objetivo).toISOString() });
    expect(Math.abs(antes + desfaseRelojMs - objetivo)).toBeLessThan(5_000);
  });
  it('el reloj de prueba solo se acepta con un OpenProject local', () => {
    const reloj = { OPENDASH_AHORA_PRUEBA: '2026-10-24T12:00:00-03:00' };
    for (const url of ['http://localhost:8090', 'http://127.0.0.1:8090']) {
      expect(() => cargarConfig({ ...base, OPENPROJECT_URL: url, ...reloj })).not.toThrow();
    }
    for (const url of ['http://192.0.2.10:8080', 'http://op.test', 'http://localhost.evil.test']) {
      expect(() => cargarConfig({ ...base, OPENPROJECT_URL: url, ...reloj })).toThrow(/OPENDASH_AHORA_PRUEBA.*local/);
    }
  });
  it('rechaza una fecha inválida', () => {
    expect(() => cargarConfig({ ...base, OPENDASH_AHORA_PRUEBA: 'ayer' })).toThrow(/OPENDASH_AHORA_PRUEBA/);
  });
});

describe('entornoDeArranque (npm start pasa --produccion)', () => {
  it('con --produccion y sin NODE_ENV corre en producción', () => {
    expect(cargarConfig(entornoDeArranque(base, ['--produccion'])).produccion).toBe(true);
  });
  it('un NODE_ENV explícito (en el entorno o en el .env) manda', () => {
    expect(cargarConfig(entornoDeArranque({ ...base, NODE_ENV: 'development' }, ['--produccion'])).produccion).toBe(false);
  });
  it('sin --produccion (npm run dev) no cambia nada', () => {
    expect(cargarConfig(entornoDeArranque(base, [])).produccion).toBe(false);
    expect(entornoDeArranque(base, [])).toBe(base);
  });
});
