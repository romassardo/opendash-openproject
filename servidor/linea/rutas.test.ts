import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import type { OrdenLinea } from '../../compartido/linea.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const AHORA = new Date('2026-10-19T12:00:00.000Z');

describe('rutas del orden de la lista', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;

  const pedir = (metodo: 'GET' | 'PUT', url: string, payload?: object, conSesion = true) =>
    app.inject({ method: metodo, url, payload, cookies: conSesion ? { od_sesion: sesion } : {} });

  beforeEach(async () => {
    db = abrirDb(':memory:');
    app = await crearApp({ config, db, crearCliente: () => ({}) as never, ahora: () => AHORA, sync: syncFalso() });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (9,'rmedina','Ramiro','h','t',?)").run(AHORA.toISOString());
    db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (9, 1), (9, 2)').run();
    sesion = crearSesion(db, 9, AHORA);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('guarda el orden y lo devuelve', async () => {
    const r = await pedir('PUT', '/api/linea/orden/1:0', { ids: [5, 3, 9] });
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual({ contenedor: '1:0', ids: [5, 3, 9] });
    expect((await pedir('GET', '/api/linea/orden')).json().datos as OrdenLinea).toEqual({ '1:0': [5, 3, 9] });
  });

  it('un segundo PUT al mismo contenedor reemplaza el orden anterior', async () => {
    await pedir('PUT', '/api/linea/orden/1:0', { ids: [5, 3, 9] });
    await pedir('PUT', '/api/linea/orden/1:0', { ids: [9, 5] });
    expect((await pedir('GET', '/api/linea/orden')).json().datos as OrdenLinea).toEqual({ '1:0': [9, 5] });
  });

  it('no devuelve contenedores de proyectos que la persona no ve', async () => {
    db.prepare("insert into orden_linea (contenedor, tarea_id, posicion) values ('3:0', 7, 0), ('2:40', 8, 0)").run();
    expect((await pedir('GET', '/api/linea/orden')).json().datos as OrdenLinea).toEqual({ '2:40': [8] });
  });

  it('PUT a un proyecto que no ve responde 404', async () => {
    const r = await pedir('PUT', '/api/linea/orden/3:0', { ids: [1] });
    expect(r.statusCode).toBe(404);
    expect(r.json().codigo).toBe('no-encontrado');
  });

  it.each([
    ['ids repetidos', '1:0', { ids: [1, 1] }],
    ['un id 0', '1:0', { ids: [0] }],
    ['sin ids', '1:0', {}],
    ['clave inválida', 'abc', { ids: [1] }],
  ])('PUT con %s responde 400', async (_n, clave, cuerpo) => {
    expect((await pedir('PUT', `/api/linea/orden/${clave}`, cuerpo)).statusCode).toBe(400);
  });

  it('el tope de 1000 ids: 1001 responde 400 y 1000 responde 200', async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    expect((await pedir('PUT', '/api/linea/orden/1:0', { ids: ids(1001) })).statusCode).toBe(400);
    expect((await pedir('PUT', '/api/linea/orden/1:0', { ids: ids(1000) })).statusCode).toBe(200);
  });

  it('sin sesión responde 401', async () => {
    expect((await pedir('GET', '/api/linea/orden', undefined, false)).statusCode).toBe(401);
    expect((await pedir('PUT', '/api/linea/orden/1:0', { ids: [1] }, false)).statusCode).toBe(401);
  });
});
