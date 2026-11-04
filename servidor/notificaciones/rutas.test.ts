import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notificacion } from '../../compartido/tipos.js';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { cifrar } from '../seguridad/cifrado.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });

const notificacion = (id: number, leida: boolean, creada: string): Notificacion => ({
  id, leida, motivo: 'assigned', tareaId: 100 + id, titulo: `Tarea ${id}`, creada, actorId: 3,
});

describe('API de notificaciones', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesionAna: string;
  let sesionBruno: string;
  const ahora = new Date('2026-10-19T12:00:00.000Z');
  const sync = syncFalso();
  const clienteAna = { notificaciones: vi.fn(), marcarLeida: vi.fn(), marcarLeidas: vi.fn() };
  const clienteBruno = { notificaciones: vi.fn(), marcarLeida: vi.fn(), marcarLeidas: vi.fn() };
  const crearCliente = vi.fn((token: string) => (token === 'token-de-bruno' ? clienteBruno : clienteAna) as unknown as ClienteOp);
  const conSesion = (metodo: 'GET' | 'POST', url: string, sesion = sesionAna) =>
    app.inject({ method: metodo, url, cookies: { od_sesion: sesion } });

  const nuevoUsuario = (id: number, login: string, token: string): string => {
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (?, ?, ?, 'h', ?, 0, ?)")
      .run(id, login, login, cifrar(token, config.claveCifrado), ahora.toISOString());
    return crearSesion(db, id, ahora);
  };

  beforeEach(async () => {
    db = abrirDb(':memory:');
    for (const c of [clienteAna, clienteBruno]) Object.values(c).forEach((f) => f.mockReset());
    crearCliente.mockClear();
    clienteAna.notificaciones.mockResolvedValue([]);
    clienteBruno.notificaciones.mockResolvedValue([]);
    app = await crearApp({ config, db, crearCliente, ahora: () => ahora, sync });
    sesionAna = nuevoUsuario(9, 'ana', 'token-de-ana');
    sesionBruno = nuevoUsuario(10, 'bruno', 'token-de-bruno');
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe('sin sesión', () => {
    it('GET responde 401', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/notificaciones' });
      expect(r.statusCode).toBe(401);
    });

    it('POST leída responde 401 y no llama a OpenProject', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/notificaciones/5/leida' });
      expect(r.statusCode).toBe(401);
      expect(clienteAna.marcarLeida).not.toHaveBeenCalled();
    });

    it('POST leidas responde 401 y no llama a OpenProject', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/notificaciones/leidas', payload: { ids: [5] } });
      expect(r.statusCode).toBe(401);
      expect(clienteAna.marcarLeidas).not.toHaveBeenCalled();
    });
  });

  describe('listar', () => {
    it('ordena no leídas primero, luego las más nuevas, y corta en 50', async () => {
      // 60 notificaciones: ids 1..60, con fechas crecientes; las múltiplos de 3 están leídas.
      const todas = Array.from({ length: 60 }, (_, i) =>
        notificacion(i + 1, (i + 1) % 3 === 0, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()),
      );
      clienteAna.notificaciones.mockResolvedValue([...todas].reverse());
      const r = await conSesion('GET', '/api/notificaciones');
      expect(r.statusCode).toBe(200);
      const datos = r.json().datos as Notificacion[];
      expect(datos).toHaveLength(50);
      const noLeidas = todas.filter((n) => !n.leida).sort((a, b) => b.creada.localeCompare(a.creada));
      const leidas = todas.filter((n) => n.leida).sort((a, b) => b.creada.localeCompare(a.creada));
      expect(datos.map((n) => n.id)).toEqual([...noLeidas, ...leidas].slice(0, 50).map((n) => n.id));
      // 40 no leídas van todas antes que cualquier leída.
      expect(datos.slice(0, 40).every((n) => !n.leida)).toBe(true);
      expect(datos.slice(40).every((n) => n.leida)).toBe(true);
    });

    it('una leída más nueva queda detrás de una no leída más vieja', async () => {
      clienteAna.notificaciones.mockResolvedValue([
        notificacion(1, true, '2026-10-19T10:00:00Z'),
        notificacion(2, false, '2026-10-01T10:00:00Z'),
      ]);
      const r = await conSesion('GET', '/api/notificaciones');
      expect((r.json().datos as Notificacion[]).map((n) => n.id)).toEqual([2, 1]);
    });

    it('usa el token de quien actúa', async () => {
      clienteAna.notificaciones.mockResolvedValue([notificacion(1, false, '2026-10-19T10:00:00Z')]);
      clienteBruno.notificaciones.mockResolvedValue([notificacion(2, false, '2026-10-19T10:00:00Z')]);
      const deAna = await conSesion('GET', '/api/notificaciones', sesionAna);
      const deBruno = await conSesion('GET', '/api/notificaciones', sesionBruno);
      expect((deAna.json().datos as Notificacion[]).map((n) => n.id)).toEqual([1]);
      expect((deBruno.json().datos as Notificacion[]).map((n) => n.id)).toEqual([2]);
      expect(crearCliente).toHaveBeenCalledWith('token-de-ana');
      expect(crearCliente).toHaveBeenCalledWith('token-de-bruno');
    });

    it('sin red responde 503 sin-conexion', async () => {
      clienteAna.notificaciones.mockRejectedValue(new ErrorOp('red', 'caído'));
      const r = await conSesion('GET', '/api/notificaciones');
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'sin-conexion' });
    });

    it('con el token vencido en OpenProject responde 401 token-vencido', async () => {
      clienteAna.notificaciones.mockRejectedValue(new ErrorOp('no-autorizado', 'x'));
      const r = await conSesion('GET', '/api/notificaciones');
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject({ codigo: 'token-vencido' });
    });

    it('un error inesperado responde 500 interno', async () => {
      clienteAna.notificaciones.mockRejectedValue(new Error('boom'));
      const r = await conSesion('GET', '/api/notificaciones');
      expect(r.statusCode).toBe(500);
      expect(r.json()).toMatchObject({ codigo: 'interno' });
    });
  });

  describe('marcar leída', () => {
    it('llama al cliente del usuario con el id y responde null', async () => {
      clienteBruno.marcarLeida.mockResolvedValue(undefined);
      const r = await conSesion('POST', '/api/notificaciones/77/leida', sesionBruno);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, datos: null });
      expect(clienteBruno.marcarLeida).toHaveBeenCalledWith(77);
      expect(clienteAna.marcarLeida).not.toHaveBeenCalled();
    });

    it.each(['0', 'abc', '01', '-3', '12345678901'])('rechaza el id inválido %s con 400', async (id) => {
      const r = await conSesion('POST', `/api/notificaciones/${id}/leida`);
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'validacion' });
      expect(clienteAna.marcarLeida).not.toHaveBeenCalled();
    });

    it('sin red responde 503 sin-conexion', async () => {
      clienteAna.marcarLeida.mockRejectedValue(new ErrorOp('red', 'caído'));
      const r = await conSesion('POST', '/api/notificaciones/5/leida');
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'sin-conexion' });
    });

    it('si OpenProject no la encuentra responde 404', async () => {
      clienteAna.marcarLeida.mockRejectedValue(new ErrorOp('no-encontrado', 'x'));
      const r = await conSesion('POST', '/api/notificaciones/5/leida');
      expect(r.statusCode).toBe(404);
    });
  });

  describe('marcar varias leídas', () => {
    const enviar = (payload: unknown, sesion = sesionAna) =>
      app.inject({ method: 'POST', url: '/api/notificaciones/leidas', cookies: { od_sesion: sesion }, payload: payload as object });

    it('marca todos los ids con un solo llamado al cliente del usuario', async () => {
      clienteBruno.marcarLeidas.mockResolvedValue([]);
      const r = await enviar({ ids: [4, 5, 6] }, sesionBruno);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, datos: { fallidas: [] } });
      expect(clienteBruno.marcarLeidas).toHaveBeenCalledTimes(1);
      expect(clienteBruno.marcarLeidas).toHaveBeenCalledWith([4, 5, 6]);
      expect(clienteAna.marcarLeidas).not.toHaveBeenCalled();
    });

    it('marcar varias leídas devuelve las que fallaron', async () => {
      clienteAna.marcarLeidas.mockResolvedValue([5]);
      const r = await enviar({ ids: [4, 5] });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, datos: { fallidas: [5] } });
    });

    it.each([
      ['sin ids', {}],
      ['lista vacía', { ids: [] }],
      ['más de 50', { ids: Array.from({ length: 51 }, (_, i) => i + 1) }],
      ['id cero', { ids: [0] }],
      ['id negativo', { ids: [-3] }],
      ['id decimal', { ids: [1.5] }],
      ['id como texto', { ids: ['7'] }],
      ['id repetido', { ids: [7, 7] }],
      ['campo de más', { ids: [7], otro: 1 }],
    ])('rechaza %s con 400', async (_nombre, cuerpo) => {
      const r = await enviar(cuerpo);
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'validacion' });
      expect(clienteAna.marcarLeidas).not.toHaveBeenCalled();
    });

    it('sin red responde 503 sin-conexion', async () => {
      clienteAna.marcarLeidas.mockRejectedValue(new ErrorOp('red', 'caído'));
      const r = await enviar({ ids: [5] });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'sin-conexion' });
    });
  });
});
