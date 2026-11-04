import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actividad, Persona, Tarea } from '../../compartido/tipos.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp, LoteTareas } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { usuariosActivos } from './activos.js';
import { crearCache, type CacheOp } from './cache.js';
import { conLimite } from './pool.js';
import { CIERRES_RECIENTES_MS, crearServicioSync, type ServicioSync } from './servicio.js';

const AHORA = new Date('2026-10-19T12:00:00-03:00');
const MINUTO = 60_000;
const CIERRE: Actividad = { id: 1, creada: '2026-10-16T18:49:06Z', autorId: 4, comentario: '', detalles: ['Estado se cambió de In progress a Closed'] };
const COMENTARIO = (id: number): Actividad => ({ id, creada: '2026-10-15T10:00:00Z', autorId: 4, comentario: 'hola', detalles: [] });

function crearFalso(inicial?: Tarea[]) {
  let tareas = inicial ?? [
    tareaDe(1),
    tareaDe(2, { estadoId: 3, actualizada: '2026-10-16T19:00:00Z' }),
    tareaDe(3, { estadoId: 3, actualizada: '2026-10-18T10:00:00Z' }),
    tareaDe(98, { proyectoId: 3, estadoId: 3, actualizada: '2026-06-01T10:00:00Z' }),
    tareaDe(99, { proyectoId: 3, estadoId: 3, actualizada: '2026-04-01T10:00:00Z' }),
  ];
  let salteadas: number[] = [];
  const cliente = {
    catalogo: vi.fn(async () => ({
      estados: [
        { id: 1, nombre: 'New', cerrado: false, color: '#aaa' },
        { id: 2, nombre: 'In progress', cerrado: false, color: '#bbb' },
        { id: 3, nombre: 'Closed', cerrado: true, color: '#ccc' },
      ],
      tipos: [], prioridades: [], proyectos: [{ id: 3 }, { id: 11 }], versiones: [], personas: [], asignables: {}, semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [],
    })),
    puedeLeerTareas: vi.fn(async (_id: number) => true),
    asignables: vi.fn(async (_id: number): Promise<Persona[] | null> => []),
    tareas: vi.fn(async (_o?: { actualizadasDesde?: string }): Promise<LoteTareas> => ({ tareas, salteadas })),
    dependencias: vi.fn(async () => [{ id: 7, sucesoraId: 2, predecesoraId: 1, lag: 0 }]),
    actividades: vi.fn(async (id: number): Promise<Actividad[]> => {
      if (id === 2) return [CIERRE];
      if (id === 1) return [COMENTARIO(11), COMENTARIO(12), { ...COMENTARIO(13), comentario: ' ' }];
      return [];
    }),
  };
  return { cliente, poner: (t: Tarea[], saltear: number[] = []) => { tareas = t; salteadas = saltear; } };
}

describe('servicio de sincronización', () => {
  let db: Database;
  let cache: CacheOp;
  let falso: ReturnType<typeof crearFalso>;
  let servicio: ServicioSync;
  let reloj: Date;
  let clientes: Map<number, ClienteOp>;
  const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const crear = (extra: { activos?: () => number[]; intervalos?: { incrementalMs: number; completoMs: number } } = {}) =>
    crearServicioSync({
      db, cache, registro, clientePara: (id) => clientes.get(id) ?? null, ahora: () => reloj, usuariosActivos: extra.activos ?? (() => [9]), intervalos: extra.intervalos,
    });
  const marca = (clave: string) => db.prepare('select valor from estado_sync where clave = ?').pluck().get(clave);

  beforeEach(() => {
    registro.info.mockClear(); registro.warn.mockClear(); registro.error.mockClear();
    db = abrirDb(':memory:');
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (9,'rm','R','h','t','2026-01-01'), (10,'ot','O','h','t','2026-01-01')").run();
    cache = crearCache(db, () => reloj);
    reloj = AHORA;
    falso = crearFalso();
    clientes = new Map([[9, falso.cliente as unknown as ClienteOp]]);
    servicio = crear();
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); db.close(); });

  it('carga completa llena catálogo, tareas, dependencias y proyectos del usuario', async () => {
    await servicio.cargaCompleta(9);
    expect(cache.catalogo()?.estados).toHaveLength(3);
    expect(cache.tareas([11]).map((t) => t.id)).toEqual([1, 2, 3]);
    expect(cache.dependencias()).toHaveLength(1);
    expect(cache.proyectosDe(9)).toEqual([3, 11]);
    expect(servicio.estado()).toEqual({ desactualizado: false, ultimoRefresco: AHORA.toISOString() });
    expect(marca('ultimo_completo:9')).toBe(AHORA.toISOString());
  });

  it('la carga completa guarda los asignables de cada proyecto legible', async () => {
    const ana = { id: 31, nombre: 'Ana', login: null, email: null, avatarUrl: null };
    const beto = { id: 32, nombre: 'Beto', login: null, email: null, avatarUrl: null };
    falso.cliente.puedeLeerTareas.mockImplementation(async (id: number) => id !== 3);
    falso.cliente.asignables.mockImplementation(async (id: number) => (id === 11 ? [ana, beto] : [ana]));
    await servicio.cargaCompleta(9);
    const c = cache.catalogo()!;
    expect(c.asignables).toEqual({ 11: [31, 32] });
    expect(falso.cliente.asignables).not.toHaveBeenCalledWith(3);
    expect(c.personas.map((p) => p.id).sort()).toEqual([31, 32]);
  });

  it('la falla de asignables en un proyecto no corta la carga completa y conserva la lista anterior', async () => {
    const ana = { id: 31, nombre: 'Ana', login: null, email: null, avatarUrl: null };
    falso.cliente.asignables.mockImplementation(async () => [ana]);
    await servicio.cargaCompleta(9);
    expect(cache.catalogo()!.asignables).toEqual({ 3: [31], 11: [31] });
    falso.cliente.asignables.mockImplementation(async (id: number) => {
      if (id === 11) throw new ErrorOp('red', 'boom');
      return [];
    });
    await servicio.cargaCompleta(9);
    expect(cache.catalogo()!.asignables).toEqual({ 3: [], 11: [31] });
    expect(servicio.estado().desactualizado).toBe(false);
    expect(registro.warn).toHaveBeenCalledWith(expect.objectContaining({ proyectoId: 11 }), expect.stringContaining('[sync]'));
  });

  it('un 403 de asignables no pisa la lista que trajo otra persona', async () => {
    const ana = { id: 31, nombre: 'Ana', login: null, email: null, avatarUrl: null };
    falso.cliente.asignables.mockImplementation(async () => [ana]);
    await servicio.cargaCompleta(9);
    falso.cliente.asignables.mockImplementation(async () => null);
    await servicio.cargaCompleta(9);
    expect(cache.catalogo()!.asignables).toEqual({ 3: [31], 11: [31] });
  });

  it('cuenta los comentarios de las tareas abiertas ignorando las entradas sin texto', async () => {
    await servicio.cargaCompleta(9);
    expect(cache.tarea(1)!.comentarios).toBe(2);
    expect(servicio.estado().desactualizado).toBe(false);
  });

  it('guarda la fecha de cierre desde el historial y usa actualizada si no la encuentra', async () => {
    await servicio.cargaCompleta(9);
    expect(cache.tarea(2)!.cerradaEl).toBe('2026-10-16T18:49:06Z');
    expect(cache.tarea(3)!.cerradaEl).toBe(cache.tarea(3)!.actualizada);
    expect(servicio.estado().desactualizado).toBe(false);
  });

  it('la carga completa recupera cierres de hasta 185 días', async () => {
    expect(CIERRES_RECIENTES_MS).toBe(185 * 24 * 60 * 60 * 1000);
    await servicio.cargaCompleta(9);
    expect(falso.cliente.actividades).toHaveBeenCalledWith(98);
    expect(falso.cliente.actividades).not.toHaveBeenCalledWith(99);
  });

  it('no vuelve a pedir el historial de una cerrada que ya tiene cierre', async () => {
    await servicio.cargaCompleta(9);
    falso.cliente.actividades.mockClear();
    await servicio.cargaCompleta(9);
    expect(falso.cliente.actividades).not.toHaveBeenCalledWith(2);
    expect(falso.cliente.actividades).not.toHaveBeenCalledWith(3);
  });

  it('quita de la caché las tareas que ya no existen', async () => {
    await servicio.cargaCompleta(9);
    falso.poner([tareaDe(1), tareaDe(2, { estadoId: 3 })]);
    await servicio.cargaCompleta(9);
    expect(cache.tarea(3)).toBeNull();
    expect(cache.tarea(2)).not.toBeNull();
  });

  it('la carga completa no borra una tarea que OpenProject devolvió con forma rara', async () => {
    await servicio.cargaCompleta(9);
    expect(cache.tarea(2)?.cerradaEl).not.toBeNull();
    falso.poner([tareaDe(1)], [2, 3]);
    await servicio.cargaCompleta(9);
    expect(cache.tarea(2)).not.toBeNull();
    expect(cache.tarea(2)?.cerradaEl).toBe('2026-10-16T18:49:06Z');
    expect(cache.tarea(3)).not.toBeNull();
  });

  it('una base restaurada con lockVersion menor reemplaza la copia guardada en la carga completa', async () => {
    await servicio.cargaCompleta(9);
    cache.guardarTareas([tareaDe(1, { lockVersion: 9 })]);
    reloj = new Date(AHORA.getTime() + 10 * MINUTO);
    falso.poner([tareaDe(1, { lockVersion: 2 }), tareaDe(2, { estadoId: 3, actualizada: '2026-10-16T19:00:00Z' }), tareaDe(3, { estadoId: 3, actualizada: '2026-10-18T10:00:00Z' })]);
    await servicio.cargaCompleta(9);
    expect(cache.tarea(1)?.lockVersion).toBe(2);
  });

  it('reemplaza los proyectos del usuario en cada carga', async () => {
    db.prepare('insert into usuario_proyectos values (9, 55)').run();
    await servicio.cargaCompleta(9);
    expect(cache.proyectosDe(9)).toEqual([3, 11]);
  });

  describe('proyectos legibles', () => {
    it('un proyecto visible pero no legible conserva sus tareas y no entra a usuario_proyectos', async () => {
      cache.guardarTareas([tareaDe(50, { proyectoId: 3 })]);
      falso.cliente.puedeLeerTareas.mockImplementation(async (id: number) => id !== 3);
      falso.poner([tareaDe(1)]);
      await servicio.cargaCompleta(9);
      expect(cache.tarea(50)).not.toBeNull();
      expect(cache.proyectosDe(9)).toEqual([11]);
    });

    it('una respuesta vacía con la caché llena no borra nada y avisa', async () => {
      await servicio.cargaCompleta(9);
      falso.poner([]);
      await servicio.cargaCompleta(9);
      expect(cache.tareas([11]).map((t) => t.id)).toEqual([1, 2, 3]);
      expect(registro.warn).toHaveBeenCalledWith(expect.objectContaining({ motivo: 'vacio-sospechoso' }), expect.stringContaining('0 tareas'));
    });

    it('si puedeLeerTareas falla por red la carga queda desactualizada y no toca la caché', async () => {
      cache.guardarTareas([tareaDe(50)]);
      falso.cliente.puedeLeerTareas.mockRejectedValue(new ErrorOp('red', 'x'));
      await servicio.cargaCompleta(9);
      expect(servicio.estado().desactualizado).toBe(true);
      expect(cache.tarea(1)).toBeNull();
      expect(cache.tarea(50)).not.toBeNull();
    });
  });

  describe('caché compartida entre usuarios', () => {
    it('la carga de un usuario no borra dependencias, proyectos, versiones ni personas que vio otro', async () => {
      const proyecto = { id: 77, nombre: 'Ajeno', identificador: 'aj', activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' };
      cache.guardarCatalogo({
        estados: [], tipos: [], prioridades: [], proyectos: [proyecto],
        versiones: [{ id: 5, nombre: 'v1', proyectoId: 77, estado: 'abierta', inicio: null, fin: null }], personas: [{ id: 31, nombre: 'Ana', login: null, email: null, avatarUrl: null }], asignables: { 77: [31] }, semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [],
      });
      cache.guardarTareas([tareaDe(500, { proyectoId: 77 }), tareaDe(501, { proyectoId: 77 })]);
      cache.guardarDependencias([{ id: 70, sucesoraId: 501, predecesoraId: 500, lag: 0 }], [500, 501]);
      await servicio.cargaCompleta(9);
      const c = cache.catalogo()!;
      expect(c.proyectos.map((p) => p.id)).toContain(77);
      expect(c.versiones.map((v) => v.id)).toContain(5);
      expect(c.personas.map((p) => p.id)).toContain(31);
      expect(c.asignables[77]).toEqual([31]);
      expect(c.estados).toHaveLength(3);
      expect(cache.dependencias().map((d) => d.id)).toEqual([7, 70]);
      expect(cache.tarea(500)).not.toBeNull();
    });
  });

  describe('fecha de cierre', () => {
    it('cerrada en agosto, reabierta y cerrada de nuevo entre dos refrescos: queda la fecha nueva', async () => {
      await servicio.cargaCompleta(9);
      cache.guardarCierre(2, '2026-08-01T10:00:00Z');
      reloj = new Date(AHORA.getTime() + 5 * MINUTO);
      falso.cliente.tareas.mockResolvedValueOnce({ tareas: [tareaDe(2, { estadoId: 3, actualizada: '2026-10-19T15:02:00Z' })], salteadas: [] });
      await servicio.refrescoIncremental(9);
      expect(cache.tarea(2)!.cerradaEl).toBe('2026-10-16T18:49:06Z');
    });

    it('la carga completa relee el historial de una cerrada cuya actualizada cambió, y no la de una igual', async () => {
      await servicio.cargaCompleta(9);
      cache.guardarCierre(2, '2026-08-01T10:00:00Z');
      cache.guardarCierre(3, '2026-08-02T10:00:00Z');
      falso.cliente.actividades.mockClear();
      falso.poner([
        tareaDe(1),
        tareaDe(2, { estadoId: 3, actualizada: '2026-10-18T20:00:00Z' }),
        tareaDe(3, { estadoId: 3, actualizada: '2026-10-18T10:00:00Z' }),
      ]);
      await servicio.cargaCompleta(9);
      expect(cache.tarea(2)!.cerradaEl).toBe('2026-10-16T18:49:06Z');
      expect(falso.cliente.actividades).toHaveBeenCalledWith(2);
      expect(falso.cliente.actividades).not.toHaveBeenCalledWith(3);
      expect(cache.tarea(3)!.cerradaEl).toBe('2026-08-02T10:00:00Z');
    });

    it('una copia vieja que trae la sincronización no pisa la tarea ni el cierre que dejó la app', async () => {
      await servicio.cargaCompleta(9);
      // Desde la app se cerró la tarea 1 (lockVersion 5) mientras la sincronización traía una copia anterior.
      cache.guardarTareas([tareaDe(1, { lockVersion: 5, titulo: 'Desde la app', estadoId: 3 })]);
      cache.guardarCierre(1, '2026-10-19T14:00:00Z');
      reloj = new Date(AHORA.getTime() + 5 * MINUTO);
      falso.cliente.actividades.mockClear();
      falso.cliente.tareas.mockResolvedValueOnce({ tareas: [tareaDe(1, { lockVersion: 4, estadoId: 1, actualizada: '2026-10-19T14:58:00Z' })], salteadas: [] });
      await servicio.refrescoIncremental(9);
      expect(cache.tarea(1)).toMatchObject({ lockVersion: 5, titulo: 'Desde la app', cerradaEl: '2026-10-19T14:00:00Z' });
      expect(falso.cliente.actividades).not.toHaveBeenCalled();
      // Lo mismo con la carga completa, si la app escribió mientras se leía (después de tomar leidaDesde).
      cache.guardarTareas([tareaDe(1, { lockVersion: 1 })]);
      falso.cliente.tareas.mockImplementationOnce(async () => {
        cache.guardarTareas([tareaDe(1, { lockVersion: 5, titulo: 'Desde la app', estadoId: 3 })]);
        return { tareas: [tareaDe(1, { lockVersion: 4, estadoId: 1 }), tareaDe(2, { estadoId: 3, actualizada: '2026-10-16T19:00:00Z' })], salteadas: [] };
      });
      await servicio.cargaCompleta(9);
      expect(cache.tarea(1)).toMatchObject({ lockVersion: 5, titulo: 'Desde la app', cerradaEl: '2026-10-19T14:00:00Z' });
    });

    it('reabierta: cerradaEl vuelve a null', async () => {
      await servicio.cargaCompleta(9);
      expect(cache.tarea(2)!.cerradaEl).not.toBeNull();
      reloj = new Date(AHORA.getTime() + 5 * MINUTO);
      falso.cliente.tareas.mockResolvedValueOnce({ tareas: [tareaDe(2, { estadoId: 2, actualizada: '2026-10-19T15:02:00Z' })], salteadas: [] });
      await servicio.refrescoIncremental(9);
      expect(cache.tarea(2)!.cerradaEl).toBeNull();
    });
  });

  it('una falla de historial (no 401) se saltea y la carga sigue', async () => {
    falso.cliente.actividades.mockImplementation(async (id: number) => {
      if (id === 1) throw new ErrorOp('red', 'cortado');
      return id === 2 ? [CIERRE] : [];
    });
    await servicio.cargaCompleta(9);
    expect(cache.tarea(1)!.comentarios).toBeNull();
    expect(cache.tarea(2)!.cerradaEl).toBe('2026-10-16T18:49:06Z');
    expect(servicio.estado().desactualizado).toBe(false);
    expect(registro.warn).toHaveBeenCalledWith(expect.objectContaining({ motivo: 'historial-omitido', tareaId: 1 }), expect.stringContaining('[sync]'));
  });

  it('registra en el registro inyectado la falla de un refresco', async () => {
    falso.cliente.tareas.mockRejectedValueOnce(new ErrorOp('red', 'cortado'));
    await servicio.cargaCompleta(9);
    expect(servicio.estado().desactualizado).toBe(true);
    expect(registro.warn).toHaveBeenCalledWith(expect.objectContaining({ motivo: 'red' }), expect.stringContaining('[sync] refresco fallido'));
  });

  it('un 401 en el historial corta la carga, marca el token vencido y no avanza la ventana', async () => {
    falso.poner(Array.from({ length: 10 }, (_, i) => tareaDe(i + 1)));
    falso.cliente.actividades.mockRejectedValue(new ErrorOp('no-autorizado', '401'));
    await servicio.cargaCompleta(9);
    expect(db.prepare('select token_vencido from usuarios where id = 9').pluck().get()).toBe(1);
    expect(falso.cliente.actividades.mock.calls.length).toBeLessThan(10);
    expect(marca('ultimo_refresco:9')).toBeUndefined();
  });

  it('el historial corre con como máximo 3 llamadas a la vez', async () => {
    falso.poner(Array.from({ length: 10 }, (_, i) => tareaDe(i + 1)));
    let activas = 0;
    let maximo = 0;
    falso.cliente.actividades.mockImplementation(async () => {
      activas += 1;
      maximo = Math.max(maximo, activas);
      await new Promise((r) => setTimeout(r, 5));
      activas -= 1;
      return [];
    });
    await servicio.cargaCompleta(9);
    expect(falso.cliente.actividades).toHaveBeenCalledTimes(10);
    expect(maximo).toBe(3);
  });

  it('incremental pide desde el último refresco menos 60 s', async () => {
    await servicio.cargaCompleta(9);
    await servicio.refrescoIncremental(9);
    expect(falso.cliente.tareas).toHaveBeenLastCalledWith({ actualizadasDesde: '2026-10-19T14:59:00.000Z' });
  });

  it('incremental sin ventana previa del usuario hace una carga completa', async () => {
    await servicio.refrescoIncremental(9);
    expect(falso.cliente.catalogo).toHaveBeenCalledTimes(1);
    expect(cache.tareas([11])).toHaveLength(3);
  });

  it('incremental guarda tareas nuevas, recuenta comentarios y lee el historial de las cerradas de la ventana', async () => {
    await servicio.cargaCompleta(9);
    falso.cliente.actividades.mockClear();
    reloj = new Date(AHORA.getTime() + MINUTO);
    falso.cliente.tareas.mockResolvedValueOnce({ tareas: [
      tareaDe(1, { actualizada: '2026-10-19T14:59:30Z' }),
      tareaDe(5, { estadoId: 3, actualizada: '2026-10-19T14:59:40Z' }),
    ], salteadas: [] });
    await servicio.refrescoIncremental(9);
    expect(cache.tarea(5)!.cerradaEl).toBe('2026-10-19T14:59:40Z');
    expect(falso.cliente.actividades).toHaveBeenCalledWith(5);
    expect(falso.cliente.actividades).toHaveBeenCalledWith(1);
    expect(falso.cliente.actividades).not.toHaveBeenCalledWith(2);
  });

  it('marca desactualizado si falla la red y conserva la caché', async () => {
    await servicio.cargaCompleta(9);
    falso.cliente.tareas.mockRejectedValueOnce(new ErrorOp('red', 'fetch failed'));
    await servicio.refrescoIncremental(9);
    expect(servicio.estado().desactualizado).toBe(true);
    expect(cache.tareas([11]).length).toBe(3);
  });

  it('una falla no adelanta la ventana: el siguiente incremental pide desde el último refresco correcto', async () => {
    await servicio.cargaCompleta(9);
    reloj = new Date(AHORA.getTime() + 10 * MINUTO);
    falso.cliente.tareas.mockRejectedValueOnce(new ErrorOp('red', 'x'));
    await servicio.refrescoIncremental(9);
    expect(marca('ultimo_refresco:9')).toBe(AHORA.toISOString());
    reloj = new Date(AHORA.getTime() + 20 * MINUTO);
    await servicio.refrescoIncremental(9);
    expect(falso.cliente.tareas).toHaveBeenLastCalledWith({ actualizadasDesde: '2026-10-19T14:59:00.000Z' });
    expect(marca('ultimo_refresco:9')).toBe(reloj.toISOString());
  });

  it('un refresco correcto vuelve desactualizado a falso', async () => {
    await servicio.cargaCompleta(9);
    falso.cliente.tareas.mockRejectedValueOnce(new ErrorOp('red', 'fetch failed'));
    await servicio.refrescoIncremental(9);
    await servicio.refrescoIncremental(9);
    expect(servicio.estado().desactualizado).toBe(false);
  });

  it('el estado sobrevive a un reinicio (se guarda en la base)', async () => {
    await servicio.cargaCompleta(9);
    falso.cliente.tareas.mockRejectedValueOnce(new ErrorOp('red', 'x'));
    await servicio.refrescoIncremental(9);
    expect(crear().estado()).toEqual({ desactualizado: true, ultimoRefresco: AHORA.toISOString() });
  });

  it('un 401 marca el token como vencido', async () => {
    await servicio.cargaCompleta(9);
    falso.cliente.tareas.mockRejectedValueOnce(new ErrorOp('no-autorizado', '401'));
    await servicio.refrescoIncremental(9);
    expect(db.prepare('select token_vencido from usuarios where id = 9').pluck().get()).toBe(1);
  });

  it('sin cliente para el usuario no hace nada', async () => {
    await crear().cargaCompleta(4);
    expect(falso.cliente.catalogo).not.toHaveBeenCalled();
  });

  it('las corridas pasan por una sola cola: una carga espera a que termine la anterior', async () => {
    let soltar: () => void = () => {};
    const original = falso.cliente.catalogo.getMockImplementation()!;
    falso.cliente.catalogo.mockImplementationOnce(async () => { await new Promise<void>((r) => { soltar = r; }); return original(); });
    const a = servicio.cargaCompleta(9);
    const b = servicio.cargaCompleta(9);
    await new Promise((r) => setTimeout(r, 10));
    expect(falso.cliente.catalogo).toHaveBeenCalledTimes(1);
    soltar();
    await Promise.all([a, b]);
    expect(falso.cliente.catalogo).toHaveBeenCalledTimes(2);
  });

  describe('iniciar / detener', () => {
    const intervalos = { incrementalMs: 45_000, completoMs: 3_600_000 };
    const dos = () => {
      const otro = crearFalso([tareaDe(20, { proyectoId: 12 })]);
      otro.cliente.catalogo.mockImplementation(async () => ({ ...(await falso.cliente.catalogo()), proyectos: [{ id: 12 }] as never }));
      clientes.set(10, otro.cliente as unknown as ClienteOp);
      return otro;
    };

    it('el primer turno hace carga completa; los siguientes, incremental; y detener frena todo', async () => {
      vi.useFakeTimers();
      const s = crear({ intervalos });
      s.iniciar();
      await vi.advanceTimersByTimeAsync(45_000);
      expect(falso.cliente.catalogo).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(falso.cliente.tareas).toHaveBeenCalledTimes(2);
      expect(falso.cliente.catalogo).toHaveBeenCalledTimes(1);
      s.detener();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(falso.cliente.tareas).toHaveBeenCalledTimes(2);
    });

    it('usa solo los usuarios activos que tengan cliente', async () => {
      vi.useFakeTimers();
      const s = crear({ activos: () => [4, 9], intervalos });
      s.iniciar();
      await vi.advanceTimersByTimeAsync(45_000);
      expect(falso.cliente.tareas).toHaveBeenCalledTimes(1);
      s.detener();
    });

    it('hace la carga completa de cada usuario activo cada 60 min', async () => {
      vi.useFakeTimers();
      await servicio.cargaCompleta(9);
      falso.cliente.catalogo.mockClear();
      const s = crear({ intervalos });
      s.iniciar();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(falso.cliente.catalogo).toHaveBeenCalledTimes(2); // primer turno + turno horario
      s.detener();
    });

    it('no hace nada si no hay usuarios activos con cliente', async () => {
      vi.useFakeTimers();
      const s = crear({ activos: () => [4], intervalos });
      s.iniciar();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(falso.cliente.tareas).not.toHaveBeenCalled();
      s.detener();
    });

    it('no superpone turnos de 45 s: si una corrida sigue en curso, saltea el turno', async () => {
      vi.useFakeTimers();
      let soltar: (l: LoteTareas) => void = () => {};
      falso.cliente.tareas.mockImplementationOnce(() => new Promise<LoteTareas>((r) => { soltar = r; }));
      const s = crear({ intervalos });
      s.iniciar();
      await vi.advanceTimersByTimeAsync(135_000);
      expect(falso.cliente.tareas).toHaveBeenCalledTimes(1);
      soltar({ tareas: [], salteadas: [] });
      await vi.advanceTimersByTimeAsync(45_000);
      expect(falso.cliente.tareas).toHaveBeenCalledTimes(2);
      s.detener();
    });

    it('el turno horario que coincide con otra corrida se posterga, no se pierde', async () => {
      vi.useFakeTimers();
      await servicio.cargaCompleta(9);
      falso.cliente.catalogo.mockClear();
      let soltar: () => void = () => {};
      const original = falso.cliente.catalogo.getMockImplementation()!;
      falso.cliente.catalogo.mockImplementationOnce(async () => { await new Promise<void>((r) => { soltar = r; }); return original(); });
      const s = crear({ intervalos });
      s.iniciar();
      await vi.advanceTimersByTimeAsync(3_600_000); // el primer turno sigue colgado cuando llega el horario
      expect(falso.cliente.catalogo).toHaveBeenCalledTimes(1);
      soltar();
      await vi.advanceTimersByTimeAsync(1);
      expect(falso.cliente.catalogo).toHaveBeenCalledTimes(2);
      s.detener();
    });

    it('cada usuario activo usa su propia ventana y la falla del primero no frena al segundo', async () => {
      vi.useFakeTimers();
      const otro = dos();
      const s = crear({ activos: () => [9, 10], intervalos });
      await servicio.cargaCompleta(9);
      reloj = new Date(AHORA.getTime() + 5 * MINUTO);
      await servicio.cargaCompleta(10);
      reloj = new Date(AHORA.getTime() + 10 * MINUTO);
      s.iniciar();
      await vi.advanceTimersByTimeAsync(45_000); // primer turno: completa para ambos
      falso.cliente.tareas.mockClear();
      otro.cliente.tareas.mockClear();
      falso.cliente.tareas.mockRejectedValueOnce(new ErrorOp('red', 'caído'));
      await vi.advanceTimersByTimeAsync(45_000);
      expect(falso.cliente.tareas).toHaveBeenCalledTimes(1);
      expect(otro.cliente.tareas).toHaveBeenCalledTimes(1);
      expect(otro.cliente.tareas).toHaveBeenLastCalledWith({ actualizadasDesde: new Date(reloj.getTime() - MINUTO).toISOString() });
      s.detener();
    });

    it('incrementales directos: cada usuario pide con su propia ventana', async () => {
      const otro = dos();
      await servicio.cargaCompleta(9);
      reloj = new Date(AHORA.getTime() + 5 * MINUTO);
      await servicio.cargaCompleta(10);
      reloj = new Date(AHORA.getTime() + 8 * MINUTO);
      await servicio.refrescoIncremental(9);
      await servicio.refrescoIncremental(10);
      expect(falso.cliente.tareas).toHaveBeenLastCalledWith({ actualizadasDesde: '2026-10-19T14:59:00.000Z' });
      expect(otro.cliente.tareas).toHaveBeenLastCalledWith({ actualizadasDesde: '2026-10-19T15:04:00.000Z' });
      expect(servicio.estado().ultimoRefresco).toBe(reloj.toISOString());
    });
  });
});

describe('usuariosActivos', () => {
  it('devuelve los de los últimos 15 minutos con token vigente, el más reciente primero', () => {
    const db = abrirDb(':memory:');
    const poner = db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado, ultima_actividad) values (?, ?, 'n', 'h', 't', ?, '2026-01-01', ?)");
    poner.run(1, 'a', 0, '2026-10-19T14:50:00.000Z');
    poner.run(2, 'b', 0, '2026-10-19T14:58:00.000Z');
    poner.run(3, 'c', 1, '2026-10-19T14:59:00.000Z');
    poner.run(4, 'd', 0, '2026-10-19T14:44:59.000Z');
    poner.run(5, 'e', 0, null);
    expect(usuariosActivos(db, AHORA)).toEqual([2, 1]);
    db.close();
  });
});

describe('conLimite', () => {
  it('procesa todo con el límite dado y conserva los resultados', async () => {
    let activas = 0;
    let maximo = 0;
    const r = await conLimite([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      activas += 1; maximo = Math.max(maximo, activas);
      await new Promise((ok) => setTimeout(ok, 2));
      activas -= 1;
      return n * 2;
    });
    expect(r).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(maximo).toBe(3);
  });

  it('ante un error deja de lanzar trabajos nuevos y lo propaga', async () => {
    const visto: number[] = [];
    await expect(conLimite([1, 2, 3, 4, 5, 6], 2, async (n) => {
      visto.push(n);
      if (n === 1) throw new Error('corte');
      await new Promise((ok) => setTimeout(ok, 5));
    })).rejects.toThrow('corte');
    expect(visto.length).toBeLessThan(6);
  });
});
