import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogoOp, Dependencia } from '../../compartido/tipos.js';
import { syncFalso, tareaDe } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { MSG_INCIERTO } from '../errores.js';
import { ESPERA_REFRESCO_MS, MSG_OP_NO_DEJA_BORRAR, MSG_SOLO_QUIEN_LA_CREO, MSG_SUBTAREAS_AJENAS } from './escritura.js';
import { cifrar } from '../seguridad/cifrado.js';
import { crearCache } from '../sync/cache.js';
import { cerrarTramoEn, crearTramo, tramo } from '../horas/repositorio.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const proyecto = (id: number) => ({ id, nombre: `Proy ${id}`, identificador: `p${id}`, activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' });

const CATALOGO: CatalogoOp = {
  estados: [
    { id: 10, nombre: 'New', cerrado: false, color: '#fff' },
    { id: 11, nombre: 'In progress', cerrado: false, color: '#fff' },
    { id: 13, nombre: 'On hold', cerrado: false, color: '#fff' },
    { id: 12, nombre: 'Closed', cerrado: true, color: '#000' },
  ],
  tipos: [
    { id: 3, nombre: 'Milestone', esHito: true, color: '#000' },
    { id: 4, nombre: 'Feature', esHito: false, color: '#000' },
    { id: 5, nombre: 'Task', esHito: false, color: '#000' },
  ],
  prioridades: [{ id: 8, nombre: 'Normal', alta: false, nivel: 'normal' }],
  proyectos: [proyecto(1), proyecto(2)],
  versiones: [
    { id: 9, nombre: 'Finalizado', proyectoId: 1, estado: 'abierta', inicio: null, fin: null },
    { id: 7, nombre: 'En curso', proyectoId: 1, estado: 'abierta', inicio: null, fin: null },
    { id: 20, nombre: 'Otra', proyectoId: 2, estado: 'abierta', inicio: null, fin: null },
  ],
  personas: [],
  asignables: {},
  semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [],
};

describe('API de escritura de tareas', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;
  const ahora = new Date('2026-10-19T12:00:00.000Z');
  const refrescoIncremental = vi.fn(async (_usuarioId: number): Promise<void> => {});
  const sync = { ...syncFalso(), refrescoIncremental };
  const cliente = {
    tarea: vi.fn(),
    actualizarTarea: vi.fn(),
    crearTarea: vi.fn(),
    comentar: vi.fn(),
    actividades: vi.fn(),
    crearDependencia: vi.fn(),
    dependencias: vi.fn(),
    tareas: vi.fn(),
    borrarDependencia: vi.fn(),
    borrarTarea: vi.fn(),
    puedeBorrarTarea: vi.fn(),
    adjuntos: vi.fn(),
  };
  const crearCliente = vi.fn((_token: string) => cliente as unknown as ClienteOp);
  const cache = () => crearCache(db);
  const conSesion = (metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, cookies: { od_sesion: sesion }, ...(payload === undefined ? {} : { payload: payload as object }) });

  beforeEach(async () => {
    db = abrirDb(':memory:');
    Object.values(cliente).forEach((f) => f.mockReset());
    crearCliente.mockClear();
    refrescoIncremental.mockReset();
    refrescoIncremental.mockResolvedValue(undefined);
    cliente.actualizarTarea.mockImplementation(async (id: number, lock: number) => tareaDe(id, { lockVersion: lock + 1, proyectoId: 1 }));
    cliente.actividades.mockResolvedValue([]);
    app = await crearApp({ config, db, crearCliente, ahora: () => ahora, sync });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (9, 'ana', 'Ana', 'h', ?, 0, ?)")
      .run(cifrar('token-de-ana', config.claveCifrado), ahora.toISOString());
    db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (9, 1)').run();
    sesion = crearSesion(db, 9, ahora);
    cache().guardarCatalogo(CATALOGO);
    cache().guardarTareas([tareaDe(339, { proyectoId: 1 }), tareaDe(50, { proyectoId: 2 }), tareaDe(1, { proyectoId: 1 })]);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe('mover', () => {
    it('a cerrado manda estado Closed, versión Finalizado si el proyecto la tiene y el fin del día del cierre', async () => {
      const r = await conSesion('POST', '/api/tareas/339/mover', { lockVersion: 4, columna: 'cerrado' });
      expect(r.statusCode).toBe(200);
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(339, 4, { estadoId: 12, versionId: 9, fin: '2026-10-19' });
    });

    it('al cerrar corre el fin al día del cierre, antes o después del plazo, y trae lo que OpenProject reprogramó', async () => {
      cache().guardarTareas([tareaDe(1, { proyectoId: 1, inicio: '2026-10-12', fin: '2026-10-30' }), tareaDe(2, { proyectoId: 1, inicio: '2026-10-01', fin: '2026-10-09' })]);
      cliente.actualizarTarea.mockImplementation(async (id: number, lock: number, c: { fin?: string }) => tareaDe(id, { lockVersion: lock + 1, proyectoId: 1, fin: c.fin ?? null }));
      await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'cerrado' });
      await conSesion('POST', '/api/tareas/2/mover', { lockVersion: 1, columna: 'cerrado' });
      expect(cliente.actualizarTarea).toHaveBeenNthCalledWith(1, 1, 1, { estadoId: 12, versionId: 9, fin: '2026-10-19' });
      expect(cliente.actualizarTarea).toHaveBeenNthCalledWith(2, 2, 1, { estadoId: 12, versionId: 9, fin: '2026-10-19' });
      expect(refrescoIncremental).toHaveBeenCalledTimes(2);
    });

    it('si la tarea empezaba después del cierre, también corre el inicio', async () => {
      cache().guardarTareas([tareaDe(1, { proyectoId: 1, inicio: '2026-10-21', fin: '2026-10-23' })]);
      await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'cerrado' });
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(1, 1, { estadoId: 12, versionId: 9, inicio: '2026-10-19', fin: '2026-10-19' });
    });

    it('no toca las fechas de un hito, de una tarea con subtareas ni de una que ya vence ese día', async () => {
      cache().guardarTareas([
        tareaDe(1, { proyectoId: 1, tipoId: 3, inicio: '2026-10-23', fin: '2026-10-23' }),
        tareaDe(2, { proyectoId: 1, inicio: '2026-10-12', fin: '2026-10-30' }), tareaDe(3, { proyectoId: 1, madreId: 2 }),
        tareaDe(4, { proyectoId: 1, inicio: '2026-10-12', fin: '2026-10-19' }),
      ]);
      for (const id of [1, 2, 4]) await conSesion('POST', `/api/tareas/${id}/mover`, { lockVersion: 1, columna: 'cerrado' });
      expect(cliente.actualizarTarea.mock.calls.map((c) => c[2])).toEqual(Array(3).fill({ estadoId: 12, versionId: 9 }));
      expect(refrescoIncremental).not.toHaveBeenCalled();
    });

    it('no corre las fechas al reabrir ni al mover una tarea que ya estaba cerrada', async () => {
      cache().guardarTareas([tareaDe(1, { proyectoId: 1, estadoId: 12, fin: '2026-10-30' }), tareaDe(2, { proyectoId: 1, estadoId: 12, fin: '2026-10-30' })]);
      await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'cerrado' });
      await conSesion('POST', '/api/tareas/2/mover', { lockVersion: 1, columna: 'nuevo' });
      expect(cliente.actualizarTarea.mock.calls.map((c) => c[2])).toEqual([{ estadoId: 12, versionId: 9 }, { estadoId: 10 }]);
    });

    it('al cerrar deja el trabajo restante en 0; sin restante no lo manda', async () => {
      cache().guardarTareas([tareaDe(1, { proyectoId: 1, fin: '2026-10-19', restanteHoras: 8 }), tareaDe(2, { proyectoId: 1, fin: '2026-10-19', restanteHoras: 0 })]);
      await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'cerrado' });
      await conSesion('POST', '/api/tareas/2/mover', { lockVersion: 1, columna: 'cerrado' });
      expect(cliente.actualizarTarea.mock.calls.map((c) => c[2])).toEqual([{ estadoId: 12, versionId: 9, restanteHoras: 0 }, { estadoId: 12, versionId: 9 }]);
    });

    it('al reabrir no toca el trabajo restante', async () => {
      cache().guardarTareas([tareaDe(1, { proyectoId: 1, estadoId: 12, restanteHoras: 3 })]);
      await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'nuevo' });
      expect(cliente.actualizarTarea.mock.calls[0]![2]).toEqual({ estadoId: 10 });
    });

    it('si OpenProject rechaza el restante, cierra igual con las fechas', async () => {
      cache().guardarTareas([tareaDe(1, { proyectoId: 1, inicio: '2026-10-12', fin: '2026-10-30', restanteHoras: 4 })]);
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('validacion', 'Trabajo restante no es válido', 422, { atributos: ['remainingTime'] }));
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'cerrado' });
      expect(r.statusCode).toBe(200);
      expect(cliente.actualizarTarea.mock.calls.map((c) => c[2])).toEqual([
        { estadoId: 12, versionId: 9, fin: '2026-10-19', restanteHoras: 0 }, { estadoId: 12, versionId: 9, fin: '2026-10-19' },
      ]);
    });

    it('si OpenProject rechaza las fechas, cierra igual sin tocarlas', async () => {
      cache().guardarTareas([tareaDe(1, { proyectoId: 1, inicio: '2026-10-26', fin: '2026-10-28', programacionManual: false })]);
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('validacion', 'Start date no puede ser anterior', 422, { atributos: ['startDate'] }));
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'cerrado' });
      expect(r.statusCode).toBe(200);
      expect(cliente.actualizarTarea.mock.calls.map((c) => c[2])).toEqual([
        { estadoId: 12, versionId: 9, inicio: '2026-10-19', fin: '2026-10-19' }, { estadoId: 12, versionId: 9 },
      ]);
    });

    it('mover a En curso escribe el estado mapeado', async () => {
      cache().guardarCatalogo({ ...CATALOGO, estados: [...CATALOGO.estados, { id: 15, nombre: 'En revisión', cerrado: false, color: '#fff' }] });
      db.prepare("insert into ajustes (clave, valor) values ('tablero', ?)").run(JSON.stringify({ nuevo: null, curso: 15, pausa: null, cerrado: null }));
      await conSesion('POST', '/api/tareas/339/mover', { lockVersion: 1, columna: 'curso' });
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(339, 1, { estadoId: 15, versionId: 7 });
    });

    it('crear con el estado mapeado a En curso asigna la versión de esa columna', async () => {
      cache().guardarCatalogo({ ...CATALOGO, estados: [...CATALOGO.estados, { id: 15, nombre: 'En revisión', cerrado: false, color: '#fff' }] });
      db.prepare("insert into ajustes (clave, valor) values ('tablero', ?)").run(JSON.stringify({ nuevo: null, curso: 15, pausa: null, cerrado: null }));
      cliente.crearTarea.mockResolvedValue(tareaDe(900, { proyectoId: 1 }));
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1, estadoId: 15 });
      expect(cliente.crearTarea).toHaveBeenCalledWith({ titulo: 'N', proyectoId: 1, tipoId: 5, estadoId: 15, versionId: 7 });
    });

    it('mover a una columna sin estado mapeado ni por nombre responde 422', async () => {
      cache().guardarCatalogo({ ...CATALOGO, estados: CATALOGO.estados.filter((e) => e.nombre !== 'In progress') });
      const r = await conSesion('POST', '/api/tareas/339/mover', { lockVersion: 1, columna: 'curso' });
      expect(r.statusCode).toBe(422);
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    });

    it('a cerrado en un proyecto sin esa versión no manda versionId', async () => {
      await conSesion('POST', '/api/tareas/50/mover', { lockVersion: 1, columna: 'cerrado' });
      const cambios = cliente.actualizarTarea.mock.calls[0]![2] as object;
      expect(cambios).toEqual({ estadoId: 12, fin: '2026-10-19' });
      expect('versionId' in cambios).toBe(false);
    });

    it('a nuevo no manda versionId', async () => {
      await conSesion('POST', '/api/tareas/339/mover', { lockVersion: 1, columna: 'nuevo' });
      const cambios = cliente.actualizarTarea.mock.calls[0]![2] as object;
      expect(cambios).toEqual({ estadoId: 10 });
      expect('versionId' in cambios).toBe(false);
    });

    it('usa solo las versiones del proyecto de esa tarea', async () => {
      await conSesion('POST', '/api/tareas/339/mover', { lockVersion: 1, columna: 'curso' });
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(339, 1, { estadoId: 11, versionId: 7 });
    });

    it('si la tarea no está en la caché toma el proyecto de OpenProject', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(777, { proyectoId: 1 }));
      await conSesion('POST', '/api/tareas/777/mover', { lockVersion: 2, columna: 'cerrado' });
      expect(cliente.tarea).toHaveBeenCalledWith(777);
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(777, 2, { estadoId: 12, versionId: 9, fin: '2026-10-19' });
    });

    it('transición rechazada responde transicion-no-permitida con el motivo', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('validacion', 'Estado no es válido', 422));
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'pausa' });
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'transicion-no-permitida', mensaje: 'Estado no es válido' });
    });

    it('un 422 de versión inválida al mover sale como validacion, no como transición', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('validacion', 'Versión no es válido', 422));
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'pausa' });
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'validacion', mensaje: 'Versión no es válido' });
    });

    it('un 422 que habla del estado sale como transicion-no-permitida', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('validacion', 'Status cannot be changed', 422));
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'pausa' });
      expect(r.json()).toMatchObject({ codigo: 'transicion-no-permitida', mensaje: 'Status cannot be changed' });
    });

    it('mover a una columna cuyo estado no existe responde 422 con el nombre del estado', async () => {
      cache().guardarCatalogo({ ...CATALOGO, estados: CATALOGO.estados.filter((e) => e.nombre !== 'On hold') });
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'pausa' });
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ codigo: 'validacion', mensaje: 'Falta el estado «On hold» en OpenProject' });
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    });

    it('un conflicto al mover sigue siendo conflicto', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('conflicto', 'x'));
      expect((await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'pausa' })).json()).toMatchObject({ codigo: 'conflicto' });
    });

    it('ante un conflicto relee la tarea y deja la versión nueva en la caché antes de responder 409', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('conflicto', 'x'));
      cliente.tarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 7, proyectoId: 1, titulo: 'Cambiada por otro' }));
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'pausa' });
      expect(r.statusCode).toBe(409);
      expect(cliente.tarea).toHaveBeenCalledWith(1);
      expect(cache().tarea(1)).toMatchObject({ lockVersion: 7, titulo: 'Cambiada por otro' });
    });

    it('tras un 409 la relectura guarda la copia de OpenProject aunque su lockVersion sea menor', async () => {
      crearCache(db, () => new Date('2026-10-19T11:00:00.000Z')).guardarTareas([tareaDe(1, { lockVersion: 9, proyectoId: 1 })]);
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('conflicto', 'x'));
      cliente.tarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 4, proyectoId: 1, titulo: 'Base restaurada' }));
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 9, columna: 'pausa' });
      expect(r.statusCode).toBe(409);
      expect(cache().tarea(1)).toMatchObject({ lockVersion: 4, titulo: 'Base restaurada' });
    });

    it('si la relectura tras el conflicto falla, responde 409 igual y deja la caché', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('conflicto', 'x'));
      cliente.tarea.mockRejectedValueOnce(new ErrorOp('red', 'x'));
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'pausa' });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'conflicto' });
      expect(cache().tarea(1)?.lockVersion).toBe(1);
    });

    it('sin catálogo cargado responde 503 sin-conexion', async () => {
      db.prepare('delete from cache_catalogo').run();
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'curso' });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'sin-conexion', mensaje: 'Todavía se están cargando los datos de OpenProject; probá en un momento.' });
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    });

    it('rechaza una columna inexistente y lockVersion inválido', async () => {
      expect((await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1, columna: 'otra' })).statusCode).toBe(400);
      expect((await conSesion('POST', '/api/tareas/1/mover', { lockVersion: -1, columna: 'curso' })).statusCode).toBe(400);
      expect((await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 1.5, columna: 'curso' })).statusCode).toBe(400);
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    });

    it('actualiza la caché con la tarea devuelta y fija el cierre al cerrar', async () => {
      cliente.actualizarTarea.mockResolvedValueOnce(
        tareaDe(1, { lockVersion: 5, proyectoId: 1, estadoId: 12, actualizada: '2026-10-19T11:59:00Z' }),
      );
      const r = await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 4, columna: 'cerrado' });
      expect(r.json().datos).toMatchObject({ id: 1, lockVersion: 5, estadoId: 12, cerradaEl: '2026-10-19T11:59:00Z' });
      expect(cache().tarea(1)).toMatchObject({ lockVersion: 5, estadoId: 12, cerradaEl: '2026-10-19T11:59:00Z' });
    });

    it('al reabrir quita el cierre de la caché', async () => {
      cache().guardarCierre(1, '2026-10-01T00:00:00Z');
      cliente.actualizarTarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 5, proyectoId: 1, estadoId: 10 }));
      await conSesion('POST', '/api/tareas/1/mover', { lockVersion: 4, columna: 'nuevo' });
      expect(cache().tarea(1)?.cerradaEl).toBeNull();
    });
  });

  describe('PATCH /api/tareas/:id', () => {
    it('responde conflicto ante 409', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('conflicto', 'conflicting modifications'));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { titulo: 'x' } });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'conflicto' });
    });

    it('ante un 409 relee la tarea con el token de quien actúa y la caché queda con el lockVersion nuevo', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('conflicto', 'conflicting modifications'));
      cliente.tarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 9, proyectoId: 1, titulo: 'De Martín' }));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { titulo: 'x' } });
      expect(r.statusCode).toBe(409);
      expect(crearCliente).toHaveBeenLastCalledWith('token-de-ana');
      expect(cliente.tarea).toHaveBeenCalledWith(1);
      expect(cache().tarea(1)).toMatchObject({ lockVersion: 9, titulo: 'De Martín' });
    });

    it('otro error no relee la tarea', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('validacion', 'Fecha inválida'));
      await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { titulo: 'x' } });
      expect(cliente.tarea).not.toHaveBeenCalled();
    });

    it('una validación de OpenProject sigue siendo validacion', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('validacion', 'Fecha inválida'));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { titulo: 'x' } });
      expect(r.json()).toMatchObject({ codigo: 'validacion', mensaje: 'Fecha inválida' });
    });

    it('manda los cambios tal cual y guarda la tarea en la caché', async () => {
      cliente.actualizarTarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 3, proyectoId: 1, titulo: 'Nuevo' }));
      const r = await conSesion('PATCH', '/api/tareas/1', {
        lockVersion: 2,
        cambios: { titulo: 'Nuevo', responsableId: null, fin: '2026-11-01', estimacionHoras: 2.5 },
      });
      expect(r.statusCode).toBe(200);
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(1, 2, { titulo: 'Nuevo', responsableId: null, fin: '2026-11-01', estimacionHoras: 2.5 });
      expect(cache().tarea(1)).toMatchObject({ titulo: 'Nuevo', lockVersion: 3 });
      expect(r.json().datos).toMatchObject({ titulo: 'Nuevo', lockVersion: 3 });
    });

    it('guardar fechas refresca lo que OpenProject reprogramó', async () => {
      // OpenProject corre solo a las sucesoras automáticas: el refresco las trae a la caché antes de responder.
      let terminado = false;
      refrescoIncremental.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 10));
        cache().guardarTareas([tareaDe(339, { proyectoId: 1, lockVersion: 2, inicio: '2026-11-09', fin: '2026-11-10' })]);
        terminado = true;
      });
      cliente.actualizarTarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 3, proyectoId: 1, inicio: '2026-11-02', fin: '2026-11-03' }));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { inicio: '2026-11-02', fin: '2026-11-03' } });
      expect(r.statusCode).toBe(200);
      expect(refrescoIncremental).toHaveBeenCalledWith(9);
      expect(terminado).toBe(true);
      expect(cache().tarea(339)).toMatchObject({ inicio: '2026-11-09', lockVersion: 2 });
    });

    it('un cambio de fecha de hito también refresca, y uno de título no', async () => {
      cliente.actualizarTarea.mockResolvedValue(tareaDe(1, { lockVersion: 3, proyectoId: 1 }));
      await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { titulo: 'x' } });
      expect(refrescoIncremental).not.toHaveBeenCalled();
      await conSesion('PATCH', '/api/tareas/1', { lockVersion: 3, cambios: { fecha: '2026-11-02' } });
      expect(refrescoIncremental).toHaveBeenCalledTimes(1);
    });

    it('si el refresco falla, la respuesta del guardado sale igual', async () => {
      refrescoIncremental.mockRejectedValueOnce(new Error('sin red'));
      cliente.actualizarTarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 3, proyectoId: 1, inicio: '2026-11-02', fin: '2026-11-03' }));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { inicio: '2026-11-02' } });
      expect(r.statusCode).toBe(200);
      expect(r.json().datos).toMatchObject({ lockVersion: 3 });
    });

    it('si el refresco tarda más de 3 s, guardar fechas responde igual', async () => {
      // Un refresco que no termina nunca: el guardado espera el tope y responde; el refresco queda corriendo solo.
      refrescoIncremental.mockImplementationOnce(() => new Promise<void>(() => {}));
      cliente.actualizarTarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 3, proyectoId: 1, inicio: '2026-11-02', fin: '2026-11-03' }));
      const desde = Date.now();
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { inicio: '2026-11-02' } });
      expect(r.statusCode).toBe(200);
      expect(r.json().datos).toMatchObject({ lockVersion: 3 });
      expect(Date.now() - desde).toBeGreaterThanOrEqual(ESPERA_REFRESCO_MS - 100);
      expect(Date.now() - desde).toBeLessThan(ESPERA_REFRESCO_MS + 2000);
    }, 10_000);

    it('un guardado que falla no refresca', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('conflicto', 'conflicting modifications'));
      await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { inicio: '2026-11-02' } });
      expect(refrescoIncremental).not.toHaveBeenCalled();
    });

    it('el PATCH acepta fecha para un hito', async () => {
      cliente.actualizarTarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 3, proyectoId: 1, inicio: '2026-11-02', fin: '2026-11-02' }));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { fecha: '2026-11-02' } });
      expect(r.statusCode).toBe(200);
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(1, 2, { fecha: '2026-11-02' });
    });

    it.each([
      ['cambios vacíos', { lockVersion: 1, cambios: {} }],
      ['sin cambios', { lockVersion: 1 }],
      ['clave desconocida en cambios', { lockVersion: 1, cambios: { foo: 1 } }],
      ['clave desconocida arriba', { lockVersion: 1, cambios: { titulo: 'x' }, extra: 1 }],
      ['lockVersion negativo', { lockVersion: -1, cambios: { titulo: 'x' } }],
      ['lockVersion no entero', { lockVersion: 1.2, cambios: { titulo: 'x' } }],
      ['fecha mal formada', { lockVersion: 1, cambios: { inicio: '19/10/2026' } }],
      ['fecha inexistente', { lockVersion: 1, cambios: { fin: '2026-02-30' } }],
      ['fecha de hito mal formada', { lockVersion: 1, cambios: { fecha: '2/11/2026' } }],
      ['estimación negativa', { lockVersion: 1, cambios: { estimacionHoras: -1 } }],
      ['estadoId nulo', { lockVersion: 1, cambios: { estadoId: null } }],
      ['estadoId cero', { lockVersion: 1, cambios: { estadoId: 0 } }],
      ['título vacío', { lockVersion: 1, cambios: { titulo: '' } }],
      ['título de 256', { lockVersion: 1, cambios: { titulo: 'a'.repeat(256) } }],
      ['madreId decimal', { lockVersion: 1, cambios: { madreId: 1.5 } }],
    ])('rechaza con 400: %s', async (_n, cuerpo) => {
      const r = await conSesion('PATCH', '/api/tareas/1', cuerpo);
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'validacion' });
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    });

    it('rechaza una estimación infinita', async () => {
      const r = await app.inject({
        method: 'PATCH', url: '/api/tareas/1', cookies: { od_sesion: sesion }, headers: { 'content-type': 'application/json' },
        payload: '{"lockVersion":1,"cambios":{"estimacionHoras":1e999}}',
      });
      expect(r.statusCode).toBe(400);
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    });

    it('acepta fechas y referencias nulas', async () => {
      const r = await conSesion('PATCH', '/api/tareas/1', {
        lockVersion: 1, cambios: { inicio: null, fin: null, estimacionHoras: null, madreId: null, versionId: null, responsableId: null },
      });
      expect(r.statusCode).toBe(200);
    });

    it('rechaza un id mal formado', async () => {
      expect((await conSesion('PATCH', '/api/tareas/abc', { lockVersion: 1, cambios: { titulo: 'x' } })).statusCode).toBe(400);
    });

    it('sin sesión responde 401', async () => {
      const r = await app.inject({ method: 'PATCH', url: '/api/tareas/1', payload: { lockVersion: 1, cambios: { titulo: 'x' } } });
      expect(r.statusCode).toBe(401);
    });

    it('un token rechazado marca el token vencido', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('no-autorizado', 'x'));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 1, cambios: { titulo: 'x' } });
      expect(r.statusCode).toBe(401);
      expect(r.json().codigo).toBe('token-vencido');
    });

    it('si el token guardado no se puede descifrar (cambió la clave) pide uno nuevo en lugar de dar 500', async () => {
      db.prepare('update usuarios set token_cifrado = ? where id = 9').run(cifrar('token-de-ana', Buffer.alloc(32, 2)));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 1, cambios: { titulo: 'x' } });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'token-vencido' });
      expect(db.prepare('select token_vencido from usuarios where id = 9').pluck().get()).toBe(1);
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    });

    it('usa el cliente del usuario que actúa', async () => {
      await conSesion('PATCH', '/api/tareas/1', { lockVersion: 1, cambios: { titulo: 'x' } });
      expect(crearCliente).toHaveBeenLastCalledWith('token-de-ana');
    });

    it('un error inesperado responde 500 interno', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new TypeError('boom'));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 1, cambios: { titulo: 'x' } });
      expect(r.statusCode).toBe(500);
      expect(r.json().codigo).toBe('interno');
    });
  });

  describe('POST /api/tareas', () => {
    beforeEach(() => {
      cliente.crearTarea.mockImplementation(async () => tareaDe(900, { proyectoId: 1, titulo: 'Nueva' }));
    });

    it('usa el tipo «Task» por defecto', async () => {
      const r = await conSesion('POST', '/api/tareas', { titulo: 'Nueva', proyectoId: 1 });
      expect(r.statusCode).toBe(200);
      expect(cliente.crearTarea).toHaveBeenCalledWith({ titulo: 'Nueva', proyectoId: 1, tipoId: 5 });
      expect(cache().tarea(900)).toMatchObject({ titulo: 'Nueva' });
      expect(r.json().datos).toMatchObject({ id: 900 });
    });

    it('respeta el tipo indicado', async () => {
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1, tipoId: 4, madreId: null, fin: '2026-12-01' });
      expect(cliente.crearTarea).toHaveBeenCalledWith({ titulo: 'N', proyectoId: 1, tipoId: 4, madreId: null, fin: '2026-12-01' });
    });

    it('pasa el inicio y la programación manual (alta desde la línea de tiempo)', async () => {
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1, madreId: 30, inicio: '2026-10-27', fin: '2026-11-02', programacionManual: true });
      expect(cliente.crearTarea).toHaveBeenCalledWith({
        titulo: 'N', proyectoId: 1, tipoId: 5, madreId: 30, inicio: '2026-10-27', fin: '2026-11-02', programacionManual: true,
      });
    });

    it('una hija con fechas trae lo que OpenProject reprogramó (la madre automática se estira)', async () => {
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1, madreId: 30, inicio: '2026-10-27', fin: '2026-11-02' });
      expect(refrescoIncremental).toHaveBeenCalledWith(9);
    });

    it('sin madre o sin fechas no hace falta traer nada', async () => {
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1, inicio: '2026-10-27', fin: '2026-11-02' });
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1, madreId: 30 });
      expect(refrescoIncremental).not.toHaveBeenCalled();
    });

    it('un solo día (inicio igual al fin) vale', async () => {
      const r = await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1, inicio: '2026-10-27', fin: '2026-10-27' });
      expect(r.statusCode).toBe(200);
    });

    it('crear en la columna En curso de un proyecto con versión «En curso» la asigna', async () => {
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1, estadoId: 11 });
      expect(cliente.crearTarea).toHaveBeenCalledWith({ titulo: 'N', proyectoId: 1, tipoId: 5, estadoId: 11, versionId: 7 });
    });

    it('crear en Nuevo no asigna versión', async () => {
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1, estadoId: 10 });
      expect(cliente.crearTarea).toHaveBeenCalledWith({ titulo: 'N', proyectoId: 1, tipoId: 5, estadoId: 10 });
    });

    it('crear en una columna cuya versión no existe en el proyecto no manda versión', async () => {
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 2, estadoId: 11 });
      expect(cliente.crearTarea).toHaveBeenCalledWith({ titulo: 'N', proyectoId: 2, tipoId: 5, estadoId: 11 });
    });

    it('sin «Task» usa el primer tipo que no es hito', async () => {
      cache().guardarCatalogo({ ...CATALOGO, tipos: CATALOGO.tipos.filter((t) => t.nombre !== 'Task') });
      await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1 });
      expect(cliente.crearTarea).toHaveBeenCalledWith({ titulo: 'N', proyectoId: 1, tipoId: 4 });
    });

    it('sin catálogo cargado responde 503', async () => {
      db.prepare('delete from cache_catalogo').run();
      const r = await conSesion('POST', '/api/tareas', { titulo: 'N', proyectoId: 1 });
      expect(r.statusCode).toBe(503);
      expect(r.json().codigo).toBe('sin-conexion');
      expect(cliente.crearTarea).not.toHaveBeenCalled();
    });

    it.each([
      ['sin título', { proyectoId: 1 }],
      ['título vacío', { titulo: '', proyectoId: 1 }],
      ['título largo', { titulo: 'a'.repeat(256), proyectoId: 1 }],
      ['sin proyecto', { titulo: 'x' }],
      ['proyecto inválido', { titulo: 'x', proyectoId: 0 }],
      ['clave desconocida', { titulo: 'x', proyectoId: 1, foo: 1 }],
      ['inicio después del fin', { titulo: 'x', proyectoId: 1, inicio: '2026-11-03', fin: '2026-11-02' }],
      ['inicio que no existe', { titulo: 'x', proyectoId: 1, inicio: '2026-02-30' }],
      ['programación manual que no es sí o no', { titulo: 'x', proyectoId: 1, programacionManual: 'si' }],
    ])('rechaza con 400: %s', async (_n, cuerpo) => {
      expect((await conSesion('POST', '/api/tareas', cuerpo)).statusCode).toBe(400);
      expect(cliente.crearTarea).not.toHaveBeenCalled();
    });

    it('crear tarea: si el POST queda incierto y la tarea aparece creada, responde la tarea sin duplicar', async () => {
      cliente.crearTarea.mockRejectedValueOnce(new ErrorOp('incierto', 'timeout'));
      cliente.tareas.mockResolvedValueOnce({ tareas: [tareaDe(77, { titulo: 'Nueva', proyectoId: 1, autorId: 9, creada: '2026-10-19T11:59:00Z' })], salteadas: [] });
      const r = await conSesion('POST', '/api/tareas', { titulo: 'Nueva', proyectoId: 1 });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, datos: { id: 77 } });
      expect(cliente.crearTarea).toHaveBeenCalledTimes(1);
      expect(cliente.tareas).toHaveBeenCalledWith({ actualizadasDesde: '2026-10-19T11:58:00.000Z' });
      expect(cache().tarea(77)).toMatchObject({ titulo: 'Nueva' });
    });

    it('crear tarea: si queda incierto y no aparece, responde resultado-incierto (503)', async () => {
      cliente.crearTarea.mockRejectedValueOnce(new ErrorOp('incierto', 'timeout'));
      cliente.tareas.mockResolvedValueOnce({ tareas: [], salteadas: [] });
      const r = await conSesion('POST', '/api/tareas', { titulo: 'Nueva', proyectoId: 1 });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ ok: false, codigo: 'resultado-incierto', mensaje: MSG_INCIERTO });
    });

    it('crear tarea: una tarea vieja con el mismo título bajo otra madre no se toma como la recién creada', async () => {
      cliente.crearTarea.mockRejectedValueOnce(new ErrorOp('incierto', 'timeout'));
      cliente.tareas.mockResolvedValueOnce({
        tareas: [tareaDe(77, { titulo: 'Nueva', proyectoId: 1, autorId: 9, madreId: 5, creada: '2026-10-01T10:00:00Z' })], salteadas: [],
      });
      const r = await conSesion('POST', '/api/tareas', { titulo: 'Nueva', proyectoId: 1 });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'resultado-incierto' });
    });

    it('crear tarea: si queda incierto y no se puede buscar, responde resultado-incierto (503)', async () => {
      cliente.crearTarea.mockRejectedValueOnce(new ErrorOp('incierto', 'timeout'));
      cliente.tareas.mockRejectedValueOnce(new ErrorOp('red', 'x'));
      const r = await conSesion('POST', '/api/tareas', { titulo: 'Nueva', proyectoId: 1 });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'resultado-incierto' });
    });

    it('crear sin tipos no-hito responde 422 validacion', async () => {
      cache().guardarCatalogo({ ...CATALOGO, tipos: CATALOGO.tipos.filter((t) => t.esHito) });
      const r = await conSesion('POST', '/api/tareas', { titulo: 'x', proyectoId: 1 });
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ codigo: 'validacion', mensaje: 'OpenProject no tiene un tipo de tarea disponible para crearla.' });
      expect(cliente.crearTarea).not.toHaveBeenCalled();
    });

    it('mapea el rechazo de OpenProject', async () => {
      cliente.crearTarea.mockRejectedValueOnce(new ErrorOp('prohibido', 'x'));
      expect((await conSesion('POST', '/api/tareas', { titulo: 'x', proyectoId: 1 })).statusCode).toBe(403);
    });
  });

  describe('comentarios', () => {
    it('comenta y devuelve las actividades', async () => {
      cliente.comentar.mockResolvedValue(undefined);
      const actividad = { id: 1, creada: '2026-10-19T12:00:00Z', autorId: 9, comentario: 'Hola', detalles: [] };
      cliente.actividades.mockResolvedValue([actividad]);
      const r = await conSesion('POST', '/api/tareas/1/comentarios', { texto: '  Hola  ' });
      expect(r.statusCode).toBe(200);
      expect(cliente.comentar).toHaveBeenCalledWith(1, 'Hola');
      expect(r.json().datos).toEqual({ actividades: [actividad], sinReleer: null });
      expect(cache().tarea(1)?.comentarios).toBe(1);
    });

    it.each([
      ['vacío', { texto: '' }],
      ['solo espacios', { texto: '   \n ' }],
      ['demasiado largo', { texto: 'a'.repeat(10001) }],
      ['sin texto', {}],
      ['clave extra', { texto: 'x', otro: 1 }],
    ])('rechaza un comentario: %s', async (_n, cuerpo) => {
      const r = await conSesion('POST', '/api/tareas/1/comentarios', cuerpo);
      expect(r.statusCode).toBe(400);
      expect(r.json().codigo).toBe('validacion');
      expect(cliente.comentar).not.toHaveBeenCalled();
    });

    it('si falla la red al releer las actividades igual responde éxito desactualizado', async () => {
      cliente.comentar.mockResolvedValue(undefined);
      cliente.actividades.mockRejectedValue(new ErrorOp('red', 'x'));
      const r = await conSesion('POST', '/api/tareas/1/comentarios', { texto: 'Hola' });
      expect(r.json()).toMatchObject({ ok: true, desactualizado: true, datos: { actividades: [], sinReleer: 'sin-conexion' } });
    });

    // El comentario ya quedó guardado: responder error haría que un reintento lo duplique.
    it.each([
      ['403', new ErrorOp('prohibido', 'x', 403), 'sin-acceso'],
      ['404', new ErrorOp('no-encontrado', 'x', 404), 'sin-acceso'],
      ['una respuesta con forma inesperada', new TypeError('forma inesperada'), 'sin-conexion'],
    ])('si releer falla con %s igual responde éxito desactualizado', async (_n, error, motivo) => {
      cliente.comentar.mockResolvedValue(undefined);
      cliente.actividades.mockRejectedValue(error);
      const r = await conSesion('POST', '/api/tareas/1/comentarios', { texto: 'Hola' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ ok: true, desactualizado: true, datos: { actividades: [], sinReleer: motivo } });
      expect(cliente.comentar).toHaveBeenCalledTimes(1);
    });

    it('si releer da 401 responde éxito y marca el token vencido', async () => {
      cliente.comentar.mockResolvedValue(undefined);
      cliente.actividades.mockRejectedValue(new ErrorOp('no-autorizado', 'x', 401));
      const r = await conSesion('POST', '/api/tareas/1/comentarios', { texto: 'Hola' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, desactualizado: true, datos: { actividades: [], sinReleer: 'token-vencido' } });
      expect(db.prepare('select token_vencido from usuarios where id = 9').pluck().get()).toBe(1);
    });
  });

  describe('altas con resultado incierto', () => {
    it('un comentario incierto que ya está en las actividades responde ok', async () => {
      cliente.comentar.mockRejectedValueOnce(new ErrorOp('incierto', 'timeout'));
      const actividad = { id: 1, creada: '2026-10-19T12:00:00Z', autorId: 9, comentario: 'Hola', detalles: [] };
      cliente.actividades.mockResolvedValue([actividad]);
      const r = await conSesion('POST', '/api/tareas/1/comentarios', { texto: 'Hola' });
      expect(r.statusCode).toBe(200);
      expect(r.json().datos).toEqual({ actividades: [actividad], sinReleer: null });
      expect(cliente.comentar).toHaveBeenCalledTimes(1);
    });

    it('un comentario incierto que no aparece responde resultado-incierto (503)', async () => {
      cliente.comentar.mockRejectedValueOnce(new ErrorOp('incierto', 'timeout'));
      cliente.actividades.mockResolvedValue([]);
      const r = await conSesion('POST', '/api/tareas/1/comentarios', { texto: 'Hola' });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'resultado-incierto', mensaje: MSG_INCIERTO });
    });

    it('una dependencia incierta que ya existe responde la dependencia y la guarda en caché', async () => {
      const dep: Dependencia = { id: 31, sucesoraId: 8, predecesoraId: 7, lag: 0 };
      cliente.crearDependencia.mockRejectedValueOnce(new ErrorOp('incierto', 'timeout'));
      cliente.dependencias.mockResolvedValueOnce([dep]);
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 7 });
      expect(r.statusCode).toBe(200);
      expect(r.json().datos).toEqual(dep);
      expect(cache().dependencias()).toEqual([dep]);
      expect(cliente.crearDependencia).toHaveBeenCalledTimes(1);
    });

    it('una dependencia incierta que no existe responde resultado-incierto (503)', async () => {
      cliente.crearDependencia.mockRejectedValueOnce(new ErrorOp('incierto', 'timeout'));
      cliente.dependencias.mockResolvedValueOnce([]);
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 7 });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'resultado-incierto' });
    });
  });

  describe('dependencias', () => {
    it('crear dependencia llama con sucesora y predecesora y la guarda en la caché', async () => {
      const dep: Dependencia = { id: 31, sucesoraId: 8, predecesoraId: 7, lag: 0 };
      cliente.crearDependencia.mockResolvedValue(dep);
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 7 });
      expect(r.statusCode).toBe(200);
      expect(cliente.crearDependencia).toHaveBeenCalledWith(8, 7, undefined);
      expect(r.json().datos).toEqual(dep);
      expect(cache().dependencias()).toEqual([dep]);
    });

    it('crear dependencia relee la sucesora y deja en la caché la versión que dejó OpenProject', async () => {
      // OpenProject pasa la sucesora a automática y la corre al crear la relación: la caché no puede quedar con la versión vieja.
      cache().guardarTareas([tareaDe(8, { lockVersion: 3, proyectoId: 1, programacionManual: true })]);
      cliente.crearDependencia.mockResolvedValue({ id: 31, sucesoraId: 8, predecesoraId: 7, lag: 0 });
      cliente.tarea.mockResolvedValueOnce(tareaDe(8, { lockVersion: 4, proyectoId: 1, programacionManual: false, inicio: '2026-10-26' }));
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 7 });
      expect(r.statusCode).toBe(200);
      expect(cliente.tarea).toHaveBeenCalledWith(8);
      expect(cache().tarea(8)).toMatchObject({ lockVersion: 4, programacionManual: false, inicio: '2026-10-26' });
    });

    it('si releer la sucesora falla, la dependencia igual se responde y queda en la caché', async () => {
      const dep: Dependencia = { id: 31, sucesoraId: 8, predecesoraId: 7, lag: 0 };
      cliente.crearDependencia.mockResolvedValue(dep);
      cliente.tarea.mockRejectedValueOnce(new ErrorOp('red', 'x'));
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 7 });
      expect(r.statusCode).toBe(200);
      expect(r.json().datos).toEqual(dep);
      expect(cache().dependencias()).toEqual([dep]);
    });

    it('crear dependencia pasa el retraso al cliente', async () => {
      cliente.crearDependencia.mockResolvedValue({ id: 32, sucesoraId: 8, predecesoraId: 4, lag: 2 });
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 4, retraso: 2 });
      expect(r.statusCode).toBe(200);
      expect(cliente.crearDependencia).toHaveBeenCalledWith(8, 4, 2);
      expect(r.json().datos.lag).toBe(2);
    });

    it.each([[1.5], [400], [-366]])('un retraso inválido (%s) responde 400', async (retraso) => {
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 4, retraso });
      expect(r.statusCode).toBe(400);
      expect(cliente.crearDependencia).not.toHaveBeenCalled();
    });

    it('PATCH con programacionManual llega a OpenProject', async () => {
      cliente.actualizarTarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 3, proyectoId: 1 }));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { programacionManual: false } });
      expect(r.statusCode).toBe(200);
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(1, 2, { programacionManual: false });
    });

    it('PATCH con duracionDias (entero positivo) llega a OpenProject; uno inválido da 400', async () => {
      cliente.actualizarTarea.mockResolvedValueOnce(tareaDe(1, { lockVersion: 3, proyectoId: 1 }));
      const r = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { programacionManual: false, duracionDias: 3 } });
      expect(r.statusCode).toBe(200);
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(1, 2, { programacionManual: false, duracionDias: 3 });
      const mala = await conSesion('PATCH', '/api/tareas/1', { lockVersion: 2, cambios: { duracionDias: 0 } });
      expect(mala.statusCode).toBe(400);
    });

    it('una tarea no puede esperarse a sí misma', async () => {
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 8 });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ codigo: 'validacion', mensaje: 'Una tarea no puede esperarse a sí misma' });
      expect(cliente.crearDependencia).not.toHaveBeenCalled();
    });

    it('una dependencia circular se explica en castellano', async () => {
      cliente.crearDependencia.mockRejectedValue(new ErrorOp('validacion', 'This relation would create a circular dependency.', 422));
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 7 });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ codigo: 'validacion', mensaje: 'Esa dependencia formaría un círculo entre tareas.' });
    });

    it('otro 422 de la relación conserva el mensaje original', async () => {
      cliente.crearDependencia.mockRejectedValue(new ErrorOp('validacion', 'Algo no cierra', 422));
      const r = await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: 7 });
      expect(r.json()).toMatchObject({ codigo: 'validacion', mensaje: 'OpenProject no permitió esa dependencia: Algo no cierra' });
    });

    it.each([[0], [-1], [1.5], ['7']])('rechaza esperaA %s', async (v) => {
      expect((await conSesion('POST', '/api/tareas/8/dependencias', { esperaA: v })).statusCode).toBe(400);
    });

    it('borrar dependencia llama a OpenProject y la saca de la caché', async () => {
      cache().agregarDependencia({ id: 31, sucesoraId: 8, predecesoraId: 7, lag: 0 });
      cache().agregarDependencia({ id: 32, sucesoraId: 9, predecesoraId: 7, lag: 0 });
      cliente.borrarDependencia.mockResolvedValue(undefined);
      const r = await conSesion('DELETE', '/api/dependencias/31');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, datos: null });
      expect(cliente.borrarDependencia).toHaveBeenCalledWith(31);
      expect(cache().dependencias().map((d) => d.id)).toEqual([32]);
    });

    it('si OpenProject no encuentra la dependencia responde 404 y deja la caché', async () => {
      cache().agregarDependencia({ id: 31, sucesoraId: 8, predecesoraId: 7, lag: 0 });
      cliente.borrarDependencia.mockRejectedValue(new ErrorOp('no-encontrado', 'x'));
      expect((await conSesion('DELETE', '/api/dependencias/31')).statusCode).toBe(404);
      expect(cache().dependencias()).toHaveLength(1);
    });

    it('rechaza un id de dependencia mal formado', async () => {
      expect((await conSesion('DELETE', '/api/dependencias/0')).statusCode).toBe(400);
    });
  });

  describe('borrar una tarea', () => {
    beforeEach(() => {
      cache().guardarTareas([
        // Como en OpenProject: las horas de cada tarea ya suman las de sus descendientes (2 propias + 3 + 1,5).
        // Todas las creó Ana (9), la de la sesión.
        tareaDe(100, { proyectoId: 1, horasReales: 6.5, autorId: 9 }),
        tareaDe(101, { proyectoId: 1, madreId: 100, horasReales: 4.5, autorId: 9 }),
        tareaDe(102, { proyectoId: 1, madreId: 101, horasReales: 1.5, autorId: 9 }),
        tareaDe(103, { proyectoId: 1, horasReales: 9, autorId: 9 }),
        tareaDe(104, { proyectoId: 1, autorId: 9 }),
      ]);
      cache().agregarDependencia({ id: 7, sucesoraId: 104, predecesoraId: 100, lag: 0 });
      cliente.puedeBorrarTarea.mockResolvedValue(true);
      cliente.adjuntos.mockImplementation(async (id: number) => (id === 100 ? [{ id: 1 }, { id: 2 }] : id === 102 ? [{ id: 3 }] : []));
      cliente.borrarTarea.mockResolvedValue(undefined);
    });

    it('el resumen cuenta subtareas, horas y adjuntos de la tarea y sus descendientes', async () => {
      const r = await conSesion('GET', '/api/tareas/100/borrado');
      expect(r.statusCode).toBe(200);
      expect(r.json().datos).toEqual({ puede: true, motivo: null, subtareas: 2, horas: 6.5, adjuntos: 3, trabajando: null, ajenas: 0, sucesoras: ['T104'] });
    });

    it('una tarea que creó otra persona no se puede borrar aunque OpenProject deje: GET puede false y DELETE 403', async () => {
      cache().guardarTareas([tareaDe(103, { proyectoId: 1, autorId: 5 })]);
      const r = await conSesion('GET', '/api/tareas/103/borrado');
      expect(r.json().datos).toMatchObject({ puede: false, motivo: MSG_SOLO_QUIEN_LA_CREO });
      expect(cliente.puedeBorrarTarea).not.toHaveBeenCalled();
      const borrado = await conSesion('DELETE', '/api/tareas/103');
      expect(borrado.statusCode).toBe(403);
      expect(borrado.json()).toMatchObject({ codigo: 'prohibido', mensaje: MSG_SOLO_QUIEN_LA_CREO });
      expect(cliente.borrarTarea).not.toHaveBeenCalled();
      expect(cache().tarea(103)).not.toBeNull();
    });

    it('el motivo nombra a quien creó la tarea si está en el catálogo', async () => {
      cache().guardarCatalogo({ ...CATALOGO, personas: [{ id: 5, nombre: 'Daniel Sosa', login: 'dsosa', email: null, avatarUrl: null }] });
      cache().guardarTareas([tareaDe(103, { proyectoId: 1, autorId: 5 })]);
      const r = await conSesion('GET', '/api/tareas/103/borrado');
      expect(r.json().datos.motivo).toBe('Solo quien creó la tarea la puede borrar, y esta la creó Daniel Sosa.');
    });

    it('sin autor conocido tampoco es propia', async () => {
      cache().guardarTareas([tareaDe(103, { proyectoId: 1, autorId: null })]);
      expect((await conSesion('DELETE', '/api/tareas/103')).statusCode).toBe(403);
    });

    it('con una subtarea que creó otra persona: el resumen la cuenta y DELETE da 409 sin borrar', async () => {
      cache().guardarTareas([tareaDe(102, { proyectoId: 1, madreId: 101, autorId: 5 })]);
      const r = await conSesion('GET', '/api/tareas/100/borrado');
      expect(r.json().datos).toMatchObject({ puede: true, ajenas: 1 });
      const borrado = await conSesion('DELETE', '/api/tareas/100');
      expect(borrado.statusCode).toBe(409);
      expect(borrado.json()).toMatchObject({ codigo: 'conflicto', mensaje: MSG_SUBTAREAS_AJENAS });
      expect(cliente.borrarTarea).not.toHaveBeenCalled();
      expect(cache().tarea(100)).not.toBeNull();
    });

    it('Member no tiene «Borrar tarea» (puede false) y el motivo dice que es por OpenProject', async () => {
      cliente.puedeBorrarTarea.mockResolvedValue(false);
      const r = await conSesion('GET', '/api/tareas/100/borrado');
      expect(r.json().datos).toMatchObject({ puede: false, motivo: MSG_OP_NO_DEJA_BORRAR });
    });

    it('el resumen dice quién trabaja en una subtarea', async () => {
      crearTramo(db, 9, 102, '2026-10-19', ahora);
      const r = await conSesion('GET', '/api/tareas/100/borrado');
      expect(r.json().datos.trabajando).toBe('Ana');
    });

    it('borra en cascada en la caché y rechaza los tramos con el motivo', async () => {
      const t = crearTramo(db, 9, 101, '2026-10-19', ahora);
      cerrarTramoEn(db, t.id, new Date(ahora.getTime() + 3600_000), 3600, null);
      db.prepare("update tramos_trabajo set estado = 'cargado', entrada_op_id = 55 where id = ?").run(t.id);
      const r = await conSesion('DELETE', '/api/tareas/100');
      expect(r.statusCode).toBe(204);
      expect(cliente.borrarTarea).toHaveBeenCalledWith(100);
      expect([100, 101, 102].map((id) => cache().tarea(id))).toEqual([null, null, null]);
      expect(cache().tarea(103)).not.toBeNull();
      expect(cache().dependencias()).toEqual([]);
      expect(tramo(db, t.id)).toMatchObject({ estado: 'rechazado', entradaOpId: null, motivo: 'La tarea ya no existe en OpenProject' });
    });

    it('con un tramo abierto en una subtarea da 409 con el nombre y no borra', async () => {
      crearTramo(db, 9, 102, '2026-10-19', ahora);
      const r = await conSesion('DELETE', '/api/tareas/100');
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ codigo: 'conflicto', mensaje: 'Ana está trabajando en esta tarea ahora' });
      expect(cliente.borrarTarea).not.toHaveBeenCalled();
      expect(cache().tarea(100)).not.toBeNull();
    });

    it('la sucesora se relee y queda con el lockVersion nuevo', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(104, { proyectoId: 1, lockVersion: 8, programacionManual: true }));
      await conSesion('DELETE', '/api/tareas/100');
      expect(cliente.tarea).toHaveBeenCalledWith(104);
      expect(cache().tarea(104)).toMatchObject({ lockVersion: 8, programacionManual: true });
    });

    it('el resumen cuenta también una subtarea que está en otro proyecto', async () => {
      cache().guardarTareas([tareaDe(105, { proyectoId: 2, madreId: 100 })]);
      const r = await conSesion('GET', '/api/tareas/100/borrado');
      expect(r.json().datos.subtareas).toBe(3);
    });

    it('con ?sinAdjuntos=1 no cuenta adjuntos', async () => {
      const r = await conSesion('GET', '/api/tareas/100/borrado?sinAdjuntos=1');
      expect(r.json().datos).toMatchObject({ puede: true, subtareas: 2, adjuntos: 0 });
      expect(cliente.adjuntos).not.toHaveBeenCalled();
    });

    it('una tarea de un proyecto que no ve: GET y DELETE dan 404 sin llamar a OpenProject ni tocar nada', async () => {
      cliente.borrarTarea.mockRejectedValue(new ErrorOp('no-encontrado', 'x', 404));
      const t = crearTramo(db, 9, 50, '2026-10-19', ahora);
      cerrarTramoEn(db, t.id, new Date(ahora.getTime() + 3600_000), 3600, null);
      db.prepare("update tramos_trabajo set estado = 'cargado', entrada_op_id = 1234 where id = ?").run(t.id);
      expect((await conSesion('DELETE', '/api/tareas/50')).statusCode).toBe(404);
      expect((await conSesion('GET', '/api/tareas/50/borrado')).statusCode).toBe(404);
      expect(cliente.borrarTarea).not.toHaveBeenCalled();
      expect(cliente.puedeBorrarTarea).not.toHaveBeenCalled();
      expect(cache().tarea(50)).not.toBeNull();
      expect(tramo(db, t.id)).toMatchObject({ estado: 'cargado', entradaOpId: 1234 });
    });

    it('PATCH con 404 a una tarea de un proyecto que no ve no la saca de la caché', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('no-encontrado', 'x', 404));
      const r = await conSesion('PATCH', '/api/tareas/50', { lockVersion: 1, cambios: { titulo: 'x' } });
      expect(r.statusCode).toBe(404);
      expect(cache().tarea(50)).not.toBeNull();
    });

    it('mover con 404 una tarea de un proyecto que no ve da 404, no la saca de la caché y deja el tramo ajeno cargado', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('no-encontrado', 'x', 404));
      const t = crearTramo(db, 9, 50, '2026-10-19', ahora);
      cerrarTramoEn(db, t.id, new Date(ahora.getTime() + 3600_000), 3600, null);
      db.prepare("update tramos_trabajo set estado = 'cargado', entrada_op_id = 777 where id = ?").run(t.id);
      const r = await conSesion('POST', '/api/tareas/50/mover', { lockVersion: 1, columna: 'cerrado' });
      expect(r.statusCode).toBe(404);
      expect(cache().tarea(50)).not.toBeNull();
      expect(tramo(db, t.id)).toMatchObject({ estado: 'cargado', entradaOpId: 777 });
    });

    it('si OpenProject ya no tiene la tarea, la saca de la caché sin tocar los tramos', async () => {
      cliente.borrarTarea.mockRejectedValue(new ErrorOp('no-encontrado', 'x', 404));
      const t = crearTramo(db, 9, 101, '2026-10-19', ahora);
      cerrarTramoEn(db, t.id, new Date(ahora.getTime() + 3600_000), 3600, null);
      db.prepare("update tramos_trabajo set estado = 'cargado', entrada_op_id = 55 where id = ?").run(t.id);
      expect((await conSesion('DELETE', '/api/tareas/100')).statusCode).toBe(204);
      expect(tramo(db, t.id)).toMatchObject({ estado: 'cargado', entradaOpId: 55 });
    });

    it('PATCH a una tarea borrada saca también sus subtareas y rechaza sus tramos', async () => {
      const t = crearTramo(db, 9, 101, '2026-10-19', ahora);
      cerrarTramoEn(db, t.id, new Date(ahora.getTime() + 3600_000), 3600, null);
      db.prepare("update tramos_trabajo set estado = 'cargado', entrada_op_id = 55 where id = ?").run(t.id);
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('no-encontrado', 'x', 404));
      await conSesion('PATCH', '/api/tareas/100', { lockVersion: 1, cambios: { titulo: 'x' } });
      expect([100, 101, 102].map((id) => cache().tarea(id))).toEqual([null, null, null]);
      expect(tramo(db, t.id)).toMatchObject({ estado: 'rechazado', entradaOpId: null });
    });

    it('si OpenProject ya no tiene la tarea, igual la saca de la caché', async () => {
      cliente.borrarTarea.mockRejectedValue(new ErrorOp('no-encontrado', 'x', 404));
      const r = await conSesion('DELETE', '/api/tareas/100');
      expect(r.statusCode).toBe(204);
      expect(cache().tarea(100)).toBeNull();
    });

    it('PATCH a una tarea borrada da 404 con el texto fijo y la saca de la caché', async () => {
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('no-encontrado', 'x', 404));
      const r = await conSesion('PATCH', '/api/tareas/103', { lockVersion: 1, cambios: { titulo: 'x' } });
      expect(r.statusCode).toBe(404);
      expect(r.json()).toMatchObject({ codigo: 'no-encontrado', mensaje: 'Esa tarea ya no existe en OpenProject' });
      expect(cache().tarea(103)).toBeNull();
    });
  });
});
