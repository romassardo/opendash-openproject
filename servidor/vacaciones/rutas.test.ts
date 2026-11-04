import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import { vacacionesDe, vacacionesDeTodos } from './repositorio.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
// 2026-10-19 en Argentina
const AHORA = new Date('2026-10-19T12:00:00.000Z');

describe('rutas de vacaciones', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;

  const pedir = (metodo: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, cookies: { od_sesion: sesion } });
  const cargar = (usuario: number, desde: string, hasta: string) =>
    Number(db.prepare('insert into vacaciones (usuario_id, desde, hasta) values (?, ?, ?)').run(usuario, desde, hasta).lastInsertRowid);

  beforeEach(async () => {
    db = abrirDb(':memory:');
    app = await crearApp({ config, db, crearCliente: () => ({}) as never, ahora: () => AHORA, sync: syncFalso() });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (9,'rmedina','Ramiro','h','t',?), (10,'otra','Otra','h','t',?)")
      .run(AHORA.toISOString(), AHORA.toISOString());
    sesion = crearSesion(db, 9, AHORA);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('lista solo las vacaciones propias que no terminaron', async () => {
    const propia = cargar(9, '2026-11-02', '2026-11-13');
    const hoy = cargar(9, '2026-10-12', '2026-10-19');
    cargar(9, '2026-09-01', '2026-09-10');
    cargar(10, '2026-11-02', '2026-11-13');
    const r = await pedir('GET', '/api/cuenta/vacaciones');
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual([
      { id: hoy, desde: '2026-10-12', hasta: '2026-10-19' },
      { id: propia, desde: '2026-11-02', hasta: '2026-11-13' },
    ]);
    expect(vacacionesDeTodos(db, '2026-10-19').get(10)).toHaveLength(1);
    expect(vacacionesDe(db, 9, '2026-10-20')).toHaveLength(1);
  });

  it('con ?desde= trae las que terminan ese día o después; sin parámetro, las que no terminaron', async () => {
    const agosto = cargar(9, '2026-08-01', '2026-08-05');
    const diciembre = cargar(9, '2026-12-01', '2026-12-05');
    const sin = await pedir('GET', '/api/cuenta/vacaciones');
    expect(sin.json().datos.map((v: { id: number }) => v.id)).toEqual([diciembre]);
    const con = await pedir('GET', '/api/cuenta/vacaciones?desde=2026-07-27');
    expect(con.statusCode).toBe(200);
    expect(con.json().datos.map((v: { id: number }) => v.id)).toEqual([agosto, diciembre]);
  });

  it('rechaza un ?desde= inválido o un parámetro desconocido', async () => {
    for (const url of ['/api/cuenta/vacaciones?desde=2026-13-40', '/api/cuenta/vacaciones?otro=1']) {
      const r = await pedir('GET', url);
      expect(r.statusCode, url).toBe(400);
      expect(r.json()).toMatchObject({ codigo: 'validacion' });
    }
  });

  it('crea vacaciones y devuelve la lista actualizada', async () => {
    const r = await pedir('POST', '/api/cuenta/vacaciones', { desde: '2026-12-21', hasta: '2026-12-31' });
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual([{ id: expect.any(Number), desde: '2026-12-21', hasta: '2026-12-31' }]);
  });

  it('rechaza fin antes del inicio, vacaciones pasadas, más de 90 días y las que se pisan', async () => {
    cargar(9, '2026-11-02', '2026-11-13');
    const casos: [object, string][] = [
      [{ desde: '2026-11-20', hasta: '2026-11-19' }, 'La fecha de fin no puede ser anterior al inicio'],
      [{ desde: '2026-02-30', hasta: '2026-03-01' }, 'La fecha de fin no puede ser anterior al inicio'],
      [{ desde: '2026-10-01', hasta: '2026-10-18' }, 'Esas vacaciones ya terminaron'],
      [{ desde: '2026-12-01', hasta: '2027-03-01' }, 'Cargá períodos de hasta 90 días'],
      [{ desde: '2026-11-13', hasta: '2026-11-20' }, 'Se pisan con otras vacaciones tuyas'],
      [{ desde: '2026-10-25', hasta: '2026-11-02' }, 'Se pisan con otras vacaciones tuyas'],
      [{ desde: '2026-10-25', hasta: '2026-11-30' }, 'Se pisan con otras vacaciones tuyas'],
    ];
    for (const [cuerpo, mensaje] of casos) {
      const r = await pedir('POST', '/api/cuenta/vacaciones', cuerpo);
      expect(r.statusCode, JSON.stringify(cuerpo)).toBe(400);
      expect(r.json()).toMatchObject({ codigo: 'validacion', mensaje });
    }
    expect((await pedir('POST', '/api/cuenta/vacaciones', { desde: '2026-11-14', hasta: '2026-11-20', otro: 1 })).statusCode).toBe(400);
    // 90 días justos pasan; las de otra persona no cuentan para pisarse
    cargar(10, '2027-01-01', '2027-01-10');
    expect((await pedir('POST', '/api/cuenta/vacaciones', { desde: '2027-01-01', hasta: '2027-03-31' })).statusCode).toBe(200);
    expect(db.prepare('select count(*) from vacaciones where usuario_id = 9').pluck().get()).toBe(2);
  });

  it('solo su dueño las borra: las de otro responden 404', async () => {
    const mia = cargar(9, '2026-11-02', '2026-11-13');
    const ajena = cargar(10, '2026-11-02', '2026-11-13');
    const r = await pedir('DELETE', `/api/cuenta/vacaciones/${ajena}`);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ codigo: 'no-encontrado', mensaje: 'No existen esas vacaciones' });
    expect((await pedir('DELETE', '/api/cuenta/vacaciones/9999')).statusCode).toBe(404);
    expect((await pedir('DELETE', '/api/cuenta/vacaciones/abc')).statusCode).toBe(400);
    const ok = await pedir('DELETE', `/api/cuenta/vacaciones/${mia}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().datos).toEqual([]);
    expect(db.prepare('select count(*) from vacaciones where id = ?').pluck().get(ajena)).toBe(1);
  });

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/cuenta/vacaciones' })).statusCode).toBe(401);
  });
});
