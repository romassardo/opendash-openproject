import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { cifrar } from './cifrado.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });

describe('cabeceras de seguridad', () => {
  let db: Database;
  let app: FastifyInstance;
  const ahora = new Date('2026-10-19T12:00:00.000Z');
  const cliente = { avatar: vi.fn() };

  beforeEach(async () => {
    db = abrirDb(':memory:');
    cliente.avatar.mockReset().mockResolvedValue({ tipo: 'image/png', datos: Buffer.from([137, 80, 78, 71]) });
    app = await crearApp({ config, db, crearCliente: () => cliente as unknown as ClienteOp, ahora: () => ahora, sync: syncFalso() });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (9, 'ana', 'Ana', 'h', ?, 0, ?)")
      .run(cifrar('token', config.claveCifrado), ahora.toISOString());
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('todas las respuestas llevan X-Frame-Options DENY y frame-ancestors', async () => {
    for (const url of ['/api/salud', '/api/no-existe']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['referrer-policy']).toBe('same-origin');
      expect(r.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    }
  });

  it('la API responde no-store y respeta el Cache-Control propio de una ruta', async () => {
    const salud = await app.inject({ method: 'GET', url: '/api/salud' });
    expect(salud.headers['cache-control']).toBe('no-store');
    const sesion = { od_sesion: crearSesion(db, 9, ahora) };
    const calendario = await app.inject({ method: 'GET', url: '/api/calendario', cookies: sesion });
    expect(calendario.headers['cache-control']).toBe('no-store');
    const avatar = await app.inject({ method: 'GET', url: '/api/personas/7/avatar', cookies: sesion });
    expect(avatar.headers['cache-control']).toBe('private, max-age=3600');
  });

  it('el avatar conserva su CSP sandbox', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/personas/7/avatar', cookies: { od_sesion: crearSesion(db, 9, ahora) } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(r.headers['x-frame-options']).toBe('DENY');
  });
});
