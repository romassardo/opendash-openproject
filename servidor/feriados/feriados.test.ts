import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirDb } from '../db/conexion.js';
import { leerFeriadosDelAnio, type FeriadoLista } from './fuente.js';
import { agregarFeriado, feriadosEntre, fechasFeriado, quitarFeriado, reemplazarAnio } from './repositorio.js';
import { crearServicioFeriados } from './servicio.js';

const respuesta = (cuerpo: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(cuerpo), { status })) as unknown as typeof fetch;

describe('fuente de feriados', () => {
  it('convierte la lista de ArgentinaDatos y marca los puentes', async () => {
    const pedidos: string[] = [];
    const fetchFn = (async (url: string) => {
      pedidos.push(url);
      return new Response(JSON.stringify([
        { fecha: '2026-05-25', tipo: 'inamovible', nombre: 'Día de la Revolución de Mayo' },
        { fecha: '2026-07-10', tipo: 'puente', nombre: 'Día no laborable con fines turísticos' },
      ]));
    }) as unknown as typeof fetch;
    const lista = await leerFeriadosDelAnio('https://fuente.test/v1/feriados', 2026, fetchFn);
    expect(pedidos).toEqual(['https://fuente.test/v1/feriados/2026']);
    expect(lista).toEqual([
      { fecha: '2026-05-25', nombre: 'Día de la Revolución de Mayo', puente: false },
      { fecha: '2026-07-10', nombre: 'Día no laborable con fines turísticos', puente: true },
    ]);
  });

  it('recorta espacios del nombre, lo corta a 80 caracteres y usa «Feriado» si queda vacío', async () => {
    const lista = await leerFeriadosDelAnio('https://f.test', 2026, respuesta([
      { fecha: '2026-05-25', tipo: 'inamovible', nombre: `  ${'a'.repeat(100)}  ` },
      { fecha: '2026-05-26', tipo: 'inamovible', nombre: '   ' },
      { fecha: '2026-05-27', tipo: 'inamovible', nombre: ' Corto ' },
    ]));
    expect(lista.map((f) => f.nombre)).toEqual(['a'.repeat(80), 'Feriado', 'Corto']);
  });

  it('una respuesta con otra forma lanza', async () => {
    await expect(leerFeriadosDelAnio('https://f.test', 2026, respuesta({ feriados: [] }))).rejects.toThrow();
    await expect(leerFeriadosDelAnio('https://f.test', 2026, respuesta([{ fecha: '2026-05-25' }]))).rejects.toThrow();
    await expect(leerFeriadosDelAnio('https://f.test', 2026, respuesta([{ fecha: '2026-02-30', tipo: 'x', nombre: 'n' }]))).rejects.toThrow();
    await expect(leerFeriadosDelAnio('https://f.test', 2026, respuesta([{ fecha: '2027-01-01', tipo: 'x', nombre: 'n' }]))).rejects.toThrow();
    await expect(leerFeriadosDelAnio('https://f.test', 2026, respuesta([], 500))).rejects.toThrow();
  });
});

describe('repositorio de feriados', () => {
  let db: Database;
  beforeEach(() => {
    db = abrirDb(':memory:');
  });
  afterEach(() => db.close());

  const lista2026: FeriadoLista[] = [
    { fecha: '2026-05-01', nombre: 'Día del Trabajador', puente: false },
    { fecha: '2026-05-25', nombre: 'Revolución de Mayo', puente: false },
  ];

  it('lo agregado a mano manda sobre la lista y se distingue', () => {
    reemplazarAnio(db, 2026, lista2026);
    agregarFeriado(db, '2026-05-25', 'Mi nombre');
    agregarFeriado(db, '2026-06-01', 'Día de la oficina');
    expect(feriadosEntre(db, '2026-05-01', '2026-06-30')).toEqual([
      { fecha: '2026-05-01', nombre: 'Día del Trabajador', puente: false, manual: false },
      { fecha: '2026-05-25', nombre: 'Mi nombre', puente: false, manual: true },
      { fecha: '2026-06-01', nombre: 'Día de la oficina', puente: false, manual: true },
    ]);
    expect([...fechasFeriado(db, '2026-05-20', '2026-05-31')]).toEqual(['2026-05-25']);
  });

  it('quitar uno de la lista lo saca aunque la lista se vuelva a bajar', () => {
    reemplazarAnio(db, 2026, lista2026);
    expect(quitarFeriado(db, '2026-05-01')).toBe(true);
    reemplazarAnio(db, 2026, lista2026);
    expect(feriadosEntre(db, '2026-01-01', '2026-12-31').map((f) => f.fecha)).toEqual(['2026-05-25']);
    expect(quitarFeriado(db, '2026-05-01')).toBe(false);
  });

  it('volver a agregar un día quitado con el mismo nombre de la lista lo restaura', () => {
    reemplazarAnio(db, 2026, lista2026);
    quitarFeriado(db, '2026-05-01');
    agregarFeriado(db, '2026-05-01', '  Día del Trabajador ');
    expect(feriadosEntre(db, '2026-05-01', '2026-05-01')).toEqual([
      { fecha: '2026-05-01', nombre: 'Día del Trabajador', puente: false, manual: false },
    ]);
  });

  it('volver a agregar un día quitado con otro nombre queda con el nombre nuevo', () => {
    reemplazarAnio(db, 2026, lista2026);
    quitarFeriado(db, '2026-05-01');
    agregarFeriado(db, '2026-05-01', 'Otro nombre');
    expect(feriadosEntre(db, '2026-05-01', '2026-05-01')).toEqual([
      { fecha: '2026-05-01', nombre: 'Otro nombre', puente: false, manual: true },
    ]);
  });

  it('quitar uno agregado a mano lo borra; uno que no es feriado da false', () => {
    agregarFeriado(db, '2026-06-01', 'Día de la oficina');
    expect(quitarFeriado(db, '2026-06-01')).toBe(true);
    expect(feriadosEntre(db, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(quitarFeriado(db, '2026-06-02')).toBe(false);
  });

  it('quitar uno agregado a mano que pisaba la lista deja la lista quitada', () => {
    reemplazarAnio(db, 2026, lista2026);
    agregarFeriado(db, '2026-05-25', 'Mi nombre');
    expect(quitarFeriado(db, '2026-05-25')).toBe(true);
    expect(feriadosEntre(db, '2026-05-25', '2026-05-25')).toEqual([]);
  });

  it('reemplazar un año no toca los otros ni lo agregado a mano', () => {
    reemplazarAnio(db, 2026, lista2026);
    reemplazarAnio(db, 2027, [{ fecha: '2027-01-01', nombre: 'Año Nuevo', puente: false }]);
    agregarFeriado(db, '2026-06-01', 'Mío');
    reemplazarAnio(db, 2026, [{ fecha: '2026-12-25', nombre: 'Navidad', puente: false }]);
    expect(feriadosEntre(db, '2026-01-01', '2027-12-31').map((f) => f.fecha)).toEqual(['2026-06-01', '2026-12-25', '2027-01-01']);
  });
});

describe('servicio de feriados', () => {
  let db: Database;
  let ahora: Date;
  const marca = (): string | undefined =>
    db.prepare("select valor from estado_sync where clave = 'feriados_actualizados'").pluck().get() as string | undefined;
  const feriado = (anio: number): FeriadoLista[] => [{ fecha: `${anio}-01-01`, nombre: `Año Nuevo ${anio}`, puente: false }];

  beforeEach(() => {
    db = abrirDb(':memory:');
    ahora = new Date('2026-10-22T15:00:00Z');
  });
  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  const crear = (leer: (anio: number) => Promise<FeriadoLista[]>, extra: { chequeoMs?: number } = {}) =>
    crearServicioFeriados({ db, config: { feriadosUrl: 'https://f.test' }, ahora: () => ahora, leer, ...extra });

  it('consulta el año en curso y el siguiente una vez por semana', async () => {
    const leer = vi.fn(async (anio: number) => feriado(anio));
    const servicio = crear(leer);
    await servicio.actualizarSiHaceFalta();
    expect(leer.mock.calls.map((c) => c[0])).toEqual([2026, 2027]);
    expect(marca()).toBe(ahora.toISOString());
    ahora = new Date(ahora.getTime() + 6 * 24 * 3_600_000);
    await servicio.actualizarSiHaceFalta();
    expect(leer).toHaveBeenCalledTimes(2);
    ahora = new Date(ahora.getTime() + 2 * 24 * 3_600_000);
    await servicio.actualizarSiHaceFalta();
    expect(leer).toHaveBeenCalledTimes(4);
  });

  it('el año argentino manda: el 31 de diciembre a las 23:30 argentinas ya es 1 de enero en UTC pero sigue siendo 2026', async () => {
    ahora = new Date('2026-12-31T23:30:00-03:00');
    const leer = vi.fn(async (anio: number) => feriado(anio));
    await crear(leer).actualizarSiHaceFalta();
    expect(leer.mock.calls.map((c) => c[0])).toEqual([2026, 2027]);
  });

  it('al arrancar consulta si la última vez fue hace más de una semana', async () => {
    db.prepare("insert into estado_sync values ('feriados_actualizados', ?)").run(new Date(ahora.getTime() - 8 * 24 * 3_600_000).toISOString());
    const leer = vi.fn(async (anio: number) => feriado(anio));
    const servicio = crear(leer);
    servicio.iniciar();
    await vi.waitFor(() => expect(leer).toHaveBeenCalledTimes(2));
    servicio.detener();
  });

  it('al arrancar no consulta si la última vez fue hace poco', async () => {
    db.prepare("insert into estado_sync values ('feriados_actualizados', ?)").run(new Date(ahora.getTime() - 24 * 3_600_000).toISOString());
    const leer = vi.fn(async (anio: number) => feriado(anio));
    const servicio = crear(leer);
    servicio.iniciar();
    await new Promise((r) => setTimeout(r, 20));
    servicio.detener();
    expect(leer).not.toHaveBeenCalled();
  });

  it('una lista vacía o una falla no borra la anterior', async () => {
    reemplazarAnio(db, 2026, feriado(2026));
    reemplazarAnio(db, 2027, feriado(2027));
    await crear(async () => []).actualizarSiHaceFalta();
    expect(feriadosEntre(db, '2026-01-01', '2027-12-31')).toHaveLength(2);
    expect(marca()).toBeUndefined();
    await crear(async () => {
      throw new Error('sin red');
    }).actualizarSiHaceFalta();
    expect(feriadosEntre(db, '2026-01-01', '2027-12-31')).toHaveLength(2);
    expect(marca()).toBeUndefined();
  });

  it('cada año es independiente: si falla el siguiente, el actual igual se guarda y se marca', async () => {
    await crear(async (anio) => {
      if (anio === 2027) throw new Error('caído');
      return feriado(anio);
    }).actualizarSiHaceFalta();
    expect(feriadosEntre(db, '2026-01-01', '2027-12-31').map((f) => f.fecha)).toEqual(['2026-01-01']);
    expect(marca()).toBe(ahora.toISOString());
  });

  it('si falla el año en curso no marca la fecha, aunque el siguiente salga bien', async () => {
    await crear(async (anio) => {
      if (anio === 2026) throw new Error('caído');
      return feriado(anio);
    }).actualizarSiHaceFalta();
    expect(feriadosEntre(db, '2026-01-01', '2027-12-31').map((f) => f.fecha)).toEqual(['2027-01-01']);
    expect(marca()).toBeUndefined();
  });

  it('repite cada chequeoMs y detener corta el temporizador', async () => {
    vi.useFakeTimers();
    const leer = vi.fn(async () => []);
    const servicio = crear(leer, { chequeoMs: 1000 });
    servicio.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    expect(leer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(leer).toHaveBeenCalledTimes(4);
    servicio.detener();
    await vi.advanceTimersByTimeAsync(5000);
    expect(leer).toHaveBeenCalledTimes(4);
  });
});
