import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { cifrar } from '../seguridad/cifrado.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });

describe('GET /api/personas/:id/avatar', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;
  const ahora = new Date('2026-10-19T12:00:00.000Z');
  const cliente = { avatar: vi.fn() };
  const crearCliente = vi.fn((_token: string) => cliente as unknown as ClienteOp);
  const pedir = (url: string, conSesion = true) =>
    app.inject({ method: 'GET', url, cookies: conSesion ? { od_sesion: sesion } : {} });

  beforeEach(async () => {
    db = abrirDb(':memory:');
    cliente.avatar.mockReset().mockResolvedValue({ tipo: 'image/png', datos: Buffer.from([137, 80, 78, 71]) });
    crearCliente.mockClear();
    app = await crearApp({ config, db, crearCliente, ahora: () => ahora, sync: syncFalso() });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (9, 'ana', 'Ana', 'h', ?, 0, ?)")
      .run(cifrar('token-de-ana', config.claveCifrado), ahora.toISOString());
    sesion = crearSesion(db, 9, ahora);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('sin sesión responde 401 y no llama a OpenProject', async () => {
    const r = await pedir('/api/personas/7/avatar', false);
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ ok: false, codigo: 'no-sesion' });
    expect(cliente.avatar).not.toHaveBeenCalled();
  });

  it('un id inválido es 400 y no llama a OpenProject', async () => {
    for (const id of ['0', 'abc', '07', '1e3']) {
      expect((await pedir(`/api/personas/${id}/avatar`)).statusCode).toBe(400);
    }
    expect(cliente.avatar).not.toHaveBeenCalled();
  });

  it('pide el avatar del id con el token de quien actúa y responde la imagen cacheable en privado', async () => {
    const r = await pedir('/api/personas/7/avatar');
    expect(r.statusCode).toBe(200);
    expect(crearCliente).toHaveBeenCalledWith('token-de-ana');
    expect(cliente.avatar).toHaveBeenCalledWith(7);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toBe('private, max-age=3600');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.rawPayload).toEqual(Buffer.from([137, 80, 78, 71]));
  });

  it('un tipo que no es imagen responde 404', async () => {
    cliente.avatar.mockResolvedValue({ tipo: 'text/html', datos: Buffer.from('<script>alert(1)</script>') });
    const r = await pedir('/api/personas/7/avatar');
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ ok: false, codigo: 'no-encontrado' });
  });

  it('un avatar svg responde 404', async () => {
    cliente.avatar.mockResolvedValue({ tipo: 'image/svg+xml', datos: Buffer.from('<svg onload="alert(1)"/>') });
    const r = await pedir('/api/personas/7/avatar');
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ ok: false, codigo: 'no-encontrado' });
  });

  it('sin avatar (404 de OpenProject) responde 404', async () => {
    cliente.avatar.mockResolvedValue(null);
    expect((await pedir('/api/personas/7/avatar')).statusCode).toBe(404);
  });

  it('un token rechazado responde token-vencido y lo marca', async () => {
    cliente.avatar.mockRejectedValue(new ErrorOp('no-autorizado', 'x', 401));
    const r = await pedir('/api/personas/7/avatar');
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ codigo: 'token-vencido' });
    expect(db.prepare('select token_vencido from usuarios where id = 9').pluck().get()).toBe(1);
  });

  it('con el token ya vencido responde 401 sin llamar a OpenProject', async () => {
    db.prepare('update usuarios set token_vencido = 1 where id = 9').run();
    const r = await pedir('/api/personas/7/avatar');
    expect(r.statusCode).toBe(401);
    expect(cliente.avatar).not.toHaveBeenCalled();
  });
});
