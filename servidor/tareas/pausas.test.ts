import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogoOp, Tarea } from '../../compartido/tipos.js';
import { syncFalso, tareaDe } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { cifrar } from '../seguridad/cifrado.js';
import { crearCache } from '../sync/cache.js';
import { pausasDe } from './pausas-repositorio.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const proyecto = (id: number) => ({ id, nombre: `Proy ${id}`, identificador: `p${id}`, activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' });
const CATALOGO: CatalogoOp = {
  estados: [{ id: 10, nombre: 'New', cerrado: false, color: '#fff' }],
  tipos: [{ id: 3, nombre: 'Milestone', esHito: true, color: '#000' }, { id: 5, nombre: 'Task', esHito: false, color: '#000' }],
  prioridades: [{ id: 8, nombre: 'Normal', alta: false, nivel: 'normal' }],
  proyectos: [proyecto(1), proyecto(2)],
  versiones: [],
  personas: [],
  asignables: {},
  semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [],
};

// Lunes 2 a viernes 13 de noviembre: diez días hábiles. Pausar 2 días después de 3 corre el fin al martes 17.
const TAREA = tareaDe(339, { proyectoId: 1, tipoId: 5, inicio: '2026-11-02', fin: '2026-11-13', lockVersion: 4, programacionManual: true });

describe('API de pausas de tareas', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;
  const ahora = new Date('2026-10-27T12:00:00.000Z');
  const refrescoIncremental = vi.fn(async (_usuarioId: number): Promise<void> => {});
  const cliente = { tarea: vi.fn(), actualizarTarea: vi.fn(), borrarTarea: vi.fn() };
  const crearCliente = vi.fn((_token: string) => cliente as unknown as ClienteOp);
  const cache = () => crearCache(db);
  const conSesion = (metodo: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, cookies: { od_sesion: sesion }, ...(payload === undefined ? {} : { payload: payload as object }) });
  /** OpenProject con esa tarea: lo que se escribe es lo que se vuelve a leer. */
  const enOp = (tarea: Tarea) => {
    let actual = tarea;
    cliente.tarea.mockImplementation(async () => actual);
    cliente.actualizarTarea.mockImplementation(async (_id: number, lock: number, cambios: Record<string, unknown>) => {
      if (lock !== actual.lockVersion) throw new ErrorOp('conflicto', 'cambió', 409);
      actual = { ...actual, ...('fin' in cambios && { fin: cambios.fin as string }), lockVersion: lock + 1 };
      return actual;
    });
  };
  const pausar = (cuerpo: object, id = 339) => conSesion('POST', `/api/tareas/${id}/pausas`, cuerpo);

  beforeEach(async () => {
    db = abrirDb(':memory:');
    Object.values(cliente).forEach((f) => f.mockReset());
    refrescoIncremental.mockReset();
    app = await crearApp({ config, db, crearCliente, ahora: () => ahora, sync: { ...syncFalso(), refrescoIncremental } });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (9, 'ana', 'Ana', 'h', ?, 0, ?)")
      .run(cifrar('token-de-ana', config.claveCifrado), ahora.toISOString());
    db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (9, 1)').run();
    sesion = crearSesion(db, 9, ahora);
    cache().guardarCatalogo(CATALOGO);
    cache().guardarTareas([TAREA, tareaDe(50, { proyectoId: 2, inicio: '2026-11-02', fin: '2026-11-13' })]);
    enOp(TAREA);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe('pausar', () => {
    it('en una manual corre el fin los días hábiles de la pausa, la guarda y trae lo reprogramado', async () => {
      const r = await pausar({ lockVersion: 4, despues: 3, dias: 2 });
      expect(r.statusCode).toBe(200);
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(339, 4, { fin: '2026-11-17' });
      expect(r.json().datos).toMatchObject({ tarea: { id: 339, fin: '2026-11-17', lockVersion: 5 }, pausa: { tareaId: 339, despues: 3, dias: 2 } });
      expect(pausasDe(db, 339)).toMatchObject([{ despues: 3, dias: 2 }]);
      expect(cache().tarea(339)).toMatchObject({ fin: '2026-11-17' });
      expect(refrescoIncremental).toHaveBeenCalledWith(9);
    });

    it('en una automática escribe la duración hábil, que OpenProject usa para correr el fin', async () => {
      enOp({ ...TAREA, programacionManual: false });
      await pausar({ lockVersion: 4, despues: 3, dias: 2 });
      expect(cliente.actualizarTarea).toHaveBeenCalledWith(339, 4, { duracionDias: 12 });
    });

    it('si alguien la cambió en OpenProject responde 409 sin escribir nada', async () => {
      const r = await pausar({ lockVersion: 3, despues: 3, dias: 2 });
      expect(r.statusCode).toBe(409);
      expect(r.json().codigo).toBe('conflicto');
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
      expect(pausasDe(db, 339)).toEqual([]);
    });

    it.each([
      ['un hito', { ...TAREA, tipoId: 3 }, 'Un hito no se puede pausar.'],
      ['una tarea sin fin', { ...TAREA, fin: null }, 'Para pausarla, la tarea tiene que tener inicio y fin.'],
    ])('no deja pausar %s', async (_n, tarea, mensaje) => {
      enOp(tarea);
      const r = await pausar({ lockVersion: 4, despues: 3, dias: 2 });
      expect(r.statusCode).toBe(422);
      expect(r.json().mensaje).toBe(mensaje);
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    });

    it('no deja pausar una madre automática (sus fechas salen de las hijas)', async () => {
      enOp({ ...TAREA, programacionManual: false });
      cache().guardarTareas([tareaDe(340, { proyectoId: 1, madreId: 339 })]);
      const r = await pausar({ lockVersion: 4, despues: 3, dias: 2 });
      expect(r.statusCode).toBe(422);
      expect(r.json().mensaje).toBe('Sus fechas salen de sus subtareas: pausá las subtareas.');
    });

    it('no deja una pausa sin trabajo después ni dos en el mismo lugar', async () => {
      expect((await pausar({ lockVersion: 4, despues: 10, dias: 2 })).json().mensaje).toBe('Desde ahí ya no queda trabajo en la tarea.');
      await pausar({ lockVersion: 4, despues: 3, dias: 2 });
      const r = await pausar({ lockVersion: 5, despues: 3, dias: 1 });
      expect(r.statusCode).toBe(422);
      expect(r.json().mensaje).toBe('Ya hay una pausa en ese lugar de la tarea.');
    });

    it('una tarea de un proyecto que no ve responde 404', async () => {
      expect((await pausar({ lockVersion: 1, despues: 3, dias: 2 }, 50)).statusCode).toBe(404);
      expect(cliente.tarea).not.toHaveBeenCalled();
    });

    it.each([
      ['sin lockVersion', { despues: 3, dias: 2 }],
      ['cero días de trabajo antes', { lockVersion: 4, despues: 0, dias: 2 }],
      ['una pausa de más de 366 días', { lockVersion: 4, despues: 3, dias: 367 }],
      ['una clave de más', { lockVersion: 4, despues: 3, dias: 2, desde: '2026-11-05' }],
    ])('rechaza con 400: %s', async (_n, cuerpo) => {
      expect((await pausar(cuerpo)).statusCode).toBe(400);
    });
  });

  describe('listar y quitar', () => {
    it('lista las pausas de las tareas que se ven', async () => {
      await pausar({ lockVersion: 4, despues: 3, dias: 2 });
      db.prepare("insert into pausas_tarea (tarea_id, despues, dias, creada) values (50, 2, 1, '2026-10-27')").run();
      const r = await conSesion('GET', '/api/pausas');
      expect(r.json().datos).toEqual({ 339: [{ id: 1, tareaId: 339, despues: 3, dias: 2 }] });
    });

    it('quitar una pausa devuelve el fin y la borra', async () => {
      const { pausa } = (await pausar({ lockVersion: 4, despues: 3, dias: 2 })).json().datos;
      const r = await conSesion('DELETE', `/api/pausas/${pausa.id}`);
      expect(r.statusCode).toBe(200);
      expect(cliente.actualizarTarea).toHaveBeenLastCalledWith(339, 5, { fin: '2026-11-13' });
      expect(r.json().datos.tarea).toMatchObject({ fin: '2026-11-13' });
      expect(pausasDe(db, 339)).toEqual([]);
    });

    it('una pausa que ya no cae dentro de la tarea se borra sin tocar las fechas', async () => {
      db.prepare("insert into pausas_tarea (tarea_id, despues, dias, creada) values (339, 20, 2, '2026-10-27')").run();
      const r = await conSesion('DELETE', '/api/pausas/1');
      expect(r.json().datos).toEqual({ tarea: null });
      expect(cliente.actualizarTarea).not.toHaveBeenCalled();
      expect(pausasDe(db, 339)).toEqual([]);
    });

    it('si OpenProject no deja devolver el fin, la pausa queda', async () => {
      await pausar({ lockVersion: 4, despues: 3, dias: 2 });
      cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('prohibido', 'no', 403));
      expect((await conSesion('DELETE', '/api/pausas/1')).statusCode).toBe(403);
      expect(pausasDe(db, 339)).toHaveLength(1);
    });

    it('una pausa que no existe o de una tarea que no ve responde 404', async () => {
      expect((await conSesion('DELETE', '/api/pausas/99')).statusCode).toBe(404);
      db.prepare("insert into pausas_tarea (tarea_id, despues, dias, creada) values (50, 2, 1, '2026-10-27')").run();
      expect((await conSesion('DELETE', '/api/pausas/1')).statusCode).toBe(404);
    });

    it('borrar la tarea borra sus pausas', async () => {
      await pausar({ lockVersion: 4, despues: 3, dias: 2 });
      // Solo se borra una tarea propia: la creó Ana (9), la de la sesión.
      cache().guardarTareas([{ ...cache().tarea(339)!, autorId: 9 }]);
      cliente.borrarTarea.mockResolvedValue(undefined);
      expect((await conSesion('DELETE', '/api/tareas/339')).statusCode).toBe(204);
      expect(pausasDe(db, 339)).toEqual([]);
    });
  });
});
