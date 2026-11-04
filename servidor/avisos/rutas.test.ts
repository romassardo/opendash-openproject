import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import type { ContextoAviso } from '../../compartido/tipos.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import { migrar } from '../db/migraciones.js';
import { leerYo } from '../cuenta/yo.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const AHORA = new Date('2026-10-25T12:00:00.000Z');
const CONTEXTO: ContextoAviso = { ruta: '/tareas', titulo: 'Tareas', navegador: 'Firefox', ventana: '1280x720', tema: 'oscuro', version: '0.1.0', error: null };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const b64 = (b: Buffer): string => b.toString('base64');

describe('avisos de problemas', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesionA: string;
  let sesionB: string;
  let sesionC: string;

  const pedir = (sesion: string, metodo: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, cookies: { od_sesion: sesion } });
  const crear = (sesion: string, extra: object = {}) =>
    pedir(sesion, 'POST', '/api/avisos-problema', { texto: 'No me deja guardar', contexto: CONTEXTO, ...extra });

  beforeEach(async () => {
    db = abrirDb(':memory:');
    app = await crearApp({ config, db, crearCliente: () => ({}) as never, ahora: () => AHORA, sync: syncFalso() });
    for (const [id, login] of [[1, 'ana'], [2, 'beto'], [3, 'cata']] as const) {
      db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (?,?,?,'h','t',?)").run(id, login, login, AHORA.toISOString());
    }
    sesionA = crearSesion(db, 1, AHORA);
    sesionB = crearSesion(db, 2, AHORA);
    sesionC = crearSesion(db, 3, AHORA);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('crea un aviso con contexto y sin imagen', async () => {
    const res = await crear(sesionA);
    expect(res.statusCode).toBe(200);
    const mios = (await pedir(sesionA, 'GET', '/api/avisos-problema/mios')).json().datos;
    expect(mios).toHaveLength(1);
    expect(mios[0]).toMatchObject({ texto: 'No me deja guardar', contexto: CONTEXTO, tieneImagen: false, estado: 'nuevo', usuarioId: 1 });
  });

  it('rechaza texto vacío y de más de 4000', async () => {
    expect((await crear(sesionA, { texto: '   ' })).statusCode).toBe(400);
    expect((await crear(sesionA, { texto: 'x'.repeat(4001) })).statusCode).toBe(400);
    expect((await crear(sesionA, { texto: 'x'.repeat(4000) })).statusCode).toBe(200);
  });

  it('guarda una imagen válida y la sirve con las cabeceras seguras', async () => {
    const id = (await crear(sesionA, { imagen: { tipo: 'image/png', datos: b64(PNG) } })).json().datos.id;
    const res = await pedir(sesionA, 'GET', `/api/avisos-problema/${id}/imagen`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it('rechaza una imagen que dice png y no lo es', async () => {
    const res = await crear(sesionA, { imagen: { tipo: 'image/png', datos: b64(Buffer.from('<html><script>alert(1)</script>')) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().codigo).toBe('validacion');
    expect(db.prepare('select count(*) from avisos_problema').pluck().get()).toBe(0);
  });

  it('acepta jpeg y webp válidos', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from([1, 2])]);
    const a = (await crear(sesionA, { imagen: { tipo: 'image/jpeg', datos: b64(jpeg) } })).json().datos.id;
    const b = (await crear(sesionA, { imagen: { tipo: 'image/webp', datos: b64(webp) } })).json().datos.id;
    expect((await pedir(sesionA, 'GET', `/api/avisos-problema/${a}/imagen`)).headers['content-type']).toBe('image/jpeg');
    expect((await pedir(sesionA, 'GET', `/api/avisos-problema/${b}/imagen`)).headers['content-type']).toBe('image/webp');
  });

  it('rechaza un RIFF que no es webp', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WAVE'), Buffer.from([1, 2])]);
    expect((await crear(sesionA, { imagen: { tipo: 'image/webp', datos: b64(wav) } })).statusCode).toBe(400);
  });

  it('rechaza base64 inválido o de largo que no es múltiplo de 4', async () => {
    expect((await crear(sesionA, { imagen: { tipo: 'image/png', datos: 'iVBORw0KGgo@' } })).statusCode).toBe(400);
    expect((await crear(sesionA, { imagen: { tipo: 'image/png', datos: b64(PNG).replace(/=+$/, '') } })).statusCode).toBe(400);
    expect((await crear(sesionA, { imagen: { tipo: 'image/png', datos: 'iVBORw' } })).statusCode).toBe(400);
  });

  it('rechaza una imagen cuyo tipo declarado no coincide con sus bytes', async () => {
    expect((await crear(sesionA, { imagen: { tipo: 'image/jpeg', datos: b64(PNG) } })).statusCode).toBe(400);
  });

  it('corta por largo una imagen enorme sin decodificarla', async () => {
    const res = await crear(sesionA, { imagen: { tipo: 'image/png', datos: 'A'.repeat(4.5 * 1024 * 1024) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().mensaje).toContain('3 MB');
  });

  it('rechaza una imagen de más de 3 MB', async () => {
    const grande = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    const res = await crear(sesionA, { imagen: { tipo: 'image/png', datos: b64(grande) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().mensaje).toContain('3 MB');
    expect(db.prepare('select count(*) from avisos_problema').pluck().get()).toBe(0);
  });

  it('el 21.º aviso en una hora da 429', async () => {
    for (let i = 0; i < 20; i++) expect((await crear(sesionA)).statusCode).toBe(200);
    const res = await crear(sesionA);
    expect(res.statusCode).toBe(429);
    expect(res.json().mensaje).toBe('Mandaste muchos avisos seguidos; probá en un rato.');
    expect((await crear(sesionB)).statusCode).toBe(200);
  });

  it('cada uno ve los suyos', async () => {
    await crear(sesionA, { texto: 'de ana' });
    await crear(sesionB, { texto: 'de beto' });
    const mios = (await pedir(sesionA, 'GET', '/api/avisos-problema/mios')).json().datos;
    expect(mios.map((a: { texto: string }) => a.texto)).toEqual(['de ana']);
  });

  it('solo los receptores ven todos y cambian el estado', async () => {
    const id = (await crear(sesionA)).json().datos.id;
    await pedir(sesionB, 'PUT', '/api/ajustes/avisos', { receptores: [2] });
    expect((await pedir(sesionA, 'GET', '/api/avisos-problema')).statusCode).toBe(403);
    expect((await pedir(sesionA, 'PATCH', `/api/avisos-problema/${id}`, { estado: 'visto' })).statusCode).toBe(403);
    const todos = await pedir(sesionB, 'GET', '/api/avisos-problema');
    expect(todos.json().datos).toHaveLength(1);
    expect((await pedir(sesionB, 'PATCH', `/api/avisos-problema/${id}`, { estado: 'arreglado' })).statusCode).toBe(200);
    expect((await pedir(sesionB, 'PATCH', `/api/avisos-problema/${id}`, { estado: 'raro' })).statusCode).toBe(400);
    expect((await pedir(sesionB, 'PATCH', '/api/avisos-problema/999', { estado: 'visto' })).statusCode).toBe(404);
    expect(db.prepare('select estado, marcado_por, marcado_el from avisos_problema').get())
      .toEqual({ estado: 'arreglado', marcado_por: 2, marcado_el: AHORA.toISOString() });
    expect((await pedir(sesionA, 'GET', '/api/avisos-problema/mios')).json().datos[0].estado).toBe('arreglado');
  });

  it('la imagen la ven el autor y los receptores, nadie más', async () => {
    const id = (await crear(sesionA, { imagen: { tipo: 'image/png', datos: b64(PNG) } })).json().datos.id;
    await pedir(sesionB, 'PUT', '/api/ajustes/avisos', { receptores: [2] });
    expect((await pedir(sesionA, 'GET', `/api/avisos-problema/${id}/imagen`)).statusCode).toBe(200);
    expect((await pedir(sesionB, 'GET', `/api/avisos-problema/${id}/imagen`)).statusCode).toBe(200);
    expect((await pedir(sesionC, 'GET', `/api/avisos-problema/${id}/imagen`)).statusCode).toBe(404);
    expect((await pedir(sesionA, 'GET', '/api/avisos-problema/999/imagen')).statusCode).toBe(404);
  });

  it('funciona con el token de OpenProject vencido', async () => {
    db.prepare('update usuarios set token_vencido = 1 where id = 1').run();
    expect((await crear(sesionA)).statusCode).toBe(200);
    expect((await pedir(sesionA, 'GET', '/api/avisos-problema/mios')).statusCode).toBe(200);
    // Elegir quién recibe los avisos también tiene que andar con el token vencido.
    expect((await pedir(sesionA, 'PUT', '/api/ajustes/avisos', { receptores: [1] })).statusCode).toBe(200);
  });

  it('la lista vacía la completa cualquiera; después solo la cambian los que están', async () => {
    expect((await pedir(sesionA, 'PUT', '/api/ajustes/avisos', { receptores: [1, 2] })).statusCode).toBe(200);
    expect((await pedir(sesionC, 'PUT', '/api/ajustes/avisos', { receptores: [3] })).statusCode).toBe(403);
    expect((await pedir(sesionB, 'PUT', '/api/ajustes/avisos', { receptores: [2, 999] })).statusCode).toBe(400);
    expect((await pedir(sesionB, 'PUT', '/api/ajustes/avisos', { receptores: [2, 3] })).statusCode).toBe(200);
    const ajustes = (await pedir(sesionC, 'GET', '/api/ajustes')).json().datos;
    expect(ajustes.avisos).toEqual({ receptores: [2, 3] });
  });

  it('Yo.recibeAvisos', async () => {
    expect(leerYo(db, 1).recibeAvisos).toBe(false);
    await pedir(sesionA, 'PUT', '/api/ajustes/avisos', { receptores: [1] });
    expect(leerYo(db, 1).recibeAvisos).toBe(true);
    expect(leerYo(db, 2).recibeAvisos).toBe(false);
  });

  it('las migraciones 9 a 13 se aplican sobre una base v8', () => {
    const vieja = abrirDb(':memory:');
    vieja.exec('DROP TABLE avisos_problema');
    vieja.exec('ALTER TABLE tramos_trabajo DROP COLUMN medidos');
    vieja.exec('ALTER TABLE usuarios DROP COLUMN aviso_reunion_min');
    vieja.exec('DROP TABLE pausas_tarea');
    vieja.exec('DROP TABLE horas_extra');
    vieja.pragma('user_version = 8');
    migrar(vieja);
    expect(vieja.pragma('user_version', { simple: true })).toBe(13);
    expect((vieja.pragma('table_info(usuarios)') as { name: string }[]).map((c) => c.name)).toContain('aviso_reunion_min');
    expect(vieja.prepare("select name from sqlite_master where name = 'avisos_problema'").get()).toBeDefined();
    vieja.close();
  });
});
