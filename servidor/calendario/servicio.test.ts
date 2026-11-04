import { readFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirDb } from '../db/conexion.js';
import { cifrar, descifrar } from '../seguridad/cifrado.js';
import { borrarCache, estadoCalendario, guardarFalla, guardarLectura, leerCache } from './repositorio.js';
import type { ResultadoLectura } from './lectura.js';
import { crearServicioCalendario, ventanaGuardada } from './servicio.js';

const { leerIcsEspiado } = vi.hoisted(() => ({ leerIcsEspiado: vi.fn() }));
vi.mock('./ics.js', async (importar) => {
  const real = await importar<typeof import('./ics.js')>();
  leerIcsEspiado.mockImplementation(real.leerIcs);
  return { ...real, leerIcs: leerIcsEspiado };
});

const CLAVE = Buffer.alloc(32, 7);
const URL_ICS = 'https://outlook.office365.com/owa/calendar/secreto123/reachcalendar.ics';
const ICS = readFileSync(new URL('../../pruebas/fixtures/calendario/outlook.ics', import.meta.url), 'utf-8');
const VACIO = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const HOY = new Date('2026-10-19T15:00:00.000Z');

describe('ventanaGuardada', () => {
  it('va del lunes de 13 semanas atrás a hoy + 365 días', () => {
    expect(ventanaGuardada('2026-10-22')).toEqual({ desde: '2026-07-20', hasta: '2027-10-22' });
  });
});

describe('calendario: caché y servicio', () => {
  let db: Database;
  let ahora: Date;
  const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const ponerEnlace = (id: number, url: string | null = URL_ICS): void => {
    db.prepare('update usuarios set ics_cifrado = ? where id = ?').run(url === null ? null : cifrar(url, CLAVE, `ics:${id}`), id);
  };
  const servicio = (leer: (url: string) => Promise<ResultadoLectura>, intervaloMs?: number) =>
    crearServicioCalendario({ db, config: { claveCifrado: CLAVE, icsOrigenesPrueba: [] }, ahora: () => ahora, leer, registro, intervaloMs });
  const devuelve = (texto: string) => vi.fn(async (): Promise<ResultadoLectura> => ({ ok: true, texto }));

  beforeEach(() => {
    db = abrirDb(':memory:');
    ahora = HOY;
    for (const id of [1, 2]) {
      db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (?,?,?,'h','t',?)").run(id, `u${id}`, `U${id}`, HOY.toISOString());
    }
    registro.info.mockClear(); registro.warn.mockClear(); registro.error.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it('guarda las reuniones cifradas y no quedan en texto plano', async () => {
    ponerEnlace(1);
    expect(await servicio(devuelve(ICS)).actualizar(1)).toEqual({ ok: true });
    const fila = db.prepare('select * from calendario_cache where usuario_id = 1').get() as Record<string, string>;
    expect(JSON.stringify(fila)).not.toContain('Daily');
    expect(descifrar(fila.reuniones_cifradas as string, CLAVE, 'calendario:1')).toContain('Daily');
    expect(() => descifrar(fila.reuniones_cifradas as string, CLAVE, 'calendario:2')).toThrow();
    const cache = leerCache(db, CLAVE, 1);
    expect(cache?.reuniones.length).toBeGreaterThan(0);
    expect(cache?.reuniones.some((r) => r.titulo.includes('Daily'))).toBe(true);
    expect(cache?.estado).toEqual({ leido: HOY.toISOString(), falla: null });
    expect(cache?.ventana).toEqual(ventanaGuardada('2026-10-19'));
  });

  it('una falla conserva lo último leído y anota desde cuándo', async () => {
    ponerEnlace(1);
    await servicio(devuelve(ICS)).actualizar(1);
    const antes = leerCache(db, CLAVE, 1);
    ahora = new Date(HOY.getTime() + 3_600_000);
    const r = await servicio(async () => ({ ok: false, falla: 'sin-conexion', motivo: 'x' })).actualizar(1);
    expect(r).toEqual({ ok: false, falla: 'sin-conexion' });
    const despues = leerCache(db, CLAVE, 1);
    expect(despues?.reuniones).toEqual(antes?.reuniones);
    expect(despues?.estado).toEqual({ leido: HOY.toISOString(), falla: 'sin-conexion' });
    expect(estadoCalendario(db, 1)).toEqual({ leido: HOY.toISOString(), falla: 'sin-conexion' });
  });

  it('una falla sin lectura previa deja las reuniones vacías', () => {
    ponerEnlace(1);
    guardarFalla(db, 1, 'enlace-caido', HOY);
    expect(leerCache(db, CLAVE, 1)).toEqual({ reuniones: [], ventana: null, estado: { leido: null, falla: 'enlace-caido' } });
  });

  it('un calendario que llega vacío cuando antes tenía es una falla', async () => {
    ponerEnlace(1);
    await servicio(devuelve(ICS)).actualizar(1);
    const antes = leerCache(db, CLAVE, 1)?.reuniones;
    const r = await servicio(devuelve(VACIO)).actualizar(1);
    expect(r).toEqual({ ok: false, falla: 'sin-conexion' });
    expect(leerCache(db, CLAVE, 1)?.reuniones).toEqual(antes);
    expect(registro.warn.mock.calls.flat().join('\r\n')).toContain('calendario vacío sospechoso');
  });

  it('una lectura buena calcula la ventana una sola vez aunque pase la medianoche', async () => {
    ponerEnlace(1);
    const dia1 = new Date('2026-10-19T14:59:59.000Z');
    const dia2 = new Date('2026-10-20T03:00:01.000Z');
    let llamadas = 0;
    ahora = dia1;
    const s = crearServicioCalendario({
      db, config: { claveCifrado: CLAVE, icsOrigenesPrueba: [] }, registro, leer: devuelve(ICS),
      ahora: () => (llamadas++ === 0 ? dia1 : dia2),
    });
    expect(await s.actualizar(1)).toEqual({ ok: true });
    expect(leerCache(db, CLAVE, 1)?.ventana).toEqual(ventanaGuardada('2026-10-19'));
    expect(leerIcsEspiado.mock.calls.at(-1)?.[1]).toEqual(ventanaGuardada('2026-10-19'));
  });

  it('una lectura con avisos deja una sola línea con el usuario y las cantidades', async () => {
    ponerEnlace(1);
    const roto = (n: number) => ['BEGIN:VEVENT', `UID:r${n}@t`, 'DTSTART:basura', 'END:VEVENT'];
    const serie = ['BEGIN:VEVENT', 'UID:vieja@t', 'DTSTART:18260101T120000Z', 'DTEND:18260101T121500Z', 'RRULE:FREQ=DAILY', 'END:VEVENT'];
    const texto = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...roto(1), ...roto(2), ...serie, 'END:VCALENDAR', ''].join('\r\n');
    expect(await servicio(devuelve(texto)).actualizar(1)).toEqual({ ok: true });
    const lineas = registro.warn.mock.calls.filter(([, mensaje]) => String(mensaje).includes('salteados'));
    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.[1]).toBe('[calendario] 2 eventos salteados, 1 serie cortada (usuario 1)');
    expect(JSON.stringify(registro.warn.mock.calls)).not.toContain('secreto123');
  });

  it('una lectura sin avisos no deja esa línea', async () => {
    ponerEnlace(1);
    await servicio(devuelve(ICS)).actualizar(1);
    expect(registro.warn.mock.calls.filter(([, mensaje]) => String(mensaje).includes('salteado'))).toHaveLength(0);
  });

  describe('calendario vacío sospechoso', () => {
    const conReunionesLeidasHace = async (horas: number) => {
      ponerEnlace(1);
      await servicio(devuelve(ICS)).actualizar(1);
      ahora = new Date(HOY.getTime() + horas * 3_600_000);
    };

    it('a las 23 h de la última lectura buena conserva las reuniones y anota sin-conexion', async () => {
      await conReunionesLeidasHace(23);
      const antes = leerCache(db, CLAVE, 1)?.reuniones;
      expect(await servicio(devuelve(VACIO)).actualizar(1)).toEqual({ ok: false, falla: 'sin-conexion' });
      const despues = leerCache(db, CLAVE, 1);
      expect(despues?.reuniones).toEqual(antes);
      expect(despues?.estado).toEqual({ leido: HOY.toISOString(), falla: 'sin-conexion' });
    });

    it('a las 24 h el vacío se guarda como real', async () => {
      await conReunionesLeidasHace(24);
      expect(await servicio(devuelve(VACIO)).actualizar(1)).toEqual({ ok: true });
      const despues = leerCache(db, CLAVE, 1);
      expect(despues?.reuniones).toEqual([]);
      expect(despues?.estado).toEqual({ leido: ahora.toISOString(), falla: null });
    });
  });

  it('si leerIcs lanza algo que no es ErrorIcs, el aviso lleva el name del error y nada más', async () => {
    ponerEnlace(1);
    leerIcsEspiado.mockImplementationOnce(() => { throw new TypeError(`roto ${URL_ICS}`); });
    const r = await servicio(devuelve(ICS)).actualizar(1);
    expect(r).toEqual({ ok: false, falla: 'sin-conexion' });
    const llamada = registro.warn.mock.calls.find(([datos]) => (datos as { falla?: string }).falla === 'interno');
    expect(llamada?.[0]).toMatchObject({ usuarioId: 1, falla: 'interno', error: 'TypeError' });
    expect(JSON.stringify(registro.warn.mock.calls)).not.toContain('secreto123');
  });

  it('un calendario vacío sin nada previo se guarda como válido', async () => {
    ponerEnlace(1);
    expect(await servicio(devuelve(VACIO)).actualizar(1)).toEqual({ ok: true });
    expect(leerCache(db, CLAVE, 1)?.estado.falla).toBeNull();
  });

  it('un texto que no es iCalendar es enlace-caido', async () => {
    ponerEnlace(1);
    const r = await servicio(devuelve('esto no es un calendario')).actualizar(1);
    expect(r).toEqual({ ok: false, falla: 'enlace-caido' });
    expect(estadoCalendario(db, 1)?.falla).toBe('enlace-caido');
  });

  it('reuniones guardadas corruptas: leerCache no lanza y actualizar sigue funcionando', async () => {
    ponerEnlace(1);
    await servicio(devuelve(ICS)).actualizar(1);
    db.prepare("update calendario_cache set reuniones_cifradas = 'v2.basura.basura.basura' where usuario_id = 1").run();
    expect(leerCache(db, CLAVE, 1)).toMatchObject({ reuniones: [], ventana: null, estado: { falla: null } });
    expect(await servicio(devuelve(ICS)).actualizar(1)).toEqual({ ok: true });
    expect(leerCache(db, CLAVE, 1)?.reuniones.length).toBeGreaterThan(0);
    expect(JSON.stringify(registro.warn.mock.calls)).toContain('cache-corrupta');
  });

  it('JSON corrupto bajo un cifrado válido también se trata como sin reuniones', () => {
    ponerEnlace(1);
    db.prepare("insert into calendario_cache (usuario_id, reuniones_cifradas, ventana, leido, intento) values (1, ?, '{mal', ?, ?)")
      .run(cifrar('no es json', CLAVE, 'calendario:1'), HOY.toISOString(), HOY.toISOString());
    expect(leerCache(db, CLAVE, 1)).toEqual({ reuniones: [], ventana: null, estado: { leido: HOY.toISOString(), falla: null } });
  });

  it('la ronda nunca rechaza: un error fuera de cada persona se avisa sin enlace', async () => {
    vi.useFakeTimers();
    ponerEnlace(1);
    const original = db.prepare.bind(db);
    const espia = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('ics_cifrado is not null')) throw new Error(`boom ${URL_ICS}`);
      return original(sql);
    }) as never);
    const s = servicio(devuelve(ICS));
    s.iniciar();
    await vi.advanceTimersByTimeAsync(1);
    espia.mockRestore();
    expect(registro.warn).toHaveBeenCalled();
    expect(JSON.stringify(registro.warn.mock.calls)).not.toContain('secreto123');
    s.detener();
    // La siguiente ronda de un servicio sano funciona.
    const leer = devuelve(ICS);
    const s2 = servicio(leer);
    s2.iniciar();
    await vi.advanceTimersByTimeAsync(1);
    expect(leer).toHaveBeenCalledTimes(1);
    s2.detener();
  });

  it('sin enlace borra la caché y da ok', async () => {
    ponerEnlace(1);
    await servicio(devuelve(ICS)).actualizar(1);
    ponerEnlace(1, null);
    expect(await servicio(devuelve(ICS)).actualizar(1)).toEqual({ ok: true });
    expect(leerCache(db, CLAVE, 1)).toBeNull();
    expect(estadoCalendario(db, 1)).toBeNull();
  });

  it('si quitan el enlace mientras se lee, la lectura no se guarda', async () => {
    ponerEnlace(1);
    let soltar!: () => void;
    const leer = vi.fn(() => new Promise<ResultadoLectura>((res) => { soltar = () => res({ ok: true, texto: ICS }); }));
    const pendiente = servicio(leer).actualizar(1);
    ponerEnlace(1, null);
    soltar();
    await pendiente;
    expect(leerCache(db, CLAVE, 1)).toBeNull();
  });

  it('guardarEnlace no guarda nada si el enlace no devuelve un calendario', async () => {
    const r = await servicio(async () => ({ ok: false, falla: 'enlace-caido', motivo: 'x' })).guardarEnlace(1, URL_ICS);
    expect(r).toEqual({ ok: false, falla: 'enlace-caido' });
    expect(db.prepare('select ics_cifrado from usuarios where id = 1').pluck().get()).toBeNull();
    expect(leerCache(db, CLAVE, 1)).toBeNull();
  });

  it('guardarEnlace rechaza un enlace no permitido sin pedirlo', async () => {
    const leer = devuelve(ICS);
    expect(await servicio(leer).guardarEnlace(1, 'https://ejemplo.com/x.ics')).toEqual({ ok: false, falla: 'enlace-caido' });
    expect(leer).not.toHaveBeenCalled();
  });

  it('guardarEnlace guarda el enlace cifrado y la lectura juntos', async () => {
    expect(await servicio(devuelve(ICS)).guardarEnlace(1, URL_ICS)).toEqual({ ok: true });
    const guardado = db.prepare('select ics_cifrado from usuarios where id = 1').pluck().get() as string;
    expect(descifrar(guardado, CLAVE, 'ics:1')).toBe(URL_ICS);
    expect(leerCache(db, CLAVE, 1)?.reuniones.length).toBeGreaterThan(0);
  });

  it('si quitan el enlace mientras guardarEnlace lee, el enlace queda quitado', async () => {
    const s = servicio(devuelve(ICS));
    await s.guardarEnlace(1, URL_ICS);
    let soltar!: () => void;
    const lenta = vi.fn(() => new Promise<ResultadoLectura>((res) => { soltar = () => res({ ok: true, texto: ICS }); }));
    const pendiente = servicio(lenta).guardarEnlace(1, URL_ICS + '?otro');
    s.quitarEnlace(1);
    soltar();
    expect(await pendiente).toEqual({ ok: false, falla: 'sin-conexion' });
    expect(db.prepare('select ics_cifrado from usuarios where id = 1').pluck().get()).toBeNull();
    expect(leerCache(db, CLAVE, 1)).toBeNull();
  });

  it('quitarEnlace borra el enlace y las reuniones', async () => {
    const s = servicio(devuelve(ICS));
    await s.guardarEnlace(1, URL_ICS);
    s.quitarEnlace(1);
    expect(db.prepare('select ics_cifrado from usuarios where id = 1').pluck().get()).toBeNull();
    expect(leerCache(db, CLAVE, 1)).toBeNull();
  });

  it('borrarCache es inofensivo sin fila', () => {
    expect(() => borrarCache(db, 2)).not.toThrow();
    guardarLectura(db, CLAVE, 2, [], { desde: '2026-07-20', hasta: '2027-04-23' }, HOY);
    expect(leerCache(db, CLAVE, 2)?.reuniones).toEqual([]);
  });

  it('iniciar lee a todos los que tienen enlace y repite cada 5 minutos', async () => {
    vi.useFakeTimers();
    ponerEnlace(1);
    ponerEnlace(2);
    const leer = devuelve(ICS);
    const s = servicio(leer);
    s.iniciar();
    await vi.advanceTimersByTimeAsync(1);
    expect(leer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(leer).toHaveBeenCalledTimes(4);
    s.detener();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(leer).toHaveBeenCalledTimes(4);
  });

  it('una ronda lenta no se superpone con la siguiente', async () => {
    vi.useFakeTimers();
    ponerEnlace(1);
    let soltar!: () => void;
    const leer = vi.fn(() => new Promise<ResultadoLectura>((res) => { soltar = () => res({ ok: true, texto: ICS }); }));
    const s = servicio(leer, 1000);
    s.iniciar();
    await vi.advanceTimersByTimeAsync(5000);
    expect(leer).toHaveBeenCalledTimes(1);
    soltar();
    await vi.advanceTimersByTimeAsync(1000);
    expect(leer).toHaveBeenCalledTimes(2);
    s.detener();
  });

  it('el enlace nunca aparece en el registro', async () => {
    ponerEnlace(1);
    await servicio(async () => ({ ok: false, falla: 'sin-conexion', motivo: `fallo ${URL_ICS}` })).actualizar(1);
    await servicio(devuelve(ICS)).actualizar(1);
    await servicio(devuelve(VACIO)).actualizar(1);
    const todo = JSON.stringify([...registro.info.mock.calls, ...registro.warn.mock.calls, ...registro.error.mock.calls]);
    expect(todo).not.toContain('secreto123');
    expect(todo).not.toContain('outlook.office365.com');
    expect(registro.warn).toHaveBeenCalled();
  });
});
