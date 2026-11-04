import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarioPropio, Reunion } from '../../compartido/tipos.js';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import { cifrar, descifrar } from '../seguridad/cifrado.js';
import { guardarFalla, guardarLectura } from './repositorio.js';
import type { ResultadoLectura } from './lectura.js';
import { crearServicioCalendario } from './servicio.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const AHORA = new Date('2026-10-19T15:00:00.000Z');
const URL_ICS = 'https://outlook.office365.com/owa/calendar/secreto123/reachcalendar.ics';
const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//prueba//ES',
  'BEGIN:VEVENT', 'UID:nuevo-1', 'DTSTART:20261020T130000Z', 'DTEND:20261020T140000Z', 'SUMMARY:Reunión nueva', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

const reunion = (id: string, titulo: string, inicio: string, fin: string): Reunion => ({
  id, titulo, lugar: null, inicio, fin, diaEntero: false, libre: false, enlace: null, plataforma: null,
});
const VENTANA = { desde: '2026-07-20', hasta: '2027-04-23' };

describe('calendario propio por la API', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion9: string;
  let leer: ReturnType<typeof vi.fn<(url: string) => Promise<ResultadoLectura>>>;

  const pedir = (metodo: 'GET' | 'PUT', url: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, cookies: { od_sesion: sesion9 } });
  const enlaceGuardado = (id: number): string | null => db.prepare('select ics_cifrado from usuarios where id = ?').pluck().get(id) as string | null;

  beforeEach(async () => {
    db = abrirDb(':memory:');
    leer = vi.fn(async (): Promise<ResultadoLectura> => ({ ok: true, texto: ICS }));
    const calendario = crearServicioCalendario({ db, config, ahora: () => AHORA, leer });
    app = await crearApp({ config, db, crearCliente: () => ({}) as never, ahora: () => AHORA, sync: syncFalso(), calendario });
    const insertar = db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (?,?,?,'h','t',?)");
    insertar.run(9, 'rmedina', 'Ramiro', AHORA.toISOString());
    insertar.run(8, 'colega', 'Colega', AHORA.toISOString());
    sesion9 = crearSesion(db, 9, AHORA);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  const conCache = (id: number, reuniones: Reunion[]): void => {
    db.prepare('update usuarios set ics_cifrado = ? where id = ?').run(cifrar(URL_ICS, config.claveCifrado, `ics:${id}`), id);
    guardarLectura(db, config.claveCifrado, id, reuniones, VENTANA, AHORA);
  };

  it('GET /api/calendario responde con el token de OpenProject vencido, y solo con lo propio', async () => {
    conCache(9, [reunion('a', 'Mi daily', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z')]);
    conCache(8, [reunion('b', 'Secreto del colega', '2026-10-20T14:00:00.000Z', '2026-10-20T15:00:00.000Z')]);
    db.prepare('update usuarios set token_vencido = 1 where id = 9').run();
    const r = await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25');
    expect(r.statusCode).toBe(200);
    expect((r.json().datos as CalendarioPropio).reuniones.map((m) => m.titulo)).toEqual(['Mi daily']);
    expect(r.body).not.toContain('Secreto del colega');
  });

  it('GET /api/calendario devuelve solo las reuniones de quien pide', async () => {
    conCache(9, [reunion('a', 'Mi daily', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z')]);
    conCache(8, [reunion('b', 'Secreto del colega', '2026-10-20T14:00:00.000Z', '2026-10-20T15:00:00.000Z')]);
    const r = await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25');
    expect(r.statusCode).toBe(200);
    const datos = r.json().datos as CalendarioPropio;
    expect(datos.reuniones.map((m) => m.titulo)).toEqual(['Mi daily']);
    expect(datos.estado).toEqual({ leido: AHORA.toISOString(), falla: null });
    expect(datos.ventana).toEqual(VENTANA);
    expect(r.body).not.toContain('Secreto del colega');
  });

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/calendario?desde=2026-10-19&hasta=2026-10-25' })).statusCode).toBe(401);
  });

  it('filtra por rango y rechaza rangos de más de 62 días o mal formados', async () => {
    conCache(9, [
      reunion('a', 'Dentro', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z'),
      reunion('b', 'Antes', '2026-10-10T12:00:00.000Z', '2026-10-10T13:00:00.000Z'),
      // Termina justo a la medianoche argentina de desde: no toca el rango.
      reunion('c', 'Termina antes', '2026-10-19T02:00:00.000Z', '2026-10-19T03:00:00.000Z'),
      // Empieza justo a la medianoche argentina siguiente a hasta: no toca el rango.
      reunion('d', 'Empieza después', '2026-10-26T03:00:00.000Z', '2026-10-26T04:00:00.000Z'),
      // Cruza el borde de hasta: sí toca.
      reunion('e', 'Cruza', '2026-10-26T02:30:00.000Z', '2026-10-26T03:30:00.000Z'),
    ]);
    const r = await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25');
    expect((r.json().datos as CalendarioPropio).reuniones.map((m) => m.titulo)).toEqual(['Dentro', 'Cruza']);

    const justo = await pedir('GET', '/api/calendario?desde=2026-10-01&hasta=2026-12-01');
    expect(justo.statusCode).toBe(200);
    for (const q of [
      'desde=2026-10-01&hasta=2026-12-02', 'desde=2026-10-25&hasta=2026-10-19', 'desde=2026-02-30&hasta=2026-03-02',
      'desde=hoy&hasta=2026-10-25', 'desde=2026-10-19', 'hasta=2026-10-19', '',
    ]) {
      const m = await pedir('GET', `/api/calendario?${q}`);
      expect(m.statusCode, q).toBe(400);
      expect(m.json().codigo).toBe('validacion');
    }
  });

  it('entran al rango la reunión que cruza la medianoche de desde y la de duración cero justo a esa hora', async () => {
    conCache(9, [
      reunion('a', 'Viene de ayer', '2026-10-19T02:00:00.000Z', '2026-10-19T04:00:00.000Z'),
      reunion('b', 'Instante', '2026-10-19T03:00:00.000Z', '2026-10-19T03:00:00.000Z'),
    ]);
    const r = await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25');
    expect((r.json().datos as CalendarioPropio).reuniones.map((m) => m.titulo)).toEqual(['Viene de ayer', 'Instante']);
  });

  it('una caché que no se descifra avisa sin datos sensibles y responde sin reuniones', async () => {
    conCache(9, [reunion('a', 'Titulo privado', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z')]);
    db.prepare("update calendario_cache set reuniones_cifradas = 'v2.basura.basura.basura' where usuario_id = 9").run();
    const aviso = vi.spyOn(app.log, 'warn');
    const r = await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25');
    expect(r.statusCode).toBe(200);
    expect((r.json().datos as CalendarioPropio).reuniones).toEqual([]);
    const registrado = JSON.stringify(aviso.mock.calls);
    expect(registrado).toContain('cache-corrupta');
    expect(registrado).not.toContain('Titulo privado');
    expect(registrado).not.toContain('secreto123');
  });

  it('sin enlace responde estado null y sin reuniones', async () => {
    const r = await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25');
    expect(r.json().datos).toEqual({ reuniones: [], estado: null, ventana: null });
  });

  it('con enlace pero sin lectura todavía responde el estado vacío', async () => {
    db.prepare('update usuarios set ics_cifrado = ? where id = 9').run(cifrar(URL_ICS, config.claveCifrado, 'ics:9'));
    const r = await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25');
    expect(r.json().datos).toEqual({ reuniones: [], estado: { leido: null, falla: null }, ventana: null });
  });

  it('muestra la falla de la última lectura junto con las reuniones guardadas', async () => {
    conCache(9, [reunion('a', 'Mi daily', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z')]);
    guardarFalla(db, 9, 'sin-conexion', AHORA);
    const datos = (await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25')).json().datos as CalendarioPropio;
    expect(datos.estado).toEqual({ leido: AHORA.toISOString(), falla: 'sin-conexion' });
    expect(datos.reuniones).toHaveLength(1);
  });

  it('PUT con un enlace que no es de Outlook responde 400 y no guarda', async () => {
    for (const url of ['https://example.com/a.ics', 'http://outlook.office365.com/a.ics', 'no es url']) {
      const r = await pedir('PUT', '/api/cuenta/calendario', { url });
      expect(r.statusCode, url).toBe(400);
      expect(r.json()).toMatchObject({ codigo: 'validacion', mensaje: 'El enlace tiene que ser el de un calendario publicado de Outlook' });
    }
    expect(leer).not.toHaveBeenCalled();
    expect(enlaceGuardado(9)).toBeNull();
  });

  it('PUT con un enlace que no devuelve un calendario responde 400 con el motivo y no guarda', async () => {
    leer.mockResolvedValue({ ok: false, falla: 'enlace-caido', motivo: 'prueba' });
    const r = await pedir('PUT', '/api/cuenta/calendario', { url: URL_ICS });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({
      codigo: 'validacion',
      mensaje: 'Ese enlace no devuelve un calendario. Revisá que esté publicado con todos los detalles y copiá el enlace ICS',
    });
    expect(r.body).not.toContain('secreto123');
    expect(enlaceGuardado(9)).toBeNull();
    expect(db.prepare('select count(*) from calendario_cache').pluck().get()).toBe(0);
  });

  it('PUT sin conexión con Outlook responde 503', async () => {
    leer.mockResolvedValue({ ok: false, falla: 'sin-conexion', motivo: 'prueba' });
    const r = await pedir('PUT', '/api/cuenta/calendario', { url: URL_ICS });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ codigo: 'sin-conexion', mensaje: 'No se pudo conectar con Outlook. Probá de nuevo en un rato' });
    expect(enlaceGuardado(9)).toBeNull();
  });

  it('un PUT que falla conserva el enlace y las reuniones anteriores', async () => {
    conCache(9, [reunion('a', 'Mi daily', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z')]);
    const antes = enlaceGuardado(9);
    leer.mockResolvedValue({ ok: false, falla: 'sin-conexion', motivo: 'prueba' });
    await pedir('PUT', '/api/cuenta/calendario', { url: URL_ICS });
    expect(enlaceGuardado(9)).toBe(antes);
    const datos = (await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25')).json().datos as CalendarioPropio;
    expect(datos.reuniones.map((m) => m.titulo)).toEqual(['Mi daily']);
  });

  it('PUT bueno guarda el enlace cifrado y ya trae las reuniones', async () => {
    const r = await pedir('PUT', '/api/cuenta/calendario', { url: URL_ICS });
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual({ tieneCalendario: true, calendario: { leido: AHORA.toISOString(), falla: null } });
    expect(r.body).not.toContain('secreto123');
    const guardado = enlaceGuardado(9) as string;
    expect(guardado).not.toContain('outlook');
    expect(descifrar(guardado, config.claveCifrado, 'ics:9')).toBe(URL_ICS);
    const datos = (await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25')).json().datos as CalendarioPropio;
    expect(datos.reuniones.map((m) => m.titulo)).toEqual(['Reunión nueva']);
    expect(datos.estado?.leido).toBe(AHORA.toISOString());
  });

  it('PUT null borra el enlace y las reuniones', async () => {
    conCache(9, [reunion('a', 'Mi daily', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z')]);
    const r = await pedir('PUT', '/api/cuenta/calendario', { url: null });
    expect(r.json().datos).toEqual({ tieneCalendario: false, calendario: null });
    expect(enlaceGuardado(9)).toBeNull();
    expect(db.prepare('select count(*) from calendario_cache where usuario_id = 9').pluck().get()).toBe(0);
    expect((await pedir('GET', '/api/calendario?desde=2026-10-19&hasta=2026-10-25')).json().datos).toEqual({ reuniones: [], estado: null, ventana: null });
  });

  it('yo trae el estado del calendario y nunca el enlace', async () => {
    expect((await pedir('GET', '/api/auth/yo')).json().datos).toMatchObject({ tieneCalendario: false, calendario: null });
    conCache(9, [reunion('a', 'Mi daily', '2026-10-20T12:00:00.000Z', '2026-10-20T13:00:00.000Z')]);
    const r = await pedir('GET', '/api/auth/yo');
    expect(r.json().datos).toMatchObject({ tieneCalendario: true, calendario: { leido: AHORA.toISOString(), falla: null } });
    expect(r.body).not.toContain('outlook');
    expect(r.body).not.toContain('Mi daily');
  });
});
