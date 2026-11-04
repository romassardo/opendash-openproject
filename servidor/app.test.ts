import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp } from './app.js';
import { cargarConfig } from './config.js';
import { abrirDb } from './db/conexion.js';
import { syncFalso } from '../pruebas/fabricas/sync.js';

const base = { OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') };

it('GET /api/salud responde ok', async () => {
  const app = await crearApp({
    config: cargarConfig(base),
    db: abrirDb(':memory:'),
    crearCliente: () => {
      throw new Error('no se usa');
    },
    ahora: () => new Date(),
    sync: syncFalso(),
  });
  const r = await app.inject({ method: 'GET', url: '/api/salud' });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ ok: true, datos: { estado: 'ok' }, desactualizado: false });
});

describe('servido de la web en producción', () => {
  let carpeta: string;
  beforeAll(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'opendash-web-'));
    mkdirSync(join(carpeta, 'assets'));
    writeFileSync(join(carpeta, 'index.html'), '<!doctype html><title>OpenDash</title>');
    writeFileSync(join(carpeta, 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(join(carpeta, 'manifest.webmanifest'), '{"name":"OpenDash"}');
    writeFileSync(join(carpeta, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(join(carpeta, 'sin-conexion.html'), '<!doctype html><title>Sin conexión</title>');
  });
  afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

  const crear = (produccion: boolean, ruta = carpeta) =>
    crearApp({
      config: cargarConfig({ ...base, ...(produccion ? { NODE_ENV: 'production' } : {}) }),
      db: abrirDb(':memory:'),
      crearCliente: () => {
        throw new Error('no se usa');
      },
      ahora: () => new Date(),
      sync: syncFalso(),
      rutaWeb: ruta,
    });

  it('sirve index.html en /tareas/12 sin caché', async () => {
    const app = await crear(true);
    const r = await app.inject({ method: 'GET', url: '/tareas/12' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('<title>OpenDash</title>');
    expect(r.headers['cache-control']).toBe('no-cache');
  });

  it('sirve / con index.html', async () => {
    const app = await crear(true);
    const r = await app.inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.body).toContain('<title>OpenDash</title>');
  });

  it('los archivos con hash de assets/ llevan caché larga', async () => {
    const app = await crear(true);
    const r = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toContain('immutable');
    expect(r.body).toBe('console.log(1)');
  });

  it('la app instalable: manifiesto, service worker y página sin conexión se sirven sin caché larga', async () => {
    const app = await crear(true);
    const manifiesto = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(manifiesto.statusCode).toBe(200);
    expect(manifiesto.headers['content-type']).toContain('application/manifest+json');
    expect(manifiesto.headers['cache-control']).toBe('no-cache');
    const sw = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(sw.statusCode).toBe(200);
    expect(sw.headers['content-type']).toMatch(/(text|application)\/javascript/);
    expect(sw.headers['cache-control']).toBe('no-cache');
    const sinConexion = await app.inject({ method: 'GET', url: '/sin-conexion.html' });
    expect(sinConexion.statusCode).toBe(200);
    expect(sinConexion.body).toContain('Sin conexión');
  });

  it('/api/inexistente responde 404 en JSON, no index.html', async () => {
    const app = await crear(true);
    const r = await app.inject({ method: 'GET', url: '/api/inexistente' });
    expect(r.statusCode).toBe(404);
    expect(r.headers['content-type']).toContain('application/json');
    expect(r.json()).toMatchObject({ ok: false, codigo: 'no-encontrado' });
  });

  it('un POST a una ruta desconocida no devuelve index.html', async () => {
    const app = await crear(true);
    const r = await app.inject({ method: 'POST', url: '/tareas/12' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ ok: false, codigo: 'no-encontrado' });
  });

  it('HEAD en una ruta del navegador responde 200 con HTML', async () => {
    const app = await crear(true);
    const r = await app.inject({ method: 'HEAD', url: '/tareas/12' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
  });

  it.each(['/assets/no-existe.js', '/favicon.ico', '/x.js.map'])('un archivo inexistente (%s) responde 404 JSON', async (url) => {
    const app = await crear(true);
    const r = await app.inject({ method: 'GET', url });
    expect(r.statusCode).toBe(404);
    expect(r.headers['content-type']).toContain('application/json');
    expect(r.json()).toMatchObject({ ok: false, codigo: 'no-encontrado' });
  });

  it('con la web instalada bajo una carpeta assets, index.html sigue sin caché larga', async () => {
    const anidada = join(carpeta, 'assets', 'opendash', 'dist', 'web');
    mkdirSync(join(anidada, 'assets'), { recursive: true });
    writeFileSync(join(anidada, 'index.html'), '<!doctype html><title>Anidada</title>');
    writeFileSync(join(anidada, 'assets', 'a-1.js'), '1');
    const app = await crear(true, anidada);
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.headers['cache-control']).toBe('no-cache');
    const asset = await app.inject({ method: 'GET', url: '/assets/a-1.js' });
    expect(asset.headers['cache-control']).toContain('immutable');
  });

  it('falla al arrancar con un mensaje claro si falta la compilación de la web', async () => {
    await expect(crear(true, join(carpeta, 'no-hay'))).rejects.toThrow('npm run build');
  });

  it('en desarrollo las rutas desconocidas también salen con el sobre JSON', async () => {
    const app = await crear(false);
    const r = await app.inject({ method: 'GET', url: '/api/inexistente' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ ok: false, codigo: 'no-encontrado' });
  });

  it('fuera de producción no sirve la web', async () => {
    const app = await crear(false);
    const r = await app.inject({ method: 'GET', url: '/tareas/12' });
    expect(r.statusCode).toBe(404);
  });
});
