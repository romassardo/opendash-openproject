import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Adjunto } from '../../compartido/tipos.js';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { cifrar } from '../seguridad/cifrado.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const ahora = new Date('2026-10-25T12:00:00.000Z');
const MB = 1024 * 1024;

const adjunto = (id: number, nombre: string, extra: Partial<Adjunto> = {}): Adjunto =>
  ({ id, nombre, bytes: 5, tipo: 'text/plain', autorId: 9, creado: '2026-10-25T10:00:00Z', puedeBorrar: true, ...extra });

describe('API de adjuntos', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;
  const cliente = {
    adjuntos: vi.fn(), adjunto: vi.fn(), puedeAdjuntar: vi.fn(), subirAdjunto: vi.fn(),
    bajarAdjunto: vi.fn(), borrarAdjunto: vi.fn(), maximoAdjunto: vi.fn(),
  };
  const crearCliente = vi.fn((_t: string) => cliente as unknown as ClienteOp);
  const pedir = (metodo: 'GET' | 'POST' | 'DELETE', url: string, extra: { payload?: Buffer | string; tipo?: string } = {}) =>
    app.inject({
      method: metodo, url, cookies: { od_sesion: sesion },
      ...(extra.payload === undefined ? {} : { payload: extra.payload, headers: { 'content-type': extra.tipo ?? 'application/octet-stream' } }),
    });

  beforeEach(async () => {
    db = abrirDb(':memory:');
    Object.values(cliente).forEach((f) => f.mockReset());
    cliente.maximoAdjunto.mockResolvedValue(5 * MB);
    app = await crearApp({ config, db, crearCliente, ahora: () => ahora, sync: syncFalso() });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (9, 'ana', 'Ana', 'h', ?, 0, ?)")
      .run(cifrar('token', config.claveCifrado), ahora.toISOString());
    sesion = crearSesion(db, 9, ahora);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('lista los adjuntos con el permiso y el máximo', async () => {
    cliente.adjuntos.mockResolvedValue([adjunto(1, 'a.txt')]);
    cliente.puedeAdjuntar.mockResolvedValue(true);
    const res = await pedir('GET', '/api/tareas/4/adjuntos');
    expect(res.statusCode).toBe(200);
    expect(res.json().datos).toEqual({ adjuntos: [adjunto(1, 'a.txt')], puedeAdjuntar: true, maximoBytes: 5 * MB });
  });

  it('Reader: puedeAdjuntar false', async () => {
    cliente.adjuntos.mockResolvedValue([]);
    cliente.puedeAdjuntar.mockResolvedValue(false);
    const res = await pedir('GET', '/api/tareas/4/adjuntos');
    expect(res.json().datos.puedeAdjuntar).toBe(false);
  });

  it('sube y responde el adjunto, con el nombre y el tipo del archivo', async () => {
    cliente.subirAdjunto.mockResolvedValue(adjunto(2, 'informe_ñandú.txt'));
    const res = await pedir('POST', `/api/tareas/4/adjuntos?nombre=${encodeURIComponent('informe ñandú.txt')}`, { payload: Buffer.from('hola!'), tipo: 'text/plain; charset=utf-8' });
    expect(res.statusCode).toBe(200);
    expect(res.json().datos.id).toBe(2);
    const [tareaId, nombre, tipo, datos] = cliente.subirAdjunto.mock.calls[0]!;
    expect([tareaId, nombre, tipo]).toEqual([4, 'informe ñandú.txt', 'text/plain']);
    expect((datos as Buffer).toString()).toBe('hola!');
  });

  it('saca del nombre los controles C0, C1 y los de dirección (no hace pasar «factura‮fdp.exe» por PDF)', async () => {
    cliente.subirAdjunto.mockResolvedValue(adjunto(3, 'x'));
    const sucio = 'factura‮fdp.exe‎‏⁦⁩';
    const res = await pedir('POST', `/api/tareas/4/adjuntos?nombre=${encodeURIComponent(sucio)}`, { payload: Buffer.from('x') });
    expect(res.statusCode).toBe(200);
    expect(cliente.subirAdjunto.mock.calls[0]![1]).toBe('facturafdp.exe');
  });

  it('rechaza un archivo más grande que el máximo sin pedirle nada a OpenProject', async () => {
    const res = await pedir('POST', '/api/tareas/4/adjuntos?nombre=x.zip', { payload: Buffer.alloc(7 * MB) });
    expect(res.statusCode).toBe(400);
    expect(res.json().mensaje).toBe('“x.zip” pesa 7 MB y el máximo es 5 MB');
    expect(cliente.subirAdjunto).not.toHaveBeenCalled();
  });

  it('sin sesión una subida da 401 antes de leer el cuerpo', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tareas/4/adjuntos?nombre=x.zip', payload: Buffer.alloc(7 * MB), headers: { 'content-type': 'application/octet-stream' } });
    expect(res.statusCode).toBe(401);
    expect(cliente.subirAdjunto).not.toHaveBeenCalled();
  });

  it('conocido el máximo, una subida más grande se rechaza por su tamaño declarado, sin volver a preguntarle a OpenProject', async () => {
    cliente.adjuntos.mockResolvedValue([]);
    cliente.puedeAdjuntar.mockResolvedValue(true);
    await pedir('GET', '/api/tareas/4/adjuntos');
    cliente.maximoAdjunto.mockClear();
    const res = await pedir('POST', '/api/tareas/4/adjuntos?nombre=x.zip', { payload: Buffer.alloc(6 * MB) });
    expect(res.statusCode).toBe(400);
    expect(res.json().mensaje).toBe('“x.zip” pesa 6 MB y el máximo es 5 MB');
    expect(cliente.maximoAdjunto).not.toHaveBeenCalled();
  });

  it('la descarga se acota al máximo de OpenProject', async () => {
    cliente.adjunto.mockResolvedValue(adjunto(5, 'a.txt'));
    cliente.bajarAdjunto.mockResolvedValue({ tipo: 'text/plain', bytes: Buffer.from('x') });
    await pedir('GET', '/api/adjuntos/5/contenido');
    expect(cliente.bajarAdjunto).toHaveBeenCalledWith(5, 5 * MB);
  });

  it('un PDF se abre en línea sin sandbox (Chrome no carga su visor así) pero con nosniff', async () => {
    cliente.adjunto.mockResolvedValue(adjunto(8, 'f.pdf'));
    cliente.bajarAdjunto.mockResolvedValue({ tipo: 'application/pdf', bytes: Buffer.from('pdf') });
    const res = await pedir('GET', '/api/adjuntos/8/contenido');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-security-policy'])).not.toContain('sandbox');
  });

  it('pide el nombre y rechaza un archivo vacío', async () => {
    expect((await pedir('POST', '/api/tareas/4/adjuntos', { payload: Buffer.from('x') })).statusCode).toBe(400);
    expect((await pedir('POST', '/api/tareas/4/adjuntos?nombre=x.txt', { payload: Buffer.alloc(0) })).statusCode).toBe(400);
  });

  it('un archivo con tipo application/json se sube como cuerpo crudo', async () => {
    cliente.subirAdjunto.mockResolvedValue(adjunto(3, 'd.json'));
    const res = await pedir('POST', '/api/tareas/4/adjuntos?nombre=d.json', { payload: '{"a":1}', tipo: 'application/json' });
    expect(res.statusCode).toBe(200);
    expect((cliente.subirAdjunto.mock.calls[0]![3] as Buffer).toString()).toBe('{"a":1}');
  });

  it('un 403 de OpenProject al subir responde prohibido', async () => {
    cliente.subirAdjunto.mockRejectedValue(new ErrorOp('prohibido', 'x', 403));
    const res = await pedir('POST', '/api/tareas/4/adjuntos?nombre=x.txt', { payload: Buffer.from('x') });
    expect(res.statusCode).toBe(403);
  });

  it('la descarga de un .html es attachment, con nosniff y sandbox', async () => {
    cliente.adjunto.mockResolvedValue(adjunto(5, 'p.html', { tipo: 'text/html' }));
    cliente.bajarAdjunto.mockResolvedValue({ tipo: 'text/html', bytes: Buffer.from('<script>1</script>') });
    const res = await pedir('GET', '/api/adjuntos/5/contenido');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe('sandbox');
  });

  it('el svg también se baja, y una imagen o un PDF se abren en línea', async () => {
    cliente.adjunto.mockResolvedValue(adjunto(5, 'f.svg'));
    cliente.bajarAdjunto.mockResolvedValue({ tipo: 'image/svg+xml', bytes: Buffer.from('<svg/>') });
    expect((await pedir('GET', '/api/adjuntos/5/contenido')).headers['content-disposition']).toMatch(/^attachment;/);
    cliente.adjunto.mockResolvedValue(adjunto(6, 'f.png'));
    cliente.bajarAdjunto.mockResolvedValue({ tipo: 'image/png', bytes: Buffer.from('png') });
    expect((await pedir('GET', '/api/adjuntos/6/contenido')).headers['content-disposition']).toMatch(/^inline;/);
    cliente.bajarAdjunto.mockResolvedValue({ tipo: 'application/pdf; foo=bar', bytes: Buffer.from('pdf') });
    const pdf = await pedir('GET', '/api/adjuntos/6/contenido');
    expect(pdf.headers['content-disposition']).toMatch(/^inline;/);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('el nombre con acentos y comillas llega en filename*', async () => {
    cliente.adjunto.mockResolvedValue(adjunto(7, 'informe "ñandú" (v2).txt'));
    cliente.bajarAdjunto.mockResolvedValue({ tipo: 'text/plain', bytes: Buffer.from('x') });
    const res = await pedir('GET', '/api/adjuntos/7/contenido');
    const cabecera = String(res.headers['content-disposition']);
    expect(cabecera).toContain("filename*=UTF-8''informe%20%22%C3%B1and%C3%BA%22%20%28v2%29.txt");
    const simple = /filename="([^"]*)"/.exec(cabecera);
    expect(simple).not.toBeNull();
    expect(simple![1]).toMatch(/^[\x20-\x7e]*$/);
  });

  it('borra un adjunto; un id mal formado da 400', async () => {
    cliente.borrarAdjunto.mockResolvedValue(undefined);
    expect((await pedir('DELETE', '/api/adjuntos/5')).statusCode).toBe(200);
    expect(cliente.borrarAdjunto).toHaveBeenCalledWith(5);
    expect((await pedir('DELETE', '/api/adjuntos/abc')).statusCode).toBe(400);
  });

  it('sin sesión da 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tareas/4/adjuntos' });
    expect(res.statusCode).toBe(401);
  });
});
