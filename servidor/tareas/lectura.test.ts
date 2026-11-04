import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalogo, CatalogoOp, Persona, Tarea } from '../../compartido/tipos.js';
import { tareaDe, syncFalso } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { cifrar } from '../seguridad/cifrado.js';
import { crearCache } from '../sync/cache.js';
import { sanearTarea } from './rutas.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const persona = (id: number): Persona => ({ id, nombre: `P${id}`, login: `p${id}`, email: null, avatarUrl: null });
const proyecto = (id: number) => ({ id, nombre: `Proy ${id}`, identificador: `p${id}`, activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' });

const CATALOGO: CatalogoOp = {
  estados: [
    { id: 1, nombre: 'New', cerrado: false, color: '#fff' },
    { id: 2, nombre: 'Closed', cerrado: true, color: '#000' },
  ],
  tipos: [{ id: 1, nombre: 'Task', esHito: false, color: '#000' }],
  prioridades: [{ id: 8, nombre: 'Normal', alta: false, nivel: 'normal' }],
  proyectos: [proyecto(11), proyecto(20)],
  versiones: [{ id: 1, nombre: 'En curso', proyectoId: 11, estado: 'abierta', inicio: null, fin: null }, { id: 2, nombre: 'En curso', proyectoId: 20, estado: 'abierta', inicio: null, fin: null }],
  personas: [persona(9), persona(2), persona(3), persona(4), persona(5), persona(6), persona(7)],
  asignables: { 11: [9, 6], 20: [4, 7] },
  semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [],
};

describe('API de lectura de tareas', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;
  const ahora = new Date('2026-10-19T12:00:00.000Z');
  const sync = { ...syncFalso(), estado: vi.fn(() => ({ desactualizado: false, ultimoRefresco: null as string | null })) };
  const cliente = { tarea: vi.fn(), actividades: vi.fn() };
  const tokens: string[] = [];
  const cache = () => crearCache(db);
  const conSesion = (metodo: 'GET', url: string) => app.inject({ method: metodo, url, cookies: { od_sesion: sesion } });

  function crearUsuario(id: number, proyectos: number[]): string {
    db.prepare(
      "insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (?, ?, ?, 'h', ?, 0, ?)",
    ).run(id, `u${id}`, `U${id}`, cifrar(`tok${id}`, config.claveCifrado), ahora.toISOString());
    for (const p of proyectos) db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (?, ?)').run(id, p);
    return crearSesion(db, id, ahora);
  }

  beforeEach(async () => {
    db = abrirDb(':memory:');
    tokens.length = 0;
    cliente.tarea.mockReset();
    cliente.actividades.mockReset().mockResolvedValue([]);
    sync.estado.mockReturnValue({ desactualizado: false, ultimoRefresco: null });
    app = await crearApp({ config, db, crearCliente: (token: string) => { tokens.push(token); return cliente as unknown as ClienteOp; }, ahora: () => ahora, sync });
    sesion = crearUsuario(9, [11]);
    cache().guardarCatalogo(CATALOGO);
    cache().guardarTareas([
      tareaDe(1, { proyectoId: 11, responsableId: 2, autorId: 3 }),
      tareaDe(2, { proyectoId: 11 }),
      tareaDe(3, { proyectoId: 20, responsableId: 4, autorId: 5 }),
    ]);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe('GET /api/tareas', () => {
    it('solo devuelve tareas de proyectos visibles para el usuario', async () => {
      const r = await conSesion('GET', '/api/tareas');
      expect(r.statusCode).toBe(200);
      expect((r.json().datos.tareas as Tarea[]).map((t) => t.id)).toEqual([1, 2]);
    });

    it('devuelve la caché con desactualizado=true', async () => {
      sync.estado.mockReturnValue({ desactualizado: true, ultimoRefresco: '2026-10-19T11:00:00Z' });
      expect((await conSesion('GET', '/api/tareas')).json()).toMatchObject({ ok: true, desactualizado: true });
    });

    it('descarta dependencias con un extremo oculto', async () => {
      cache().guardarDependencias(
        [
          { id: 1, sucesoraId: 2, predecesoraId: 1, lag: 0 },
          { id: 2, sucesoraId: 3, predecesoraId: 1, lag: 0 },
          { id: 3, sucesoraId: 1, predecesoraId: 3, lag: 0 },
        ],
        [1, 2, 3],
      );
      const r = await conSesion('GET', '/api/tareas');
      expect(r.json().datos.dependencias.map((d: { id: number }) => d.id)).toEqual([1]);
    });

    it('la lista saca madreId y versionId no visibles', async () => {
      cache().guardarTareas([tareaDe(1, { madreId: 3, versionId: 2 }), tareaDe(2, { madreId: 1, versionId: 1 })]);
      const ts = (await conSesion('GET', '/api/tareas')).json().datos.tareas as Tarea[];
      expect(ts.find((t) => t.id === 1)).toMatchObject({ madreId: null, versionId: null });
      expect(ts.find((t) => t.id === 2)).toMatchObject({ madreId: 1, versionId: 1 });
    });

    it('con proyectosDe vacío devuelve listas vacías', async () => {
      sesion = crearUsuario(10, []);
      const r = await conSesion('GET', '/api/tareas');
      expect(r.statusCode).toBe(200);
      expect(r.json().datos).toEqual({ tareas: [], dependencias: [] });
    });

    it('sin sesión responde 401', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/tareas' })).statusCode).toBe(401);
    });
  });

  describe('GET /api/catalogo', () => {
    it('filtra proyectos, versiones y personas; deja estados, tipos y prioridades', async () => {
      const d = (await conSesion('GET', '/api/catalogo')).json().datos as Catalogo;
      expect(d.proyectos.map((p) => p.id)).toEqual([11]);
      expect(d.versiones.map((v) => v.id)).toEqual([1]);
      expect(d.personas.map((p) => p.id).sort()).toEqual([2, 3, 6, 9]);
      expect(d.estados).toEqual(CATALOGO.estados);
      expect(d.tipos).toEqual(CATALOGO.tipos);
      expect(d.prioridades).toEqual(CATALOGO.prioridades);
    });

    it('trae los días no laborables y, con una caché vieja sin esos campos, sábado y domingo', async () => {
      const nuevo = (await conSesion('GET', '/api/catalogo')).json().datos as Catalogo;
      expect(nuevo.semanaNoLaborable).toEqual([0, 6]);
      expect(nuevo.diasNoLaborables).toEqual([]);
      const { semanaNoLaborable: _s, diasNoLaborables: _d, ...viejo } = CATALOGO;
      cache().guardarCatalogo(viejo as typeof CATALOGO);
      const d = (await conSesion('GET', '/api/catalogo')).json().datos as Catalogo;
      expect(d.semanaNoLaborable).toEqual([0, 6]);
      expect(d.diasNoLaborables).toEqual([]);
      cache().guardarCatalogo({ ...CATALOGO, semanaNoLaborable: [5], diasNoLaborables: ['2026-11-23'] });
      const h = (await conSesion('GET', '/api/catalogo')).json().datos as Catalogo;
      expect(h.semanaNoLaborable).toEqual([5]);
      expect(h.diasNoLaborables).toEqual(['2026-11-23']);
    });

    it('/api/catalogo mezcla las plantillas de OpenProject con lo marcado a mano', async () => {
      const marcar = (valor: unknown) => db.prepare("insert into ajustes (clave, valor) values ('plantillas', ?) on conflict(clave) do update set valor = excluded.valor").run(JSON.stringify(valor));
      expect(((await conSesion('GET', '/api/catalogo')).json().datos as Catalogo).plantillas).toEqual([]);
      // 11 es visible; 12 no lo es y nunca aparece aunque OpenProject lo marque.
      cache().guardarCatalogo({ ...CATALOGO, plantillasOp: [11, 12] });
      expect(((await conSesion('GET', '/api/catalogo')).json().datos as Catalogo).plantillas).toEqual([11]);
      marcar({ 11: false });
      expect(((await conSesion('GET', '/api/catalogo')).json().datos as Catalogo).plantillas).toEqual([]);
      cache().guardarCatalogo({ ...CATALOGO, plantillasOp: [] });
      marcar({ 11: true });
      expect(((await conSesion('GET', '/api/catalogo')).json().datos as Catalogo).plantillas).toEqual([11]);
      // una caché vieja sin el campo se lee como []
      const { plantillasOp: _p, ...viejo } = CATALOGO;
      marcar({});
      cache().guardarCatalogo(viejo as typeof CATALOGO);
      expect(((await conSesion('GET', '/api/catalogo')).json().datos as Catalogo).plantillas).toEqual([]);
    });

    it('el catálogo trae el mapeo del tablero', async () => {
      expect(((await conSesion('GET', '/api/catalogo')).json().datos as Catalogo).tablero).toEqual({ nuevo: null, curso: null, pausa: null, cerrado: null });
      db.prepare("insert into ajustes (clave, valor) values ('tablero', ?)").run(JSON.stringify({ nuevo: 1, curso: 2, pausa: null, cerrado: 3 }));
      expect(((await conSesion('GET', '/api/catalogo')).json().datos as Catalogo).tablero).toEqual({ nuevo: 1, curso: 2, pausa: null, cerrado: 3 });
    });

    it('el catálogo incluye a los asignables de los proyectos visibles aunque no tengan tareas', async () => {
      const d = (await conSesion('GET', '/api/catalogo')).json().datos as Catalogo;
      expect(d.asignables[11]).toEqual([9, 6]);
      expect(d.personas.map((p) => p.id)).toContain(6);
    });

    it('el catálogo no expone asignables de proyectos que el usuario no ve', async () => {
      const d = (await conSesion('GET', '/api/catalogo')).json().datos as Catalogo;
      expect(Object.keys(d.asignables)).toEqual(['11']);
      expect(d.personas.map((p) => p.id)).not.toContain(7);
    });

    it('con proyectosDe vacío deja solo al propio usuario como persona', async () => {
      sesion = crearUsuario(10, []);
      cache().guardarCatalogo({ ...CATALOGO, personas: [persona(10)] });
      const d = (await conSesion('GET', '/api/catalogo')).json().datos as Catalogo;
      expect(d.proyectos).toEqual([]);
      expect(d.versiones).toEqual([]);
      expect(d.personas.map((p) => p.id)).toEqual([10]);
      expect(d.personas.map((p) => p.id)).not.toContain(4);
    });

    it('los avatares apuntan al proxy propio, nunca a OpenProject', async () => {
      cache().guardarCatalogo({
        ...CATALOGO,
        personas: [
          { ...persona(9), avatarUrl: 'http://op.test/api/v3/users/9/avatar' },
          { ...persona(2), avatarUrl: 'https://www.gravatar.com/avatar/abc' },
          persona(3),
        ],
      });
      const d = (await conSesion('GET', '/api/catalogo')).json().datos as Catalogo;
      const avatares = Object.fromEntries(d.personas.map((p) => [p.id, p.avatarUrl]));
      expect(avatares).toEqual({ 9: '/api/personas/9/avatar', 2: '/api/personas/2/avatar', 3: null, 6: null });
      expect(d.personas.some((p) => p.avatarUrl?.startsWith('http'))).toBe(false);
    });
  });

  describe('GET /api/tareas/:id', () => {
    it('pide en vivo y actualiza la caché', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(1, { lockVersion: 8, proyectoId: 11 }));
      cliente.actividades.mockResolvedValue([{ id: 5, creada: 'x', autorId: 2, comentario: 'hola', detalles: [] }]);
      const r = await conSesion('GET', '/api/tareas/1');
      expect(r.statusCode).toBe(200);
      expect(r.json().datos.tarea.lockVersion).toBe(8);
      expect(r.json().datos.actividades).toHaveLength(1);
      expect(cache().tarea(1)?.lockVersion).toBe(8);
    });

    it('responde token-vencido cuando OpenProject rechaza el token', async () => {
      cliente.tarea.mockRejectedValueOnce(new ErrorOp('no-autorizado', '401'));
      const r = await conSesion('GET', '/api/tareas/1');
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject({ codigo: 'token-vencido' });
      expect(db.prepare('select token_vencido from usuarios where id = 9').pluck().get()).toBe(1);
    });

    it('sin red el detalle sale de la caché', async () => {
      cliente.tarea.mockRejectedValueOnce(new ErrorOp('red', 'caído'));
      const r = await conSesion('GET', '/api/tareas/1');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, desactualizado: true, datos: { actividades: [], tarea: { id: 1 } } });
    });

    it('sin red y sin caché responde 503 sin-conexion', async () => {
      cliente.tarea.mockRejectedValueOnce(new ErrorOp('red', 'caído'));
      const r = await conSesion('GET', '/api/tareas/99');
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'sin-conexion' });
    });

    it('cacheada de proyecto no legible: pregunta a OpenProject y responde igual que un id inexistente', async () => {
      cliente.tarea.mockRejectedValue(new ErrorOp('no-encontrado', 'no', 404));
      const oculta = await conSesion('GET', '/api/tareas/3');
      const inexistente = await conSesion('GET', '/api/tareas/999');
      expect(cliente.tarea).toHaveBeenCalledWith(3);
      expect(oculta.statusCode).toBe(404);
      expect(oculta.json()).toEqual(inexistente.json());
    });

    it('cacheada no legible con OpenProject caído responde 503, no 404', async () => {
      cliente.tarea.mockRejectedValue(new ErrorOp('red', 'caído'));
      const r = await conSesion('GET', '/api/tareas/3');
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ codigo: 'sin-conexion' });
    });

    it('cacheada no legible que OpenProject devuelve responde 200', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(3, { proyectoId: 20, lockVersion: 4 }));
      const r = await conSesion('GET', '/api/tareas/3');
      expect(r.statusCode).toBe(200);
      expect(r.json().datos.tarea.lockVersion).toBe(4);
    });

    it('usa el token del usuario que actúa', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(1));
      await conSesion('GET', '/api/tareas/1');
      expect(tokens).toEqual(['tok9']);
      const otra = crearUsuario(10, [11]);
      await app.inject({ method: 'GET', url: '/api/tareas/1', cookies: { od_sesion: otra } });
      expect(tokens).toEqual(['tok9', 'tok10']);
    });

    it('sin sesión responde 401 en catálogo y detalle', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/catalogo' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/api/tareas/1' })).statusCode).toBe(401);
    });

    it('un Error plano en cliente.tarea responde 500 interno', async () => {
      cliente.tarea.mockRejectedValue(new Error('raro'));
      const r = await conSesion('GET', '/api/tareas/1');
      expect(r.statusCode).toBe(500);
      expect(r.json()).toMatchObject({ codigo: 'interno' });
    });

    it('si solo falla actividades por red devuelve la tarea fresca, actividades [] y desactualizado', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(1, { lockVersion: 7 }));
      cliente.actividades.mockRejectedValue(new ErrorOp('red', 'caído'));
      const r = await conSesion('GET', '/api/tareas/1');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ desactualizado: true, datos: { actividades: [], tarea: { lockVersion: 7 } } });
    });

    it('si actividades falla por otro motivo mapea ese error', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(1));
      cliente.actividades.mockRejectedValue(new ErrorOp('prohibido', 'no', 403));
      expect((await conSesion('GET', '/api/tareas/1')).statusCode).toBe(403);
    });

    it('una tarea reabierta pierde cerradaEl en detalle y lista; los comentarios se recuentan', async () => {
      cache().guardarCierre(1, '2026-10-05T00:00:00Z');
      cliente.tarea.mockResolvedValue(tareaDe(1, { estadoId: 1 }));
      cliente.actividades.mockResolvedValue([{ id: 5, creada: 'x', autorId: 2, comentario: 'hola', detalles: [] }]);
      const r = await conSesion('GET', '/api/tareas/1');
      expect(r.json().datos.tarea).toMatchObject({ cerradaEl: null, comentarios: 1 });
      const lista = (await conSesion('GET', '/api/tareas')).json().datos.tareas as Tarea[];
      expect(lista.find((t) => t.id === 1)?.cerradaEl).toBeNull();
    });

    it('tarea cerrada con historial guarda la fecha de cierre del historial', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(1, { estadoId: 2, actualizada: '2026-10-18T00:00:00Z' }));
      cliente.actividades.mockResolvedValue([{ id: 5, creada: '2026-08-01T00:00:00Z', autorId: 2, comentario: '', detalles: ['Estado se cambió de New a Closed'] }]);
      const r = await conSesion('GET', '/api/tareas/1');
      expect(r.json().datos.tarea.cerradaEl).toBe('2026-08-01T00:00:00Z');
    });

    it('tarea cerrada con historial caído por red conserva el cierre anterior', async () => {
      cache().guardarCierre(1, '2026-08-01T00:00:00Z');
      cliente.tarea.mockResolvedValue(tareaDe(1, { estadoId: 2, actualizada: '2026-10-18T00:00:00Z' }));
      cliente.actividades.mockRejectedValue(new ErrorOp('red', 'caído'));
      const r = await conSesion('GET', '/api/tareas/1');
      expect(r.json().datos.tarea.cerradaEl).toBe('2026-08-01T00:00:00Z');
      expect(cache().tarea(1)?.cerradaEl).toBe('2026-08-01T00:00:00Z');
    });

    it('el detalle saneado oculta madre y versión no visibles', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(1, { madreId: 3, versionId: 2 }));
      const t = (await conSesion('GET', '/api/tareas/1')).json().datos.tarea as Tarea;
      expect(t.madreId).toBeNull();
      expect(t.versionId).toBeNull();
    });

    it('el detalle conserva madre y versión visibles', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(1, { madreId: 2, versionId: 1 }));
      const t = (await conSesion('GET', '/api/tareas/1')).json().datos.tarea as Tarea;
      expect(t.madreId).toBe(2);
      expect(t.versionId).toBe(1);
    });

    it('el respaldo por red también sanea', async () => {
      cache().guardarTareas([tareaDe(1, { proyectoId: 11, madreId: 3, versionId: 2 })]);
      cliente.tarea.mockRejectedValue(new ErrorOp('red', 'caído'));
      const t = (await conSesion('GET', '/api/tareas/1')).json().datos.tarea as Tarea;
      expect(t).toMatchObject({ madreId: null, versionId: null });
    });

    it('una tarea fuera de la caché se pide a OpenProject y se guarda', async () => {
      cliente.tarea.mockResolvedValue(tareaDe(50, { proyectoId: 11 }));
      const r = await conSesion('GET', '/api/tareas/50');
      expect(r.statusCode).toBe(200);
      expect(cliente.tarea).toHaveBeenCalledWith(50);
      expect(cache().tarea(50)).not.toBeNull();
    });

    it('una tarea fuera de la caché que OpenProject no deja leer responde 403', async () => {
      cliente.tarea.mockRejectedValue(new ErrorOp('prohibido', 'no', 403));
      expect((await conSesion('GET', '/api/tareas/50')).statusCode).toBe(403);
    });

    it.each(['abc', '0', '-3', '1.5', '1e3', '0x10', '%201', '+1', '01', '12345678901'])('rechaza el id %s con 400 validacion', async (id) => {
      const r = await conSesion('GET', `/api/tareas/${id}`);
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ codigo: 'validacion' });
    });
  });

  it('sanearTarea es pura', () => {
    const t = tareaDe(1, { madreId: 5, versionId: 6 });
    const r = sanearTarea(t, { tareas: new Set(), versiones: new Set([6]) });
    expect(r).toMatchObject({ madreId: null, versionId: 6 });
    expect(t.madreId).toBe(5);
  });
});
