import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { crearCache } from '../sync/cache.js';
import { cargarTramo, descartarTramoSinEntrada, type DepsCarga } from './carga.js';
import { registrarCarga, tramo } from './repositorio.js';

const DIA = '2026-10-26';
const AHORA = new Date('2026-10-26T20:00:00-03:00');
const MOTIVO_422 = "Activity can't be blank.";

describe('carga de tramos en OpenProject', () => {
  let db: Database;
  let cliente: { [K in 'crearEntradaTiempo' | 'editarEntradaTiempo' | 'borrarEntradaTiempo' | 'entradasDeTiempo' | 'tarea']: ReturnType<typeof vi.fn> };
  let deps: DepsCarga;
  let sinCliente = false;

  const insertar = (tareaId: number, segundos: number | null, estado = 'pendiente', entrada: number | null = null): number => {
    const id = Number(db.prepare(`insert into tramos_trabajo (usuario_id, tarea_id, dia, inicio, fin, segundos, estado, entrada_op_id, creado)
      values (9, ?, ?, '2026-10-26T12:00:00.000Z', '2026-10-26T13:30:00.000Z', ?, ?, ?, '2026-10-26T12:00:00.000Z')`)
      .run(tareaId, DIA, segundos, estado, entrada).lastInsertRowid);
    db.prepare("insert into pedazos_trabajo (tramo_id, desde, hasta) values (?, '2026-10-26T12:00:00.000Z', '2026-10-26T13:30:00.000Z')").run(id);
    return id;
  };
  const vencido = (): number => db.prepare('select token_vencido from usuarios where id = 9').pluck().get() as number;

  beforeEach(() => {
    db = abrirDb(':memory:');
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (9, 'r', 'R', 'h', 't', ?)").run(AHORA.toISOString());
    crearCache(db).guardarTareas([tareaDe(100, { proyectoId: 1 }), tareaDe(101, { proyectoId: 1 })]);
    cliente = {
      crearEntradaTiempo: vi.fn(async () => ({ id: 500 })),
      editarEntradaTiempo: vi.fn(async () => undefined),
      borrarEntradaTiempo: vi.fn(async () => undefined),
      entradasDeTiempo: vi.fn(async () => []),
      tarea: vi.fn(async (id: number) => tareaDe(id, { proyectoId: 1, horasReales: 1.5 })),
    };
    sinCliente = false;
    deps = { db, ahora: () => AHORA, clientePara: () => (sinCliente ? null : (cliente as unknown as ClienteOp)) };
  });
  afterEach(() => db.close());

  it('terminar carga la entrada con las horas del tramo', async () => {
    const id = insertar(100, 5400);
    const t = await cargarTramo(deps, id);
    expect(cliente.crearEntradaTiempo).toHaveBeenCalledWith({ tareaId: 100, dia: DIA, horasIso: 'PT1H30M', comentario: `OpenDash · tramo ${id}` });
    expect(t).toMatchObject({ estado: 'cargado', entradaOpId: 500, motivo: null });
  });

  it('pide el cliente del dueño del tramo', async () => {
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (8, 'c', 'C', 'h', 't', ?)").run(AHORA.toISOString());
    const id = insertar(100, 3600);
    db.prepare('update tramos_trabajo set usuario_id = 8 where id = ?').run(id);
    const pedidos: number[] = [];
    await cargarTramo({ ...deps, clientePara: (usuarioId) => { pedidos.push(usuarioId); return cliente as unknown as ClienteOp; } }, id);
    expect(pedidos).toEqual([8]);
  });

  it('corregir edita la misma entrada, no crea otra', async () => {
    const id = insertar(100, 7200, 'pendiente', 500);
    cliente.entradasDeTiempo.mockResolvedValue([{ id: 500, comentario: `OpenDash · tramo ${id}` }]);
    const t = await cargarTramo(deps, id);
    expect(cliente.editarEntradaTiempo).toHaveBeenCalledWith(500, 'PT2H');
    expect(cliente.crearEntradaTiempo).not.toHaveBeenCalled();
    expect(t).toMatchObject({ estado: 'cargado', entradaOpId: 500 });
  });

  it('pasar a otra tarea borra la entrada vieja y crea la nueva', async () => {
    const id = insertar(101, 5400, 'pendiente', 500);
    cliente.entradasDeTiempo.mockResolvedValue([]); // la 500 quedó en la tarea anterior
    cliente.crearEntradaTiempo.mockResolvedValue({ id: 501 });
    const t = await cargarTramo(deps, id);
    expect(cliente.borrarEntradaTiempo).toHaveBeenCalledWith(500);
    expect(cliente.crearEntradaTiempo).toHaveBeenCalledWith(expect.objectContaining({ tareaId: 101 }));
    expect(t).toMatchObject({ estado: 'cargado', entradaOpId: 501 });
  });

  it('sin red queda pendiente y el reintento carga', async () => {
    const id = insertar(100, 5400);
    cliente.crearEntradaTiempo.mockRejectedValueOnce(new ErrorOp('red', 'sin red'));
    expect(await cargarTramo(deps, id)).toMatchObject({ estado: 'pendiente', motivo: null });
    expect(await cargarTramo(deps, id)).toMatchObject({ estado: 'cargado', entradaOpId: 500 });
  });

  it('un POST incierto no duplica', async () => {
    const id = insertar(100, 5400);
    cliente.crearEntradaTiempo.mockRejectedValueOnce(new ErrorOp('incierto', 'sin respuesta'));
    expect((await cargarTramo(deps, id)).estado).toBe('pendiente');
    cliente.entradasDeTiempo.mockResolvedValue([{ id: 777, comentario: `OpenDash · tramo ${id}` }]);
    const t = await cargarTramo(deps, id);
    expect(cliente.crearEntradaTiempo).toHaveBeenCalledTimes(1);
    expect(cliente.editarEntradaTiempo).toHaveBeenCalledWith(777, 'PT1H30M');
    expect(t).toMatchObject({ estado: 'cargado', entradaOpId: 777 });
  });

  it('token vencido queda pendiente y marca el token', async () => {
    const id = insertar(100, 5400);
    cliente.crearEntradaTiempo.mockRejectedValueOnce(new ErrorOp('no-autorizado', 'token', 401));
    expect((await cargarTramo(deps, id)).estado).toBe('pendiente');
    expect(vencido()).toBe(1);
  });

  it('sin cliente (token ya vencido) no toca nada y sigue pendiente', async () => {
    const id = insertar(100, 5400);
    sinCliente = true;
    expect((await cargarTramo(deps, id)).estado).toBe('pendiente');
    expect(cliente.crearEntradaTiempo).not.toHaveBeenCalled();
  });

  it('403 queda rechazado con el motivo', async () => {
    const id = insertar(100, 5400);
    cliente.crearEntradaTiempo.mockRejectedValueOnce(new ErrorOp('prohibido', 'x', 403));
    expect(await cargarTramo(deps, id)).toMatchObject({
      estado: 'rechazado',
      motivo: 'No tenés permiso para cargar horas en ese proyecto (o el proyecto no tiene habilitado el registro de tiempo)',
    });
  });

  it('404 y 422 quedan rechazados con su motivo', async () => {
    const a = insertar(100, 5400);
    cliente.crearEntradaTiempo.mockRejectedValueOnce(new ErrorOp('no-encontrado', 'x', 404));
    expect(await cargarTramo(deps, a)).toMatchObject({ estado: 'rechazado', motivo: 'La tarea ya no existe en OpenProject' });
    const b = insertar(100, 5400);
    cliente.crearEntradaTiempo.mockRejectedValueOnce(new ErrorOp('validacion', MOTIVO_422, 422));
    expect(await cargarTramo(deps, b)).toMatchObject({ estado: 'rechazado', motivo: MOTIVO_422 });
  });

  it('después de cargar relee la tarea y la guarda en la caché', async () => {
    const id = insertar(100, 5400);
    await cargarTramo(deps, id);
    expect(cliente.tarea).toHaveBeenCalledWith(100);
    expect(crearCache(db).tarea(100)?.horasReales).toBe(1.5);
  });

  it('si falla releer la tarea, la carga igual queda hecha', async () => {
    const id = insertar(100, 5400);
    cliente.tarea.mockRejectedValue(new ErrorOp('red', 'x'));
    expect((await cargarTramo(deps, id)).estado).toBe('cargado');
  });

  it('un tramo de menos de un minuto no se carga y se descarta', async () => {
    const id = insertar(100, 20);
    expect(await cargarTramo(deps, id)).toMatchObject({ estado: 'descartado' });
    expect(cliente.crearEntradaTiempo).not.toHaveBeenCalled();
  });

  it('un tramo con entrada corregido a menos de un minuto borra la entrada y se descarta', async () => {
    const id = insertar(100, 20, 'pendiente', 500);
    const t = await cargarTramo(deps, id);
    expect(cliente.borrarEntradaTiempo).toHaveBeenCalledWith(500);
    expect(t).toMatchObject({ estado: 'descartado', entradaOpId: null });
  });

  it('si no se puede borrar la entrada por red, el tramo sigue pendiente con su entrada', async () => {
    const id = insertar(100, 20, 'pendiente', 500);
    cliente.borrarEntradaTiempo.mockRejectedValueOnce(new ErrorOp('red', 'sin red'));
    expect(await cargarTramo(deps, id)).toMatchObject({ estado: 'pendiente', entradaOpId: 500 });
    expect(await cargarTramo(deps, id)).toMatchObject({ estado: 'descartado', entradaOpId: null });
  });

  it('si falla borrar la entrada vieja al cambiar de tarea, el motivo no es el del permiso nuevo', async () => {
    const id = insertar(101, 5400, 'pendiente', 500);
    cliente.borrarEntradaTiempo.mockRejectedValueOnce(new ErrorOp('prohibido', 'x', 403));
    expect(await cargarTramo(deps, id)).toMatchObject({
      estado: 'rechazado', motivo: 'No se pudo quitar la carga de la tarea anterior en OpenProject',
    });
    expect(cliente.crearEntradaTiempo).not.toHaveBeenCalled();
  });

  it('si la red falla al borrar la entrada vieja, queda pendiente', async () => {
    const id = insertar(101, 5400, 'pendiente', 500);
    cliente.borrarEntradaTiempo.mockRejectedValueOnce(new ErrorOp('red', 'sin red'));
    expect(await cargarTramo(deps, id)).toMatchObject({ estado: 'pendiente', motivo: null });
  });

  it('un tramo que cambió durante la carga no se pisa con «rechazado»', async () => {
    const id = insertar(100, 5400);
    const datos = { entradaOpId: null, segundos: 5400, tareaId: 100, estado: 'rechazado' as const, motivo: 'x' };
    db.prepare('update tramos_trabajo set segundos = 7200 where id = ?').run(id);
    registrarCarga(db, id, datos);
    expect(tramo(db, id)).toMatchObject({ estado: 'pendiente', motivo: null });
    db.prepare('update tramos_trabajo set segundos = 5400, tarea_id = 101 where id = ?').run(id);
    registrarCarga(db, id, datos);
    expect(tramo(db, id)?.estado).toBe('pendiente');
    db.prepare("update tramos_trabajo set tarea_id = 100, estado = 'descartado' where id = ?").run(id);
    registrarCarga(db, id, datos);
    expect(tramo(db, id)?.estado).toBe('descartado');
    db.prepare("update tramos_trabajo set estado = 'pendiente' where id = ?").run(id);
    registrarCarga(db, id, datos);
    expect(tramo(db, id)).toMatchObject({ estado: 'rechazado', motivo: 'x' });
  });

  it('si no se puede releer la tarea, se avisa en el registro con el tipo del error', async () => {
    const warn = vi.fn();
    deps = { ...deps, registro: { info: vi.fn(), warn, error: vi.fn() } };
    cliente.tarea.mockRejectedValue(new ErrorOp('red', 'x'));
    await cargarTramo(deps, insertar(100, 5400));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('red'));
  });

  it('un tramo que no existe lanza un error claro', async () => {
    await expect(cargarTramo(deps, 999)).rejects.toThrow('No existe el tramo de trabajo 999');
  });

  it('lo que no está pendiente no se toca', async () => {
    const id = insertar(100, 5400, 'cargado', 500);
    await cargarTramo(deps, id);
    expect(cliente.entradasDeTiempo).not.toHaveBeenCalled();
    expect(tramo(db, id)?.estado).toBe('cargado');
  });

  it('dos cargas a la vez del mismo tramo hacen un solo alta', async () => {
    const id = insertar(100, 5400);
    await Promise.all([cargarTramo(deps, id), cargarTramo(deps, id)]);
    expect(cliente.crearEntradaTiempo).toHaveBeenCalledTimes(1);
  });

  it('una entrada adoptada se anota aunque la edición falle después', async () => {
    const id = insertar(100, 5400);
    cliente.entradasDeTiempo.mockResolvedValue([{ id: 777, comentario: `OpenDash · tramo ${id}` }]);
    cliente.editarEntradaTiempo.mockRejectedValueOnce(new ErrorOp('prohibido', 'no', 403));
    expect(await cargarTramo(deps, id)).toMatchObject({ estado: 'rechazado', entradaOpId: 777 });
  });

  it('al pasar de tarea, la entrada de un alta incierta que quedó en la anterior se borra', async () => {
    const id = insertar(101, 5400);
    cliente.entradasDeTiempo.mockImplementation(async (f: { tareaId?: number }) => (f.tareaId === undefined ? [{ id: 600, comentario: `OpenDash · tramo ${id}` }] : []));
    cliente.crearEntradaTiempo.mockResolvedValue({ id: 601 });
    expect(await cargarTramo(deps, id)).toMatchObject({ estado: 'cargado', entradaOpId: 601 });
    expect(cliente.borrarEntradaTiempo).toHaveBeenCalledWith(600);
  });

  it('descartar sin entrada anotada busca y borra la huérfana del día', async () => {
    const id = insertar(100, 5400, 'rechazado');
    cliente.entradasDeTiempo.mockResolvedValue([{ id: 600, comentario: `OpenDash · tramo ${id}` }]);
    await descartarTramoSinEntrada(deps, id);
    expect(cliente.borrarEntradaTiempo).toHaveBeenCalledWith(600);
    expect(tramo(db, id)?.estado).toBe('descartado');
  });

  it('descartar sin entrada anotada y sin huérfana descarta; si OpenProject no responde, no', async () => {
    const a = insertar(100, 5400, 'rechazado');
    await descartarTramoSinEntrada(deps, a);
    expect(tramo(db, a)?.estado).toBe('descartado');
    const b = insertar(100, 5400, 'rechazado');
    cliente.entradasDeTiempo.mockRejectedValueOnce(new ErrorOp('red', 'x'));
    await descartarTramoSinEntrada(deps, b);
    expect(tramo(db, b)?.estado).toBe('rechazado');
  });
});
