import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import { hashear } from '../seguridad/contrasenas.js';
import { syncFalso } from '../../pruebas/fabricas/sync.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const AHORA = new Date('2026-10-19T12:00:00.000Z');

describe('rutas de cuenta', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;

  const pedir = (metodo: 'GET' | 'PATCH' | 'PUT', url: string, payload?: object, cookie?: string) =>
    app.inject({ method: metodo, url, payload, cookies: { od_sesion: cookie ?? sesion } });

  beforeEach(async () => {
    db = abrirDb(':memory:');
    app = await crearApp({ config, db, crearCliente: () => ({}) as never, ahora: () => AHORA, sync: syncFalso() });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (9,'rmedina','Ramiro','h','t',?)").run(AHORA.toISOString());
    db.prepare('update usuarios set hash = ? where id = 9').run(await hashear('clave-vieja'));
    sesion = crearSesion(db, 9, AHORA);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('yo devuelve rol, capacidad y si tiene calendario', async () => {
    const r = await pedir('GET', '/api/auth/yo');
    expect(r.json().datos).toEqual({
      id: 9, login: 'rmedina', nombre: 'Ramiro', tema: 'oscuro', fijados: [], cargaInicialLista: false,
      rol: '', capacidadHoras: 40, variasALaVez: false, recibeAvisos: false, avisoReunionMin: 5, tieneCalendario: false, calendario: null,
    });
    db.prepare("update usuarios set tema = 'raro', ics_cifrado = 'x' where id = 9").run();
    expect((await pedir('GET', '/api/auth/yo')).json().datos).toMatchObject({ tema: 'oscuro', tieneCalendario: true, calendario: { leido: null, falla: null } });
  });

  it('PATCH avisoReunionMin acepta 10 y null, y rechaza 7', async () => {
    expect((await pedir('PATCH', '/api/cuenta', { avisoReunionMin: 10 })).json().datos.avisoReunionMin).toBe(10);
    expect((await pedir('PATCH', '/api/cuenta', { avisoReunionMin: null })).json().datos.avisoReunionMin).toBeNull();
    expect((await pedir('GET', '/api/auth/yo')).json().datos.avisoReunionMin).toBeNull();
    for (const malo of [{ avisoReunionMin: 7 }, { avisoReunionMin: 0 }, { avisoReunionMin: '5' }]) {
      expect((await pedir('PATCH', '/api/cuenta', malo)).statusCode, JSON.stringify(malo)).toBe(400);
    }
    expect((await pedir('PATCH', '/api/cuenta', { avisoReunionMin: 1, rol: 'X' })).json().datos).toMatchObject({ avisoReunionMin: 1, rol: 'X' });
  });

  it('PATCH cuenta guarda la capacidad y rechaza 0', async () => {
    const ok = await pedir('PATCH', '/api/cuenta', { capacidadHoras: 32.5, rol: '  Soporte  ' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().datos).toMatchObject({ capacidadHoras: 32.5, rol: 'Soporte' });
    for (const malo of [{ capacidadHoras: 0 }, { capacidadHoras: 81 }, { capacidadHoras: 10.3 }, { metaFocoHoras: 1 }, { rol: 'x'.repeat(61) }, {}, { otro: 1 }]) {
      const r = await pedir('PATCH', '/api/cuenta', malo);
      expect(r.statusCode, JSON.stringify(malo)).toBe(400);
      expect(r.json().codigo).toBe('validacion');
    }
    expect(db.prepare('select capacidad_horas as c from usuarios where id = 9').get()).toEqual({ c: 32.5 });
  });

  it('PATCH cuenta guarda el tema y rechaza otro valor', async () => {
    expect((await pedir('PATCH', '/api/cuenta', { tema: 'claro' })).json().datos.tema).toBe('claro');
    expect((await pedir('PATCH', '/api/cuenta', { tema: 'azul' })).statusCode).toBe(400);
    expect(db.prepare('select tema from usuarios where id = 9').pluck().get()).toBe('claro');
  });

  it('el cambio de contraseña guarda el hash y cierra las otras sesiones en una sola transacción', async () => {
    crearSesion(db, 9, AHORA);
    db.exec("create trigger falla_borrado before delete on sesiones begin select raise(abort, 'falla forzada'); end");
    const hashViejo = db.prepare('select hash from usuarios where id = 9').pluck().get();
    const r = await pedir('PUT', '/api/cuenta/contrasena', { actual: 'clave-vieja', nueva: 'clave-nueva-1' });
    expect(r.statusCode).toBe(500);
    expect(db.prepare('select hash from usuarios where id = 9').pluck().get()).toBe(hashViejo);
    db.exec('drop trigger falla_borrado');
    const ingreso = await app.inject({ method: 'POST', url: '/api/auth/ingreso', payload: { login: 'rmedina', contrasena: 'clave-vieja' } });
    expect(ingreso.statusCode).toBe(200);
  });

  it('cambiar la contraseña con la actual correcta cierra las otras sesiones y conserva la actual', async () => {
    const otra = crearSesion(db, 9, AHORA);
    const r = await pedir('PUT', '/api/cuenta/contrasena', { actual: 'clave-vieja', nueva: 'clave-nueva-1' });
    expect(r.statusCode).toBe(200);
    expect((await pedir('GET', '/api/auth/yo')).statusCode).toBe(200);
    expect((await pedir('GET', '/api/auth/yo', undefined, otra)).statusCode).toBe(401);
    const ingreso = await app.inject({ method: 'POST', url: '/api/auth/ingreso', payload: { login: 'rmedina', contrasena: 'clave-nueva-1' } });
    expect(ingreso.statusCode).toBe(200);
  });

  it('cambiar la contraseña con la actual incorrecta responde credenciales y cuenta el intento', async () => {
    const r = await pedir('PUT', '/api/cuenta/contrasena', { actual: 'mala', nueva: 'clave-nueva-1' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ codigo: 'credenciales', mensaje: 'La contraseña actual no es correcta' });
    expect(db.prepare('select count(*) from intentos_ingreso').pluck().get()).toBe(1);
    for (let i = 0; i < 4; i++) await pedir('PUT', '/api/cuenta/contrasena', { actual: 'mala', nueva: 'clave-nueva-1' });
    const bloqueada = await pedir('PUT', '/api/cuenta/contrasena', { actual: 'clave-vieja', nueva: 'clave-nueva-1' });
    expect(bloqueada.statusCode).toBe(429);
    expect(bloqueada.json().codigo).toBe('demasiados-intentos');
  });

  it('la contraseña nueva corta se rechaza', async () => {
    expect((await pedir('PUT', '/api/cuenta/contrasena', { actual: 'clave-vieja', nueva: 'corta' })).statusCode).toBe(400);
  });

  it('el calendario rechaza http', async () => {
    for (const url of ['http://x.test/a.ics', 'ftp://x.test', 'no es url', `https://x.test/${'a'.repeat(2000)}`]) {
      expect((await pedir('PUT', '/api/cuenta/calendario', { url })).statusCode, url.slice(0, 30)).toBe(400);
    }
  });

  it('fijar un proyecto visible lo agrega al final', async () => {
    db.prepare('insert into usuario_proyectos values (9, 3), (9, 5)').run();
    expect((await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 5, fijado: true })).json().datos).toEqual({ fijados: [5] });
    expect((await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 3, fijado: true })).json().datos).toEqual({ fijados: [5, 3] });
    expect((await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 3, fijado: true })).json().datos).toEqual({ fijados: [5, 3] });
    expect((await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 5, fijado: false })).json().datos).toEqual({ fijados: [3] });
    expect((await pedir('GET', '/api/auth/yo')).json().datos.fijados).toEqual([3]);
  });

  it('quitar un fijado de un proyecto que ya no se ve lo saca de la lista', async () => {
    db.prepare('insert into usuario_proyectos values (9, 3), (9, 5)').run();
    await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 5, fijado: true });
    await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 3, fijado: true });
    db.prepare('delete from usuario_proyectos where usuario_id = 9 and proyecto_id = 5').run();
    const r = await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 5, fijado: false });
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual({ fijados: [3] });
    expect((await pedir('GET', '/api/auth/yo')).json().datos.fijados).toEqual([3]);
  });

  it('quitar un proyecto que no estaba fijado responde la lista sin cambios', async () => {
    db.prepare('insert into usuario_proyectos values (9, 3)').run();
    await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 3, fijado: true });
    const r = await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 77, fijado: false });
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual({ fijados: [3] });
  });

  it('fijar un proyecto que no ve responde no-encontrado', async () => {
    const r = await pedir('PUT', '/api/cuenta/fijados', { proyectoId: 77, fijado: true });
    expect(r.statusCode).toBe(404);
    expect(r.json().codigo).toBe('no-encontrado');
  });

  it('sin sesión responde no-sesion', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/cuenta', payload: { tema: 'claro' } });
    expect(r.statusCode).toBe(401);
  });
});
