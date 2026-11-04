import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proyecto } from '../../compartido/tipos.js';
import { crearApp } from '../app.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import { clientePara } from './clientes.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const PERSONA = { id: 9, nombre: 'Ramiro Medina', login: 'rmedina', email: null, avatarUrl: null };
const OTRA = { ...PERSONA, id: 4, login: 'otra' };
const MINUTO = 60_000;

function clienteFalso(token: string): ClienteOp {
  return {
    async yo() {
      if (token === 'bueno' || token === 'sinproy') return PERSONA;
      if (token === 'ajeno') return OTRA;
      if (token === 'caido') throw new ErrorOp('red', 'sin red');
      if (token === 'prohibido') throw new ErrorOp('prohibido', 'no', 403);
      if (token === 'roto') throw new Error('falla rara');
      throw new ErrorOp('no-autorizado', 'no', 401);
    },
    async proyectos() {
      if (token === 'sinproy') throw new ErrorOp('prohibido', 'no', 403);
      return [{ id: 3 }, { id: 5 }] as unknown as Proyecto[];
    },
  } as unknown as ClienteOp;
}

describe('rutas de autenticación', () => {
  let db: Database;
  let app: FastifyInstance;
  let ahora: Date;
  const sync = { ...syncFalso(), cargaCompleta: vi.fn(async (_id: number) => {}) };

  const deps = () => ({ config, db, crearCliente: clienteFalso, ahora: () => ahora, sync });
  const registrar = (token = 'bueno', contrasena = 'clave-segura') =>
    app.inject({ method: 'POST', url: '/api/auth/registro', payload: { token, contrasena } });
  const ingresar = (login: string, contrasena: string) =>
    app.inject({ method: 'POST', url: '/api/auth/ingreso', payload: { login, contrasena } });
  const cookieDe = (r: { cookies: { name: string; value: string }[] }) => r.cookies.find((c) => c.name === 'od_sesion')!.value;
  const conSesion = async (metodo: 'GET' | 'PUT' | 'POST', url: string, payload?: object, cookie?: string) =>
    app.inject({ method: metodo, url, payload, cookies: { od_sesion: cookie ?? sesion } });
  let sesion: string;

  beforeEach(async () => {
    db = abrirDb(':memory:');
    ahora = new Date('2026-10-19T12:00:00.000Z');
    sync.cargaCompleta.mockClear();
    app = await crearApp(deps());
    sesion = cookieDe(await registrar());
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('registro con token válido crea usuario, guarda el token cifrado y abre sesión', async () => {
    const r = await registrar();
    expect(r.statusCode).toBe(200);
    const fila = db.prepare('select * from usuarios where id = 9').get() as any;
    expect(fila.token_cifrado).not.toContain('bueno');
    const cookie = r.cookies.find((c) => c.name === 'od_sesion')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookie.secure).toBeFalsy();
    expect(cookie.maxAge).toBe(30 * 24 * 60 * 60);
    expect(sync.cargaCompleta).toHaveBeenCalledWith(9);
    // Falla cerrado: el registro no asocia proyectos; los llena la carga completa con los legibles.
    expect(db.prepare('select count(*) as n from usuario_proyectos where usuario_id = 9').get()).toEqual({ n: 0 });
    expect(clientePara(deps(), 9)).not.toBeNull();
  });

  it('la base nunca guarda el id crudo de la sesión, solo su SHA-256', async () => {
    const hash = createHash('sha256').update(sesion).digest('hex');
    const ids = (db.prepare('select id from sesiones').all() as { id: string }[]).map((f) => f.id);
    expect(ids).toContain(hash);
    expect(ids).not.toContain(sesion);
    expect(sesion).toMatch(/^[0-9a-f]{64}$/);
  });

  it('registro con token rechazado responde token-invalido', async () => {
    const r = await registrar('malo');
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ ok: false, codigo: 'token-invalido', mensaje: 'OpenProject no aceptó ese token' });
  });

  it('registro con OpenProject caído responde sin-conexion', async () => {
    const r = await registrar('caido');
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, codigo: 'sin-conexion' });
  });

  it('si yo() falla por red responde 503; por otra causa, 500 interno', async () => {
    const roto = await registrar('roto');
    expect(roto.statusCode).toBe(500);
    expect(roto.json()).toEqual({ ok: false, codigo: 'interno', mensaje: 'Algo salió mal en el servidor' });
    const prohibido = await registrar('prohibido');
    expect(prohibido.statusCode).toBe(500);
    expect(prohibido.json()).toMatchObject({ codigo: 'interno' });
  });

  it('si proyectos() falla el registro termina igual, sin proyectos', async () => {
    db.prepare('delete from usuario_proyectos').run();
    const r = await registrar('sinproy');
    expect(r.statusCode).toBe(200);
    expect(db.prepare('select count(*) as n from usuario_proyectos').get()).toEqual({ n: 0 });
    expect(sync.cargaCompleta).toHaveBeenCalledWith(9);
  });

  it('re-registro: conserva las filas de proyectos que siguen visibles y quita las que dejaron de serlo', async () => {
    db.prepare('insert into usuario_proyectos values (9, 3), (9, 5), (9, 8)').run();
    await registrar();
    expect(db.prepare('select proyecto_id from usuario_proyectos where usuario_id = 9 order by 1').pluck().all()).toEqual([3, 5]);
  });

  it('re-registro con proyectos() caído deja las filas como estaban', async () => {
    db.prepare('insert into usuario_proyectos values (9, 3), (9, 8)').run();
    await registrar('sinproy');
    expect(db.prepare('select proyecto_id from usuario_proyectos where usuario_id = 9 order by 1').pluck().all()).toEqual([3, 8]);
  });

  it('una falla de la carga completa no rompe el registro', async () => {
    sync.cargaCompleta.mockRejectedValueOnce(new Error('boom'));
    const r = await registrar();
    expect(r.statusCode).toBe(200);
  });

  it('registrar de nuevo reemplaza la contraseña y cierra las sesiones anteriores', async () => {
    const r = await registrar('bueno', 'otra-clave-larga');
    expect(r.statusCode).toBe(200);
    expect((await conSesion('GET', '/api/auth/yo')).statusCode).toBe(401);
    expect((await ingresar('rmedina', 'clave-segura')).statusCode).toBe(401);
    expect((await ingresar('rmedina', 'otra-clave-larga')).statusCode).toBe(200);
    expect(db.prepare('select count(*) as n from usuarios').get()).toEqual({ n: 1 });
  });

  it('valida el cuerpo con zod', async () => {
    for (const payload of [
      { token: 'bueno', contrasena: 'corta' },
      { token: '', contrasena: 'clave-segura' },
      { token: 'x'.repeat(201), contrasena: 'clave-segura' },
      { token: 'bueno', contrasena: 'x'.repeat(201) },
      { token: 'bueno', contrasena: 'clave-segura', extra: 1 },
    ]) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/registro', payload });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'validacion' });
    }
    const sinCuerpo = await app.inject({ method: 'POST', url: '/api/auth/ingreso' });
    expect(sinCuerpo.statusCode).toBe(400);
    expect(sinCuerpo.json()).toMatchObject({ codigo: 'validacion' });
  });

  it('ingreso correcto abre sesión; usuario o contraseña incorrectos dan el mismo error', async () => {
    const bien = await ingresar('rmedina', 'clave-segura');
    expect(bien.statusCode).toBe(200);
    expect(cookieDe(bien)).toMatch(/^[0-9a-f]{64}$/);
    const mal = await ingresar('rmedina', 'mal-mal-mal');
    const noExiste = await ingresar('nadie', 'clave-segura');
    for (const r of [mal, noExiste]) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ ok: false, codigo: 'credenciales', mensaje: 'Usuario o contraseña incorrectos' });
    }
  });

  describe('carga completa al ingresar', () => {
    const marcar = (valor: string | null) => {
      db.prepare('delete from estado_sync').run();
      if (valor !== null) db.prepare("insert into estado_sync values ('ultimo_completo:9', ?)").run(valor);
      sync.cargaCompleta.mockClear();
    };
    it('la dispara si falta la marca o tiene más de 60 minutos', async () => {
      marcar(null);
      await ingresar('rmedina', 'clave-segura');
      expect(sync.cargaCompleta).toHaveBeenCalledWith(9);
      marcar(new Date(ahora.getTime() - 61 * MINUTO).toISOString());
      await ingresar('rmedina', 'clave-segura');
      expect(sync.cargaCompleta).toHaveBeenCalledWith(9);
    });
    it('no la dispara si la marca es reciente', async () => {
      marcar(new Date(ahora.getTime() - 10 * MINUTO).toISOString());
      await ingresar('rmedina', 'clave-segura');
      expect(sync.cargaCompleta).not.toHaveBeenCalled();
    });
    it('una falla de la carga no rompe el ingreso', async () => {
      marcar(null);
      sync.cargaCompleta.mockRejectedValueOnce(new Error('boom'));
      expect((await ingresar('rmedina', 'clave-segura')).statusCode).toBe(200);
    });
  });

  it('el sexto intento fallido en 15 minutos responde 429, incluso con la clave correcta', async () => {
    for (let i = 0; i < 5; i++) expect((await ingresar('rmedina', 'mal')).statusCode).toBe(401);
    const r = await ingresar('rmedina', 'clave-segura');
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ codigo: 'demasiados-intentos' });
  });

  it('ingresos simultáneos con clave mala: como máximo 5 dan 401 y el resto 429', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => ingresar('rmedina', 'mal')));
    const estados = rs.map((r) => r.statusCode);
    expect(estados.filter((e) => e === 401).length).toBeLessThanOrEqual(5);
    expect(estados.filter((e) => e === 429).length).toBeGreaterThanOrEqual(5);
    expect(estados.every((e) => e === 401 || e === 429)).toBe(true);
  });

  it('el bloqueo se levanta pasados 15 minutos y un ingreso correcto no cuenta como fallo', async () => {
    for (let i = 0; i < 5; i++) await ingresar('rmedina', 'mal');
    ahora = new Date(ahora.getTime() + 15 * MINUTO + 1);
    expect((await ingresar('rmedina', 'clave-segura')).statusCode).toBe(200);
    for (let i = 0; i < 3; i++) expect((await ingresar('rmedina', 'clave-segura')).statusCode).toBe(200);
    expect(db.prepare('select count(*) as n from intentos_ingreso').get()).toEqual({ n: 0 });
  });

  it('los fallos de un login no bloquean a otro', async () => {
    for (let i = 0; i < 5; i++) await ingresar('otro', 'mal');
    expect((await ingresar('rmedina', 'clave-segura')).statusCode).toBe(200);
  });

  it('veinte fallos desde una IP con logins distintos bloquean esa IP', async () => {
    const desdeIp = (login: string, ip: string, contrasena = 'mal') =>
      app.inject({ method: 'POST', url: '/api/auth/ingreso', payload: { login, contrasena }, remoteAddress: ip });
    for (let i = 0; i < 20; i++) expect((await desdeIp(`persona${i}`, '10.0.0.5')).statusCode).toBe(401);
    const r = await desdeIp('rmedina', '10.0.0.5', 'clave-segura');
    expect(r.statusCode).toBe(429);
    expect((await desdeIp('rmedina', '10.0.0.6', 'clave-segura')).statusCode).toBe(200);
  });

  it('cinco fallos con un login desde otra IP no bloquean a la persona en su PC', async () => {
    const desdeIp = (ip: string, contrasena: string) =>
      app.inject({ method: 'POST', url: '/api/auth/ingreso', payload: { login: 'rmedina', contrasena }, remoteAddress: ip });
    for (let i = 0; i < 5; i++) expect((await desdeIp('10.0.0.9', 'mal')).statusCode).toBe(401);
    expect((await desdeIp('10.0.0.9', 'clave-segura')).statusCode).toBe(429);
    expect((await desdeIp('10.0.0.10', 'clave-segura')).statusCode).toBe(200);
  });

  it('RMedina entra igual que rmedina', async () => {
    expect((await ingresar('RMedina', 'clave-segura')).statusCode).toBe(200);
    expect((await ingresar('  rmedina ', 'clave-segura')).statusCode).toBe(200);
  });

  it('registrar de nuevo con el login en otras mayúsculas no deja un usuario duplicado', async () => {
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (50, 'RMEDINA', 'Viejo', 'h', 'x', 0, ?)").run(ahora.toISOString());
    await registrar();
    expect(db.prepare('select id from usuarios where login = ? collate nocase').all('rmedina')).toEqual([{ id: 9 }]);
  });

  it('GET /api/auth/yo sin cookie o con cookie inventada responde no-sesion', async () => {
    const sin = await app.inject({ method: 'GET', url: '/api/auth/yo' });
    expect(sin.statusCode).toBe(401);
    expect(sin.json()).toMatchObject({ codigo: 'no-sesion' });
    const falsa = await conSesion('GET', '/api/auth/yo', undefined, 'a'.repeat(64));
    expect(falsa.statusCode).toBe(401);
  });

  it('GET /api/auth/yo devuelve el perfil y actualiza la última actividad', async () => {
    ahora = new Date('2026-10-19T12:05:00.000Z');
    const r = await conSesion('GET', '/api/auth/yo');
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual({ id: 9, login: 'rmedina', nombre: 'Ramiro Medina', tema: 'oscuro', fijados: [], cargaInicialLista: false, rol: '', capacidadHoras: 40, variasALaVez: false, recibeAvisos: false, avisoReunionMin: 5, tieneCalendario: false, calendario: null });
    expect(db.prepare('select ultima_actividad as u from usuarios where id = 9').get()).toEqual({ u: ahora.toISOString() });
  });

  it('un pedido con la cabecera de fondo no toca la última actividad; sin ella sí', async () => {
    const antes = db.prepare('select ultima_actividad as u from usuarios where id = 9').get();
    ahora = new Date('2026-10-19T12:30:00.000Z');
    const fondo = await app.inject({ method: 'GET', url: '/api/auth/yo', cookies: { od_sesion: sesion }, headers: { 'x-opendash-fondo': '1' } });
    expect(fondo.statusCode).toBe(200);
    expect(db.prepare('select ultima_actividad as u from usuarios where id = 9').get()).toEqual(antes);
    const normal = await conSesion('GET', '/api/auth/yo');
    expect(normal.statusCode).toBe(200);
    expect(db.prepare('select ultima_actividad as u from usuarios where id = 9').get()).toEqual({ u: ahora.toISOString() });
  });

  it('GET /api/auth/yo avisa si la primera carga completa ya terminó', async () => {
    db.prepare('delete from estado_sync').run();
    expect((await conSesion('GET', '/api/auth/yo')).json().datos.cargaInicialLista).toBe(false);
    db.prepare("insert into estado_sync values ('ultimo_completo:9', ?)").run(ahora.toISOString());
    expect((await conSesion('GET', '/api/auth/yo')).json().datos.cargaInicialLista).toBe(true);
  });

  it('una sesión vencida se rechaza y se borra', async () => {
    ahora = new Date(ahora.getTime() + 30 * 24 * 60 * MINUTO + 1);
    const r = await conSesion('GET', '/api/auth/yo');
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ codigo: 'no-sesion' });
    expect(db.prepare('select count(*) as n from sesiones').get()).toEqual({ n: 0 });
  });

  it('salir borra solo esa sesión y la cookie', async () => {
    const otra = cookieDe(await ingresar('rmedina', 'clave-segura'));
    const r = await conSesion('POST', '/api/auth/salir');
    expect(r.statusCode).toBe(200);
    expect(r.cookies.find((c) => c.name === 'od_sesion')?.value).toBe('');
    expect((await conSesion('GET', '/api/auth/yo')).statusCode).toBe(401);
    expect((await conSesion('GET', '/api/auth/yo', undefined, otra)).statusCode).toBe(200);
  });

  it('un usuario con token vencido recibe token-vencido y puede cargar uno nuevo', async () => {
    db.prepare('update usuarios set token_vencido = 1 where id = 9').run();
    expect(clientePara(deps(), 9)).toBeNull();
    expect((await conSesion('GET', '/api/auth/yo')).json()).toMatchObject({ codigo: 'token-vencido' });
    expect((await conSesion('PUT', '/api/auth/token', { token: 'bueno' })).statusCode).toBe(200);
    expect((await conSesion('GET', '/api/auth/yo')).statusCode).toBe(200);
    expect(clientePara(deps(), 9)).not.toBeNull();
  });

  it('no acepta un token de otra persona al renovar', async () => {
    db.prepare('update usuarios set token_vencido = 1 where id = 9').run();
    const r = await conSesion('PUT', '/api/auth/token', { token: 'ajeno' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'token-invalido' });
    expect(db.prepare('select token_vencido as v from usuarios where id = 9').get()).toEqual({ v: 1 });
  });

  it('PUT /api/auth/token sin sesión responde no-sesion', async () => {
    const r = await app.inject({ method: 'PUT', url: '/api/auth/token', payload: { token: 'bueno' } });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ codigo: 'no-sesion' });
  });
});
