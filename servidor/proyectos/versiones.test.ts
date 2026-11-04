import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogoOp, Version } from '../../compartido/tipos.js';
import { syncFalso, tareaDe } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { cifrar } from '../seguridad/cifrado.js';
import { crearCache, type CacheOp } from '../sync/cache.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const ahora = new Date('2026-10-25T12:00:00.000Z');

const version = (id: number, nombre: string, extra: Partial<Version> = {}): Version =>
  ({ id, nombre, proyectoId: 11, estado: 'abierta', inicio: null, fin: null, ...extra });
const conPermisos = (v: Version, puedeCambiar = true, puedeBorrar = true) => ({ ...v, puedeCambiar, puedeBorrar });

const CATALOGO: CatalogoOp = {
  estados: [], tipos: [], prioridades: [], proyectos: [], personas: [], asignables: {},
  versiones: [version(1, 'Sprint 1'), version(2, 'Finalizado', { proyectoId: 12 })],
  semanaNoLaborable: [], diasNoLaborables: [], plantillasOp: [],
};

describe('API de versiones', () => {
  let db: Database;
  let app: FastifyInstance;
  let cache: CacheOp;
  let sesion: string;
  const cliente = {
    versiones: vi.fn(), puedeCrearVersion: vi.fn(), crearVersion: vi.fn(), cambiarVersion: vi.fn(), borrarVersion: vi.fn(),
  };
  const crearCliente = vi.fn((_t: string) => cliente as unknown as ClienteOp);
  const pedir = (metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, cookies: { od_sesion: sesion }, ...(payload === undefined ? {} : { payload: payload as object }) });

  beforeEach(async () => {
    db = abrirDb(':memory:');
    Object.values(cliente).forEach((f) => f.mockReset());
    app = await crearApp({ config, db, crearCliente, ahora: () => ahora, sync: syncFalso() });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (9, 'ana', 'Ana', 'h', ?, 0, ?)")
      .run(cifrar('token', config.claveCifrado), ahora.toISOString());
    db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (9, 11)').run();
    sesion = crearSesion(db, 9, ahora);
    cache = crearCache(db, () => ahora);
    cache.guardarCatalogo(CATALOGO);
    cache.guardarTareas([tareaDe(1, { versionId: 1 }), tareaDe(2, { versionId: 1 }), tareaDe(3, { versionId: null })]);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('listar con cantidad de tareas', async () => {
    cliente.versiones.mockResolvedValue([conPermisos(version(1, 'Sprint 1')), conPermisos(version(5, 'Sprint 2'), true, false)]);
    cliente.puedeCrearVersion.mockResolvedValue(true);
    const res = await pedir('GET', '/api/proyectos/11/versiones');
    expect(res.statusCode).toBe(200);
    expect(res.json().datos).toEqual({
      versiones: [{ ...conPermisos(version(1, 'Sprint 1')), tareas: 2 }, { ...conPermisos(version(5, 'Sprint 2'), true, false), tareas: 0 }],
      puedeCrear: true,
    });
    // La lista leída pone al día el catálogo.
    expect(cache.catalogo()!.versiones.map((v) => v.id).sort()).toEqual([1, 2, 5]);
  });

  it('listar saca del catálogo las versiones del proyecto que ya no están', async () => {
    cliente.versiones.mockResolvedValue([conPermisos(version(5, 'Sprint 2'))]);
    cliente.puedeCrearVersion.mockResolvedValue(false);
    await pedir('GET', '/api/proyectos/11/versiones');
    expect(cache.catalogo()!.versiones.map((v) => v.id).sort()).toEqual([2, 5]);
  });

  it('Reader: puedeCrear false y sin permisos por versión', async () => {
    cliente.versiones.mockResolvedValue([conPermisos(version(1, 'Sprint 1'), false, false)]);
    cliente.puedeCrearVersion.mockResolvedValue(false);
    const res = await pedir('GET', '/api/proyectos/11/versiones');
    expect(res.json().datos.puedeCrear).toBe(false);
    expect(res.json().datos.versiones[0]).toMatchObject({ puedeCambiar: false, puedeBorrar: false });
  });

  it('un proyecto que la persona no ve da 404 sin pedirle nada a OpenProject', async () => {
    const res = await pedir('GET', '/api/proyectos/12/versiones');
    expect(res.statusCode).toBe(404);
    expect(cliente.versiones).not.toHaveBeenCalled();
  });

  it('crear, renombrar, cerrar', async () => {
    cliente.crearVersion.mockResolvedValue(version(7, 'Sprint 3', { fin: '2026-11-30' }));
    const creada = await pedir('POST', '/api/proyectos/11/versiones', { nombre: '  Sprint 3 ', inicio: null, fin: '2026-11-30' });
    expect(creada.statusCode).toBe(200);
    expect(cliente.crearVersion).toHaveBeenCalledWith(11, { nombre: 'Sprint 3', inicio: null, fin: '2026-11-30' });
    expect(cache.catalogo()!.versiones.some((v) => v.id === 7)).toBe(true);

    cliente.cambiarVersion.mockResolvedValue(version(1, 'Sprint uno'));
    const renombrada = await pedir('PATCH', '/api/versiones/1', { nombre: 'Sprint uno' });
    expect(renombrada.statusCode).toBe(200);
    expect(cliente.cambiarVersion).toHaveBeenCalledWith(1, { nombre: 'Sprint uno' }, 11);
    expect(cache.catalogo()!.versiones.find((v) => v.id === 1)!.nombre).toBe('Sprint uno');

    cliente.cambiarVersion.mockResolvedValue(version(1, 'Sprint uno', { estado: 'cerrada' }));
    await pedir('PATCH', '/api/versiones/1', { estado: 'cerrada' });
    expect(cliente.cambiarVersion).toHaveBeenLastCalledWith(1, { estado: 'cerrada' }, 11);
    expect(cache.catalogo()!.versiones.find((v) => v.id === 1)!.estado).toBe('cerrada');
  });

  it('rechaza nombres vacíos, fechas al revés y estados inventados', async () => {
    expect((await pedir('POST', '/api/proyectos/11/versiones', { nombre: '  ', inicio: null, fin: null })).statusCode).toBe(400);
    const alReves = await pedir('POST', '/api/proyectos/11/versiones', { nombre: 'X', inicio: '2026-12-01', fin: '2026-11-01' });
    expect(alReves.statusCode).toBe(400);
    expect(alReves.json().mensaje).toBe('La fecha de fin no puede ser anterior a la de inicio');
    expect((await pedir('PATCH', '/api/versiones/1', { estado: 'rota' })).statusCode).toBe(400);
    expect((await pedir('PATCH', '/api/versiones/1', {})).statusCode).toBe(400);
    expect(cliente.crearVersion).not.toHaveBeenCalled();
    expect(cliente.cambiarVersion).not.toHaveBeenCalled();
  });

  it('crear sin permiso: el 403 de OpenProject es «no tenés permiso»', async () => {
    cliente.crearVersion.mockRejectedValue(new ErrorOp('prohibido', 'no', 403));
    const res = await pedir('POST', '/api/proyectos/11/versiones', { nombre: 'X', inicio: null, fin: null });
    expect(res.statusCode).toBe(403);
    expect(res.json().mensaje).toBe('No tenés permiso para hacer eso en OpenProject');
  });

  it('cambiar una versión de un proyecto que no ve da 404', async () => {
    const res = await pedir('PATCH', '/api/versiones/2', { nombre: 'Otra' });
    expect(res.statusCode).toBe(404);
    expect(cliente.cambiarVersion).not.toHaveBeenCalled();
  });

  it('borrar con tareas: el botón explica por qué (409 con la cantidad) y no toca OpenProject', async () => {
    const res = await pedir('DELETE', '/api/versiones/1');
    expect(res.statusCode).toBe(422);
    expect(res.json().mensaje).toBe('«Sprint 1» tiene 2 tareas: pasalas a otra versión antes de borrarla');
    expect(cliente.borrarVersion).not.toHaveBeenCalled();
  });

  it('borrar una versión vacía la saca de OpenProject y del catálogo', async () => {
    cache.guardarVersion(version(8, 'Vacía'));
    cliente.borrarVersion.mockResolvedValue(undefined);
    const res = await pedir('DELETE', '/api/versiones/8');
    expect(res.statusCode).toBe(200);
    expect(cliente.borrarVersion).toHaveBeenCalledWith(8);
    expect(cache.catalogo()!.versiones.some((v) => v.id === 8)).toBe(false);
  });

  it('borrar una que OpenProject ya no tiene la saca del catálogo igual', async () => {
    cache.guardarVersion(version(8, 'Vacía'));
    cliente.borrarVersion.mockRejectedValue(new ErrorOp('no-encontrado', 'no', 404));
    const res = await pedir('DELETE', '/api/versiones/8');
    expect(res.statusCode).toBe(404);
    expect(cache.catalogo()!.versiones.some((v) => v.id === 8)).toBe(false);
  });
});
