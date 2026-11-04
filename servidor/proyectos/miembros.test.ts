import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogoOp, Persona } from '../../compartido/tipos.js';
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
const persona = (id: number, nombre: string): Persona => ({ id, nombre, login: null, email: null, avatarUrl: null });

const CATALOGO: CatalogoOp = {
  estados: [{ id: 1, nombre: 'New', cerrado: false, color: '#000' }, { id: 12, nombre: 'Closed', cerrado: true, color: '#000' }],
  tipos: [], prioridades: [], proyectos: [], versiones: [],
  personas: [persona(4, 'Ana'), persona(5, 'Beto'), persona(6, 'Cora')],
  asignables: { 11: [4, 5, 6] }, semanaNoLaborable: [], diasNoLaborables: [], plantillasOp: [],
};
const CAPS = { crearMiembro: true, cambiarMiembro: true, quitarMiembro: true, copiarProyecto: false };

describe('API de miembros', () => {
  let db: Database;
  let app: FastifyInstance;
  let cache: CacheOp;
  let sesion: string;
  const cliente = {
    miembros: vi.fn(), capacidades: vi.fn(), rolesDeProyecto: vi.fn(), candidatos: vi.fn(), agregarMiembro: vi.fn(),
    cambiarRol: vi.fn(), quitarMiembro: vi.fn(), membresia: vi.fn(), tareasAbiertasDe: vi.fn(), actualizarTarea: vi.fn(),
  };
  const releer = vi.fn(async (_u: number, _p: number) => {});
  const cargar = vi.fn(async (_u: number) => {});
  const pedir = (metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, cookies: { od_sesion: sesion }, ...(payload === undefined ? {} : { payload: payload as object }) });

  beforeEach(async () => {
    db = abrirDb(':memory:');
    Object.values(cliente).forEach((f) => f.mockReset());
    releer.mockClear();
    cargar.mockReset();
    cargar.mockResolvedValue(undefined);
    app = await crearApp({
      config, db, crearCliente: () => cliente as unknown as ClienteOp, ahora: () => ahora,
      sync: { ...syncFalso(), releerAsignables: releer, cargaCompleta: cargar },
    });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (9, 'ana', 'Ana', 'h', ?, 0, ?)")
      .run(cifrar('token', config.claveCifrado), ahora.toISOString());
    db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (9, 11)').run();
    sesion = crearSesion(db, 9, ahora);
    cache = crearCache(db, () => ahora);
    cache.guardarCatalogo(CATALOGO);
    cache.guardarTareas([
      tareaDe(1, { responsableId: 5, titulo: 'Uno' }), tareaDe(2, { responsableId: 5, titulo: 'Dos' }),
      tareaDe(3, { responsableId: 5, estadoId: 12 }), tareaDe(4, { responsableId: 4 }),
    ]);
    cliente.membresia.mockResolvedValue({ id: 20, personaId: 5, roles: [], proyectoId: 11 });
    cliente.capacidades.mockResolvedValue(CAPS);
    // Lo que OpenProject dice que tiene Beto abierto (puede no coincidir con la caché).
    cliente.tareasAbiertasDe.mockResolvedValue([
      tareaDe(1, { responsableId: 5, titulo: 'Uno', lockVersion: 7 }), tareaDe(2, { responsableId: 5, titulo: 'Dos', lockVersion: 7 }),
    ]);
    cliente.actualizarTarea.mockImplementation(async (id: number, _l: number, c: { responsableId: number | null }) =>
      tareaDe(id, { responsableId: c.responsableId, lockVersion: 8 }));
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('listar con roles, candidatos y tareas abiertas', async () => {
    cliente.miembros.mockResolvedValue([{ id: 20, personaId: 5, roles: [{ id: 3, nombre: 'Member' }] }]);
    cliente.capacidades.mockResolvedValue(CAPS);
    cliente.rolesDeProyecto.mockResolvedValue([{ id: 3, nombre: 'Member' }]);
    cliente.candidatos.mockResolvedValue([persona(7, 'Dani')]);
    const res = await pedir('GET', '/api/proyectos/11/miembros');
    expect(res.statusCode).toBe(200);
    const d = res.json().datos;
    expect(d.puede).toEqual({ agregar: true, cambiar: true, quitar: true });
    expect(d.miembros).toEqual([{ id: 20, personaId: 5, roles: [{ id: 3, nombre: 'Member' }], nombre: 'Beto', avatarUrl: null, tareasAbiertas: 2 }]);
    expect(d.candidatos).toEqual([persona(7, 'Dani')]);
  });

  it('Member: sin botones y sin pedir candidatos', async () => {
    cliente.miembros.mockResolvedValue([]);
    cliente.capacidades.mockResolvedValue({ ...CAPS, crearMiembro: false, cambiarMiembro: false, quitarMiembro: false });
    const res = await pedir('GET', '/api/proyectos/11/miembros');
    expect(res.json().datos.puede).toEqual({ agregar: false, cambiar: false, quitar: false });
    expect(cliente.candidatos).not.toHaveBeenCalled();
    expect(cliente.rolesDeProyecto).not.toHaveBeenCalled();
  });

  it('Reader: 403 y la web oculta la sección', async () => {
    cliente.miembros.mockRejectedValue(new ErrorOp('prohibido', 'no', 403));
    cliente.capacidades.mockResolvedValue(CAPS);
    expect((await pedir('GET', '/api/proyectos/11/miembros')).statusCode).toBe(403);
  });

  it('al agregar a alguien que usa OpenDash se encola su carga completa; si no lo usa o su token venció, no', async () => {
    const usuario = (id: number, vencido: number) => db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (?, ?, ?, 'h', ?, ?, ?)")
      .run(id, `u${id}`, `U${id}`, cifrar('token', config.claveCifrado, `usuario:${id}`), vencido, ahora.toISOString());
    usuario(7, 0);
    usuario(8, 1);
    cliente.agregarMiembro.mockResolvedValue({ id: 21, personaId: 7, roles: [] });
    expect((await pedir('POST', '/api/proyectos/11/miembros', { personaId: 7, rolId: 3 })).statusCode).toBe(200);
    expect(cargar).toHaveBeenCalledExactlyOnceWith(7);
    cargar.mockClear();
    expect((await pedir('POST', '/api/proyectos/11/miembros', { personaId: 8, rolId: 3 })).statusCode).toBe(200);
    expect((await pedir('POST', '/api/proyectos/11/miembros', { personaId: 6, rolId: 3 })).statusCode).toBe(200);
    expect(cargar).not.toHaveBeenCalled();
  });

  it('una carga que falla no rompe el alta del miembro', async () => {
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (7, 'u7', 'U7', 'h', ?, 0, ?)")
      .run(cifrar('token', config.claveCifrado, 'usuario:7'), ahora.toISOString());
    cargar.mockRejectedValue(new Error('se cayó'));
    cliente.agregarMiembro.mockResolvedValue({ id: 21, personaId: 7, roles: [] });
    expect((await pedir('POST', '/api/proyectos/11/miembros', { personaId: 7, rolId: 3 })).statusCode).toBe(200);
  });

  it('agregar con rol, cambiar rol, sacar sin tareas', async () => {
    cliente.agregarMiembro.mockResolvedValue({ id: 21, personaId: 7, roles: [] });
    expect((await pedir('POST', '/api/proyectos/11/miembros', { personaId: 7, rolId: 3 })).statusCode).toBe(200);
    expect(cliente.agregarMiembro).toHaveBeenCalledWith(11, 7, 3);
    expect(releer).toHaveBeenCalledWith(9, 11);

    cliente.cambiarRol.mockResolvedValue({ id: 20, personaId: 5, roles: [] });
    expect((await pedir('PATCH', '/api/miembros/20', { rolId: 4 })).statusCode).toBe(200);
    expect(cliente.cambiarRol).toHaveBeenCalledWith(20, 4);

    cliente.membresia.mockResolvedValue({ id: 20, personaId: 6, roles: [], proyectoId: 11 });
    cliente.quitarMiembro.mockResolvedValue(undefined);
    cliente.tareasAbiertasDe.mockResolvedValue([]);
    expect((await pedir('DELETE', '/api/miembros/20', { pasarA: null })).statusCode).toBe(200);
    expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    expect(cliente.quitarMiembro).toHaveBeenCalledWith(20);
  });

  it('sacar con tareas las deja sin responsable', async () => {
    cliente.quitarMiembro.mockResolvedValue(undefined);
    const res = await pedir('DELETE', '/api/miembros/20', { pasarA: null });
    expect(res.statusCode).toBe(200);
    expect(cliente.actualizarTarea).toHaveBeenCalledTimes(2);
    expect(cliente.actualizarTarea).toHaveBeenCalledWith(1, 7, { responsableId: null });
    expect(cache.tarea(1)!.responsableId).toBeNull();
    expect(cache.tarea(3)!.responsableId).toBe(5);
  });

  it('sacar pasando a otra persona', async () => {
    cliente.quitarMiembro.mockResolvedValue(undefined);
    await pedir('DELETE', '/api/miembros/20', { pasarA: 6 });
    expect(cliente.actualizarTarea).toHaveBeenCalledWith(2, 7, { responsableId: 6 });
  });

  it('pasar a alguien que no es asignable o a la misma persona da 400', async () => {
    expect((await pedir('DELETE', '/api/miembros/20', { pasarA: 99 })).statusCode).toBe(400);
    expect((await pedir('DELETE', '/api/miembros/20', { pasarA: 5 })).statusCode).toBe(400);
    expect(cliente.quitarMiembro).not.toHaveBeenCalled();
  });

  it('si una reasignación da 409 no se saca y se nombra la tarea', async () => {
    cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('conflicto', 'versión vieja', 409));
    const res = await pedir('DELETE', '/api/miembros/20', { pasarA: null });
    expect(res.statusCode).toBe(409);
    expect(res.json().mensaje).toContain('«Uno»');
    expect(res.json().mensaje).toContain('No se reasignó ninguna');
    expect(cliente.quitarMiembro).not.toHaveBeenCalled();
  });

  it('si la segunda reasignación falla, el aviso dice cuántas ya se pasaron', async () => {
    cliente.actualizarTarea.mockImplementationOnce(async (id: number) => tareaDe(id, { responsableId: null, lockVersion: 8 }));
    cliente.actualizarTarea.mockRejectedValueOnce(new ErrorOp('conflicto', 'versión vieja', 409));
    const res = await pedir('DELETE', '/api/miembros/20', { pasarA: null });
    expect(res.statusCode).toBe(409);
    expect(res.json().mensaje).toContain('Ya se reasignaron 1 de 2');
    expect(cliente.quitarMiembro).not.toHaveBeenCalled();
  });

  it('las tareas a reasignar salen de OpenProject, no de la caché', async () => {
    cache.guardarTareas([tareaDe(1, { responsableId: 4 }), tareaDe(2, { responsableId: 4 })]);
    cliente.tareasAbiertasDe.mockResolvedValue([tareaDe(2, { responsableId: 5, titulo: 'Dos', lockVersion: 3 })]);
    cliente.quitarMiembro.mockResolvedValue(undefined);
    await pedir('DELETE', '/api/miembros/20', { pasarA: 6 });
    expect(cliente.tareasAbiertasDe).toHaveBeenCalledWith(11, 5);
    expect(cliente.actualizarTarea).toHaveBeenCalledTimes(1);
    expect(cliente.actualizarTarea).toHaveBeenCalledWith(2, 3, { responsableId: 6 });
  });

  it('sin permiso para sacar miembros da 403 y no toca ninguna tarea', async () => {
    cliente.capacidades.mockResolvedValue({ ...CAPS, quitarMiembro: false });
    const res = await pedir('DELETE', '/api/miembros/20', { pasarA: 6 });
    expect(res.statusCode).toBe(403);
    expect(cliente.tareasAbiertasDe).not.toHaveBeenCalled();
    expect(cliente.actualizarTarea).not.toHaveBeenCalled();
    expect(cliente.quitarMiembro).not.toHaveBeenCalled();
  });

  it('un 403 al sacar es «no tenés permiso»', async () => {
    cliente.quitarMiembro.mockRejectedValue(new ErrorOp('prohibido', 'no', 403));
    const res = await pedir('DELETE', '/api/miembros/20', { pasarA: null });
    expect(res.statusCode).toBe(403);
  });

  it('un proyecto que no ve da 404', async () => {
    expect((await pedir('GET', '/api/proyectos/12/miembros')).statusCode).toBe(404);
    cliente.membresia.mockResolvedValue({ id: 20, personaId: 5, roles: [], proyectoId: 12 });
    expect((await pedir('DELETE', '/api/miembros/20', { pasarA: null })).statusCode).toBe(404);
    expect(cliente.quitarMiembro).not.toHaveBeenCalled();
  });
});
