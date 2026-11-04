import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ListaFeriados } from '../../compartido/tipos.js';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import { reemplazarAnio } from './repositorio.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const AHORA = new Date('2026-10-22T15:00:00Z');

describe('rutas de feriados', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;

  const pedir = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, cookies: { od_sesion: sesion }, payload });
  const fechas = (r: { json: () => { datos: ListaFeriados } }): string[] => r.json().datos.feriados.map((f) => f.fecha);

  beforeEach(async () => {
    db = abrirDb(':memory:');
    app = await crearApp({ config, db, crearCliente: () => ({}) as never, ahora: () => AHORA, sync: syncFalso() });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (9, 'rm', 'Ramiro', 'h', 't', ?)").run(AHORA.toISOString());
    sesion = crearSesion(db, 9, AHORA);
    reemplazarAnio(db, 2025, [{ fecha: '2025-12-25', nombre: 'Navidad 2025', puente: false }]);
    reemplazarAnio(db, 2026, [{ fecha: '2026-12-25', nombre: 'Navidad', puente: false }]);
    reemplazarAnio(db, 2027, [{ fecha: '2027-01-01', nombre: 'Año Nuevo', puente: false }]);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('las rutas de feriados exigen sesión', async () => {
    for (const [method, url] of [['GET', '/api/feriados'], ['POST', '/api/feriados'], ['DELETE', '/api/feriados/2026-12-25']] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it('GET devuelve del 1 de enero de este año al 31 de diciembre del siguiente', async () => {
    reemplazarAnio(db, 2028, [{ fecha: '2028-01-01', nombre: 'Año Nuevo 2028', puente: false }]);
    const r = await pedir('GET', '/api/feriados');
    expect(r.statusCode).toBe(200);
    expect(fechas(r)).toEqual(['2026-12-25', '2027-01-01']);
    expect(r.json().datos.actualizado).toBeNull();
  });

  it('GET informa cuándo se actualizó por última vez', async () => {
    db.prepare("insert into estado_sync values ('feriados_actualizados', ?)").run('2026-10-20T10:00:00.000Z');
    expect((await pedir('GET', '/api/feriados')).json().datos.actualizado).toBe('2026-10-20T10:00:00.000Z');
  });

  it('POST valida la fecha dentro de este año o el siguiente y el nombre de 1 a 80', async () => {
    const mal = [
      { fecha: '2025-12-31', nombre: 'x' },
      { fecha: '2028-01-01', nombre: 'x' },
      { fecha: '2026-02-30', nombre: 'x' },
      { fecha: '2026-11-02', nombre: '   ' },
      { fecha: '2026-11-02', nombre: 'a'.repeat(81) },
      { fecha: '2026-11-02' },
      { fecha: '2026-11-02', nombre: 'x', otro: 1 },
    ];
    for (const cuerpo of mal) expect((await pedir('POST', '/api/feriados', cuerpo)).statusCode).toBe(400);
    const ok = await pedir('POST', '/api/feriados', { fecha: '2026-11-02', nombre: '  Día de la oficina  ' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().datos.feriados).toContainEqual({ fecha: '2026-11-02', nombre: 'Día de la oficina', puente: false, manual: true });
    expect((await pedir('POST', '/api/feriados', { fecha: '2027-12-31', nombre: 'a'.repeat(80) })).statusCode).toBe(200);
  });

  it('DELETE quita un feriado y devuelve la lista', async () => {
    const r = await pedir('DELETE', '/api/feriados/2026-12-25');
    expect(r.statusCode).toBe(200);
    expect(fechas(r)).toEqual(['2027-01-01']);
  });

  it('DELETE de un día que no es feriado responde 404', async () => {
    expect((await pedir('DELETE', '/api/feriados/2026-11-03')).statusCode).toBe(404);
  });

  it('DELETE fuera de la ventana de POST responde 400', async () => {
    const r = await pedir('DELETE', '/api/feriados/2030-01-01');
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'validacion' });
    expect((await pedir('DELETE', '/api/feriados/2025-12-25')).statusCode).toBe(400);
  });

  it('DELETE con una fecha inválida responde 400', async () => {
    expect((await pedir('DELETE', '/api/feriados/2026-13-01')).statusCode).toBe(400);
    expect((await pedir('DELETE', '/api/feriados/hola')).statusCode).toBe(400);
  });
});
