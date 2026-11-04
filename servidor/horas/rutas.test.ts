import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogoOp, EstadoHoras, HorasPorDia, Tramo } from '../../compartido/tipos.js';
import { syncFalso, tareaDe } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import { ErrorOp } from '../openproject/errores.js';
import { cifrar } from '../seguridad/cifrado.js';
import { crearCache } from '../sync/cache.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
// Lunes 26/10/2026, hora argentina.
const en = (hhmm: string, dia = '2026-10-26'): Date => new Date(`${dia}T${hhmm}:00-03:00`);
const CATALOGO = {
  estados: [{ id: 10, nombre: 'New', cerrado: false, color: '#fff' }, { id: 12, nombre: 'Closed', cerrado: true, color: '#000' }],
  tipos: [], prioridades: [], proyectos: [], versiones: [], personas: [], asignables: {}, semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [],
} as CatalogoOp;

describe('rutas de horas', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;
  let ahora: Date;
  // Por defecto OpenProject "no responde": la carga queda pendiente. Una prueba puede poner uno que sí.
  let clienteOp: Record<string, unknown>;

  const pedir = (metodo: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, cookies: { od_sesion: sesion } });
  const arrancar = (tareaId = 100) => pedir('POST', '/api/horas', { tareaId });
  const estado = async (): Promise<EstadoHoras> => (await pedir('GET', '/api/horas')).json().datos;
  const fila = (id: number) => db.prepare('select * from tramos_trabajo where id = ?').get(id) as Record<string, unknown>;

  /** Un tramo ya cerrado (o abierto, con `fin` null) puesto directo en la base, con un solo pedazo. */
  const insertarTramo = (usuario: number, tarea: number, dia: string, desde: string, fin: string | null, segundos: number | null, estadoTramo = 'pendiente'): number => {
    const id = Number(db.prepare(`insert into tramos_trabajo (usuario_id, tarea_id, dia, inicio, fin, segundos, estado, creado) values (?,?,?,?,?,?,?,?)`)
      .run(usuario, tarea, dia, en(desde, dia).toISOString(), fin === null ? null : en(fin, dia).toISOString(), segundos,
        fin === null ? 'abierto' : estadoTramo, en('08:00', dia).toISOString()).lastInsertRowid);
    db.prepare('insert into pedazos_trabajo (tramo_id, desde, hasta) values (?,?,?)').run(id, en(desde, dia).toISOString(), fin === null ? null : en(fin, dia).toISOString());
    return id;
  };

  beforeEach(async () => {
    ahora = en('09:00');
    const sinRed = async (): Promise<never> => { throw new ErrorOp('red', 'sin red'); };
    clienteOp = { entradasDeTiempo: sinRed, crearEntradaTiempo: sinRed, editarEntradaTiempo: sinRed, borrarEntradaTiempo: sinRed, tarea: sinRed };
    db = abrirDb(':memory:');
    app = await crearApp({ config, db, crearCliente: () => clienteOp as never, ahora: () => ahora, sync: syncFalso() });
    const insertar = db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (?,?,?,'h',?,?)");
    const token = (id: number): string => cifrar('tok', config.claveCifrado, `usuario:${id}`);
    insertar.run(9, 'rmedina', 'Ramiro', token(9), ahora.toISOString());
    insertar.run(8, 'colega', 'Colega', token(8), ahora.toISOString());
    insertar.run(7, 'ajeno', 'Ajeno', token(7), ahora.toISOString());
    db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (9, 1), (8, 1), (7, 3)').run();
    const cache = crearCache(db);
    cache.guardarCatalogo(CATALOGO);
    cache.guardarTareas([
      tareaDe(100, { proyectoId: 1, estadoId: 10, responsableId: 8 }), tareaDe(101, { proyectoId: 1, estadoId: 10 }),
      tareaDe(102, { proyectoId: 1, estadoId: 12 }), tareaDe(300, { proyectoId: 3, estadoId: 10, responsableId: 7 }),
    ]);
    sesion = crearSesion(db, 9, ahora);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/horas' })).statusCode).toBe(401);
  });

  it('arrancar, pausar, seguir y terminar cuenta solo lo activo', async () => {
    const t = (await arrancar()).json().datos as Tramo;
    expect(t).toMatchObject({ usuarioId: 9, tareaId: 100, dia: '2026-10-26', fin: null, estado: 'abierto' });
    ahora = en('10:00');
    expect((await pedir('POST', `/api/horas/${t.id}/pausa`)).json().datos.pausado).toBe(true);
    ahora = en('11:00');
    expect((await pedir('POST', `/api/horas/${t.id}/seguir`)).json().datos.pausado).toBe(false);
    ahora = en('12:00');
    const fin = (await pedir('POST', `/api/horas/${t.id}/terminar`)).json().datos as Tramo;
    expect(fin).toMatchObject({ segundos: 7200, estado: 'pendiente', fin: en('12:00').toISOString() });
    const e = await estado();
    expect(e.enMarcha).toEqual([]);
    expect(e.totalHoySegundos).toBe(7200);
    expect(e.jornadaSegundos).toBe(28800);
  });

  it('terminar carga en OpenProject y responde con el tramo cargado', async () => {
    const llamadas: unknown[] = [];
    clienteOp = {
      entradasDeTiempo: async () => [],
      crearEntradaTiempo: async (d: unknown) => { llamadas.push(d); return { id: 321 }; },
      tarea: async () => tareaDe(100, { proyectoId: 1, estadoId: 10, horasReales: 1 }),
    };
    const t = (await arrancar()).json().datos as Tramo;
    ahora = en('10:00');
    const fin = (await pedir('POST', `/api/horas/${t.id}/terminar`)).json().datos as Tramo;
    expect(fin).toMatchObject({ estado: 'cargado', entradaOpId: 321, segundos: 3600 });
    expect(llamadas).toEqual([{ tareaId: 100, dia: '2026-10-26', horasIso: 'PT1H', comentario: `OpenDash · tramo ${t.id}` }]);
  });

  it('sin varias a la vez, arrancar otra termina la anterior', async () => {
    const a = (await arrancar(100)).json().datos as Tramo;
    ahora = en('10:00');
    await arrancar(101);
    expect(fila(a.id)).toMatchObject({ segundos: 3600, estado: 'pendiente' });
    expect((await estado()).enMarcha.map((t) => t.tareaId)).toEqual([101]);
  });

  it('con varias a la vez, corren juntas y cada una cuenta su tiempo entero', async () => {
    expect((await pedir('PATCH', '/api/cuenta', { variasALaVez: true })).json().datos.variasALaVez).toBe(true);
    const a = (await arrancar(100)).json().datos as Tramo;
    const b = (await arrancar(101)).json().datos as Tramo;
    ahora = en('10:00');
    const vivo = await estado();
    expect(vivo.enMarcha.map((t) => t.segundosVivos)).toEqual([3600, 3600]);
    expect(vivo.totalHoySegundos).toBe(3600);
    ahora = en('11:00');
    await pedir('POST', `/api/horas/${a.id}/terminar`);
    await pedir('POST', `/api/horas/${b.id}/terminar`);
    expect(fila(a.id)).toMatchObject({ segundos: 7200, medidos: 7200 });
    expect(fila(b.id)).toMatchObject({ segundos: 7200, medidos: 7200 });
    expect((await estado()).totalHoySegundos).toBe(7200);
  });

  it('con varias a la vez, el tope de 8 h es de reloj y frena a todas juntas', async () => {
    await pedir('PATCH', '/api/cuenta', { variasALaVez: true });
    insertarTramo(9, 102, '2026-10-26', '01:00', '08:00', 7 * 3600);
    ahora = en('09:00');
    const a = (await arrancar(100)).json().datos as Tramo;
    ahora = en('09:30');
    const b = (await arrancar(101)).json().datos as Tramo;
    ahora = en('11:00');
    const e = await estado();
    expect(e.enMarcha).toEqual([]);
    expect(e.totalHoySegundos).toBe(8 * 3600);
    expect(fila(a.id)).toMatchObject({ fin: en('10:00').toISOString(), frenado_solo: 'tope', segundos: 3600 });
    expect(fila(b.id)).toMatchObject({ fin: en('10:00').toISOString(), frenado_solo: 'tope', segundos: 1800 });
  });

  it('corregir un tramo que corrió junto con otro mueve el día solo en la diferencia', async () => {
    await pedir('PATCH', '/api/cuenta', { variasALaVez: true });
    const a = (await arrancar(100)).json().datos as Tramo;
    const b = (await arrancar(101)).json().datos as Tramo;
    ahora = en('11:00');
    await pedir('POST', `/api/horas/${a.id}/terminar`);
    await pedir('POST', `/api/horas/${b.id}/terminar`);
    expect((await pedir('PATCH', `/api/horas/${a.id}`, { segundos: 3 * 3600 })).statusCode).toBe(200);
    expect((await estado()).totalHoySegundos).toBe(3 * 3600);
    expect(fila(b.id).segundos).toBe(7200);
  });

  it('dos pedidos a la vez no dejan dos abiertos', async () => {
    const [x, y] = await Promise.all([arrancar(), arrancar()]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(db.prepare('select count(*) from tramos_trabajo where fin is null').pluck().get()).toBe(1);
  });

  it('fin de semana o feriado no arranca', async () => {
    ahora = en('10:00', '2026-10-24');
    const sab = await arrancar();
    expect(sab.statusCode).toBe(409);
    expect(sab.json().mensaje).toBe('No se cuentan horas los fines de semana ni los feriados');
    ahora = en('10:00');
    db.prepare("insert into feriados_lista (fecha, nombre, puente) values ('2026-10-26', 'Puente', 1)").run();
    expect((await arrancar()).statusCode).toBe(409);
    expect(db.prepare('select count(*) from tramos_trabajo').pluck().get()).toBe(0);
  });

  it('con el día lleno no arranca', async () => {
    insertarTramo(9, 101, '2026-10-26', '00:30', '08:30', 28800);
    const r = await arrancar();
    expect(r.statusCode).toBe(409);
    expect(r.json().mensaje).toBe('Ya llegaste a las 8 h de hoy');
  });

  it('se frena solo al llegar a las 8 h', async () => {
    insertarTramo(9, 101, '2026-10-26', '08:00', '15:00', 7 * 3600);
    ahora = en('15:00');
    const t = (await arrancar()).json().datos as Tramo;
    ahora = en('16:30');
    const e = await estado();
    expect(e.enMarcha).toEqual([]);
    expect(e.hoy.find((x) => x.id === t.id)).toMatchObject({ fin: en('16:00').toISOString(), frenadoSolo: 'tope', segundos: 3600 });
    expect(e.avisos.map((x) => x.id)).toContain(t.id);
    expect(e.totalHoySegundos).toBe(8 * 3600);
  });

  describe('horas extra', () => {
    it('con el día lleno, confirmar horas extra deja arrancar y el estado lo dice', async () => {
      insertarTramo(9, 101, '2026-10-26', '00:30', '08:30', 28800);
      expect((await estado()).horasExtra).toBe(false);
      const r = await pedir('POST', '/api/horas/extra');
      expect(r.statusCode).toBe(200);
      expect((r.json().datos as EstadoHoras).horasExtra).toBe(true);
      expect((await arrancar()).statusCode).toBe(200);
      // Es solo de hoy: al día siguiente vuelve el tope.
      ahora = en('09:00', '2026-10-27');
      expect((await estado()).horasExtra).toBe(false);
    });

    it('con horas extra el tope no frena: el tramo sigue y cuenta su tiempo entero', async () => {
      insertarTramo(9, 101, '2026-10-26', '08:00', '15:00', 7 * 3600);
      ahora = en('15:00');
      const t = (await arrancar()).json().datos as Tramo;
      await pedir('POST', '/api/horas/extra');
      ahora = en('18:00');
      const e = await estado();
      expect(e.enMarcha.map((x) => x.id)).toEqual([t.id]);
      expect(e.totalHoySegundos).toBe(10 * 3600);
      ahora = en('18:30');
      const cerrado = (await pedir('POST', `/api/horas/${t.id}/terminar`)).json().datos as Tramo;
      expect(cerrado).toMatchObject({ segundos: 3.5 * 3600, frenadoSolo: null });
    });

    it('con horas extra la medianoche sigue cortando', async () => {
      insertarTramo(9, 101, '2026-10-26', '08:00', '16:00', 8 * 3600);
      ahora = en('22:00');
      await pedir('POST', '/api/horas/extra');
      const t = (await arrancar()).json().datos as Tramo;
      ahora = en('09:00', '2026-10-27');
      await estado();
      expect(fila(t.id)).toMatchObject({ fin: en('00:00', '2026-10-27').toISOString(), frenado_solo: 'medianoche', segundos: 7200 });
    });

    it('con horas extra corregir hacia arriba puede pasar la jornada', async () => {
      const id = insertarTramo(9, 100, '2026-10-26', '08:00', '08:30', 3600);
      insertarTramo(9, 101, '2026-10-26', '01:00', '07:00', 6 * 3600);
      await pedir('POST', '/api/horas/extra');
      expect((await pedir('PATCH', `/api/horas/${id}`, { segundos: 3 * 3600 })).statusCode).toBe(200);
      expect(fila(id).segundos).toBe(3 * 3600);
    });

    it('no se marcan en fin de semana', async () => {
      ahora = en('10:00', '2026-10-31');
      expect((await pedir('POST', '/api/horas/extra')).statusCode).toBe(409);
      expect(db.prepare('select count(*) from horas_extra').pluck().get()).toBe(0);
    });
  });

  describe('último día trabajado', () => {
    it('trae las tareas del último día con horas, en el orden en que se arrancaron, sin descartadas ni las de hoy', async () => {
      insertarTramo(9, 100, '2026-10-21', '09:00', '10:00', 3600);
      insertarTramo(9, 101, '2026-10-23', '11:00', '12:00', 3600);
      insertarTramo(9, 100, '2026-10-23', '09:00', '10:00', 3600);
      insertarTramo(9, 101, '2026-10-23', '14:00', '15:00', 3600);
      insertarTramo(9, 300, '2026-10-23', '16:00', '16:01', 60, 'descartado');
      insertarTramo(8, 102, '2026-10-23', '09:00', '10:00', 3600);
      ahora = en('08:00');
      insertarTramo(9, 102, '2026-10-26', '07:00', '07:30', 1800);
      expect((await estado()).ultimoDia).toEqual({ dia: '2026-10-23', tareaIds: [100, 101] });
    });

    it('más de dos semanas atrás no cuenta', async () => {
      insertarTramo(9, 100, '2026-10-09', '09:00', '10:00', 3600);
      expect((await estado()).ultimoDia).toBeNull();
    });
  });

  it('se frena solo a la medianoche', async () => {
    ahora = en('22:00');
    const t = (await arrancar()).json().datos as Tramo;
    ahora = en('09:00', '2026-10-27');
    const e = await estado();
    expect(e.enMarcha).toEqual([]);
    expect(e.hoy).toEqual([]);
    expect(fila(t.id)).toMatchObject({ fin: en('00:00', '2026-10-27').toISOString(), frenado_solo: 'medianoche', segundos: 7200 });
    expect(e.avisos.map((x) => x.id)).toContain(t.id);
    // Aviso visto: sale de la lista una vez cargado (acá sigue pendiente, así que se queda por eso).
    expect((await pedir('POST', `/api/horas/${t.id}/aviso-visto`)).statusCode).toBe(200);
    expect(fila(t.id).aviso_visto).toBe(1);
  });

  it('corregir hacia arriba no pasa la jornada', async () => {
    const id = insertarTramo(9, 100, '2026-10-26', '08:00', '08:30', 3600);
    insertarTramo(9, 101, '2026-10-26', '01:00', '07:00', 6 * 3600);
    const mal = await pedir('PATCH', `/api/horas/${id}`, { segundos: 2.5 * 3600 });
    expect(mal.statusCode).toBe(400);
    expect(mal.json().mensaje).toBe('El día no puede pasar las 8 h');
    expect(fila(id)).toMatchObject({ segundos: 3600, estado: 'pendiente' });
    const bien = await pedir('PATCH', `/api/horas/${id}`, { segundos: 2 * 3600 });
    expect(bien.statusCode).toBe(200);
    expect(fila(id).segundos).toBe(7200);
  });

  it('pasar a otra tarea mueve el tramo y vuelve a pendiente', async () => {
    const id = insertarTramo(9, 100, '2026-10-26', '08:00', '09:00', 3600, 'cargado');
    const r = await pedir('PATCH', `/api/horas/${id}`, { tareaId: 101 });
    expect(r.statusCode).toBe(200);
    expect(fila(id)).toMatchObject({ tarea_id: 101, estado: 'pendiente' });
  });

  it('cambiar de tarea carga el tramo cerrado antes de responder: sin falso pendiente', async () => {
    clienteOp = { entradasDeTiempo: async () => [], crearEntradaTiempo: async () => ({ id: 321 }), tarea: async () => tareaDe(100, { proyectoId: 1, estadoId: 10 }) };
    const a = (await arrancar(100)).json().datos as Tramo;
    ahora = en('10:00');
    await arrancar(101);
    expect(fila(a.id)).toMatchObject({ estado: 'cargado', entrada_op_id: 321 });
    expect((await estado()).avisos.filter((x) => x.estado === 'pendiente')).toEqual([]);
  });

  it('inactividad: no seguía corta en el momento indicado', async () => {
    const t = (await arrancar()).json().datos as Tramo;
    ahora = en('13:30');
    const seguia = await pedir('POST', '/api/horas/inactividad', { desde: en('12:40').toISOString(), seguia: true });
    expect(seguia.json().datos.enMarcha).toHaveLength(1);
    const r = await pedir('POST', '/api/horas/inactividad', { desde: en('12:40').toISOString(), seguia: false });
    expect(r.json().datos.enMarcha).toEqual([]);
    expect(fila(t.id)).toMatchObject({ fin: en('12:40').toISOString(), segundos: 13200 });
  });

  it('inactividad: un tramo en pausa no se corta aunque diga que no seguía', async () => {
    const t = (await arrancar()).json().datos as Tramo;
    ahora = en('10:00');
    await pedir('POST', `/api/horas/${t.id}/pausa`);
    ahora = en('13:30');
    const r = await pedir('POST', '/api/horas/inactividad', { desde: en('12:40').toISOString(), seguia: false });
    expect(r.json().datos.enMarcha).toHaveLength(1);
    expect(fila(t.id)).toMatchObject({ fin: null, estado: 'abierto' });
  });

  it('nada de lo de otra persona se toca: 404 y sin cambios', async () => {
    const abierto = insertarTramo(8, 100, '2026-10-26', '08:00', null, null);
    const cerrado = insertarTramo(8, 101, '2026-10-26', '08:00', '09:00', 3600, 'rechazado');
    const antes = JSON.stringify([fila(abierto), fila(cerrado)]);
    const pedidos: [ 'POST' | 'PATCH', string, object? ][] = [
      ['POST', `/api/horas/${abierto}/pausa`], ['POST', `/api/horas/${abierto}/seguir`], ['POST', `/api/horas/${abierto}/terminar`],
      ['PATCH', `/api/horas/${cerrado}`, { segundos: 60 }], ['PATCH', `/api/horas/${cerrado}`, { tareaId: 101 }],
      ['POST', `/api/horas/${cerrado}/descartar`], ['POST', `/api/horas/${cerrado}/reintentar`], ['POST', `/api/horas/${cerrado}/aviso-visto`],
    ];
    for (const [metodo, url, cuerpo] of pedidos) {
      const r = await pedir(metodo, url, cuerpo);
      expect(r.statusCode, `${metodo} ${url}`).toBe(404);
    }
    expect(JSON.stringify([fila(abierto), fila(cerrado)])).toBe(antes);
  });

  it('equipo: no revela la tarea de alguien si quien mira no la ve', async () => {
    insertarTramo(8, 300, '2026-10-26', '08:30', null, null);
    const r = await pedir('GET', '/api/horas/equipo?dias=7');
    expect((r.json().datos as { enMarcha: unknown[] }).enMarcha).toEqual([{ usuarioId: 8, tareaIds: [] }]);
  });

  it('inactividad con varias tareas: cada una corta en el máximo entre el aviso y su último arranque', async () => {
    await pedir('PATCH', '/api/cuenta', { variasALaVez: true });
    const a = (await arrancar(100)).json().datos as Tramo;
    ahora = en('12:50');
    const b = (await arrancar(101)).json().datos as Tramo;
    ahora = en('13:30');
    await pedir('POST', '/api/horas/inactividad', { desde: en('12:40').toISOString(), seguia: false });
    expect(fila(a.id)).toMatchObject({ fin: en('12:40').toISOString(), segundos: 13200 });
    expect(fila(b.id)).toMatchObject({ fin: en('12:50').toISOString(), segundos: 0 });
  });

  it('el índice único parcial rechaza un segundo tramo abierto de la misma tarea', () => {
    insertarTramo(9, 100, '2026-10-26', '08:00', null, null);
    expect(() => insertarTramo(9, 100, '2026-10-26', '08:30', null, null)).toThrow(/UNIQUE/);
    expect(db.prepare('select count(*) from tramos_trabajo where fin is null').pluck().get()).toBe(1);
  });

  it('sin catálogo o con un estado desconocido no se trabaja (409)', async () => {
    crearCache(db).guardarTareas([tareaDe(103, { proyectoId: 1, estadoId: 99 })]);
    const desconocido = await arrancar(103);
    expect(desconocido.statusCode).toBe(409);
    expect(desconocido.json().mensaje).toMatch(/estados/);
    db.prepare('delete from cache_catalogo').run();
    expect((await arrancar(100)).statusCode).toBe(409);
    expect(db.prepare('select count(*) from tramos_trabajo').pluck().get()).toBe(0);
  });

  it('descartar un tramo con entrada en OpenProject la borra primero', async () => {
    const borradas: number[] = [];
    clienteOp = { borrarEntradaTiempo: async (id: number) => { borradas.push(id); } };
    const id = insertarTramo(9, 100, '2026-10-26', '08:00', '09:00', 3600);
    db.prepare('update tramos_trabajo set entrada_op_id = 500 where id = ?').run(id);
    const r = await pedir('POST', `/api/horas/${id}/descartar`);
    expect(r.json().datos).toMatchObject({ estado: 'descartado', entradaOpId: null });
    expect(borradas).toEqual([500]);
  });

  it('descartar con la red caída no lo da por descartado hasta borrar la entrada', async () => {
    const id = insertarTramo(9, 100, '2026-10-26', '08:00', '09:00', 3600, 'rechazado');
    db.prepare('update tramos_trabajo set entrada_op_id = 500 where id = ?').run(id);
    const r = await pedir('POST', `/api/horas/${id}/descartar`);
    expect(r.json().datos).toMatchObject({ estado: 'pendiente', entradaOpId: 500 });
    const borradas: number[] = [];
    clienteOp = { borrarEntradaTiempo: async (e: number) => { borradas.push(e); } };
    await pedir('POST', `/api/horas/${id}/reintentar`);
    expect(fila(id)).toMatchObject({ estado: 'descartado', entrada_op_id: null });
    expect(borradas).toEqual([500]);
  });

  it('solo tareas abiertas y visibles', async () => {
    for (const tareaId of [102, 300, 999]) expect((await arrancar(tareaId)).statusCode).toBe(400);
    const id = insertarTramo(9, 100, '2026-10-26', '08:00', '09:00', 3600);
    for (const tareaId of [102, 300]) expect((await pedir('PATCH', `/api/horas/${id}`, { tareaId })).statusCode).toBe(400);
    expect(fila(id).tarea_id).toBe(100);
    expect((await pedir('POST', '/api/horas', { tareaId: 100, otro: 1 })).statusCode).toBe(400);
  });

  it('equipo: horas por persona y día y quién está trabajando', async () => {
    insertarTramo(9, 100, '2026-10-26', '08:00', '09:00', 3600);
    insertarTramo(8, 100, '2026-10-23', '08:00', '10:00', 7200);
    insertarTramo(7, 300, '2026-10-26', '08:00', '10:00', 7200);
    insertarTramo(8, 101, '2026-10-26', '08:30', null, null);
    insertarTramo(7, 300, '2026-10-26', '08:30', null, null);
    const r = await pedir('GET', '/api/horas/equipo?dias=7');
    const { dias, enMarcha } = r.json().datos as { dias: HorasPorDia[]; enMarcha: { usuarioId: number; tareaIds: number[] }[] };
    expect(dias).toEqual([{ usuarioId: 8, dia: '2026-10-23', segundos: 7200 }, { usuarioId: 9, dia: '2026-10-26', segundos: 3600 }]);
    expect(enMarcha).toEqual([{ usuarioId: 8, tareaIds: [101] }]);
    expect((await pedir('GET', '/api/horas/equipo?dias=0')).statusCode).toBe(400);
  });

  it('equipo: dos tareas a la vez suman las horas de reloj del día, no la suma de las dos', async () => {
    insertarTramo(9, 100, '2026-10-23', '08:00', '10:00', 7200);
    insertarTramo(9, 101, '2026-10-23', '09:00', '11:00', 7200);
    const r = await pedir('GET', '/api/horas/equipo?dias=7');
    expect((r.json().datos as { dias: HorasPorDia[] }).dias).toEqual([{ usuarioId: 9, dia: '2026-10-23', segundos: 3 * 3600 }]);
  });

  it('jornada del equipo y varias a la vez se guardan', async () => {
    expect((await pedir('GET', '/api/ajustes')).json().datos.horas).toEqual({ jornadaHoras: 8 });
    expect((await pedir('PUT', '/api/ajustes/horas', { jornadaHoras: 6 })).statusCode).toBe(200);
    expect((await pedir('GET', '/api/ajustes')).json().datos.horas).toEqual({ jornadaHoras: 6 });
    for (const malo of [{ jornadaHoras: 0 }, { jornadaHoras: 13 }, {}, { jornadaHoras: 6, otro: 1 }]) {
      expect((await pedir('PUT', '/api/ajustes/horas', malo)).statusCode).toBe(400);
    }
    expect((await pedir('PATCH', '/api/cuenta', { variasALaVez: 'si' })).statusCode).toBe(400);
    expect(db.prepare('select varias_a_la_vez from usuarios where id = 9').pluck().get()).toBe(0);
  });
});
