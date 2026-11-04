import type { Database } from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogoOp } from '../../compartido/tipos.js';
import { abrirDb } from '../db/conexion.js';
import { crearCache, type CacheOp } from './cache.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

describe('caché de OpenProject', () => {
  let db: Database;
  let cache: CacheOp;
  beforeEach(() => { db = abrirDb(':memory:'); cache = crearCache(db); });

  it('el catálogo es null hasta que se guarda y luego se recupera igual', () => {
    expect(cache.catalogo()).toBeNull();
    const c: CatalogoOp = { estados: [{ id: 1, nombre: 'New', cerrado: false, color: '#fff' }], tipos: [], prioridades: [], proyectos: [], versiones: [], personas: [], asignables: {}, semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [] };
    cache.guardarCatalogo(c);
    expect(cache.catalogo()).toEqual(c);
  });

  it('completa cerradaEl y comentarios desde sus tablas', () => {
    cache.guardarTareas([tareaDe(1), tareaDe(2)]);
    cache.guardarCierre(2, '2026-10-16T18:49:06Z');
    cache.guardarComentarios(2, 4);
    expect(cache.tarea(1)).toMatchObject({ cerradaEl: null, comentarios: null });
    expect(cache.tarea(2)).toMatchObject({ cerradaEl: '2026-10-16T18:49:06Z', comentarios: 4 });
    expect(cache.tareas([11]).map((t) => t.id)).toEqual([1, 2]);
  });

  it('una fila guardada sin horasReales (JSON viejo) se lee con null', () => {
    const { horasReales: _omitida, ...vieja } = tareaDe(1);
    db.prepare('insert into cache_tareas (id, proyecto_id, datos, actualizada) values (?, ?, ?, ?)').run(1, 11, JSON.stringify(vieja), vieja.actualizada);
    expect(cache.tarea(1)?.horasReales).toBeNull();
  });

  it('guardarTareas reemplaza la tarea existente y tarea() devuelve null si no hay', () => {
    cache.guardarTareas([tareaDe(1)]);
    cache.guardarTareas([tareaDe(1, { titulo: 'nuevo', proyectoId: 12 })]);
    expect(cache.tarea(1)?.titulo).toBe('nuevo');
    expect(cache.tareas([11])).toEqual([]);
    expect(cache.tarea(77)).toBeNull();
    expect(cache.tareas([])).toEqual([]);
  });

  it('una copia más vieja (lockVersion menor) no pisa a la guardada; igual o mayor sí', () => {
    cache.guardarTareas([tareaDe(1, { lockVersion: 5, titulo: 'nueva' })]);
    expect(cache.guardarTareas([tareaDe(1, { lockVersion: 4, titulo: 'vieja', proyectoId: 12 })])).toEqual([]);
    expect(cache.tarea(1)).toMatchObject({ lockVersion: 5, titulo: 'nueva', proyectoId: 11 });
    expect(cache.guardarTareas([tareaDe(1, { lockVersion: 5, titulo: 'misma versión' }), tareaDe(2)])).toEqual([1, 2]);
    expect(cache.tarea(1)?.titulo).toBe('misma versión');
    cache.guardarTareas([tareaDe(1, { lockVersion: 6, titulo: 'más nueva' })]);
    expect(cache.tarea(1)).toMatchObject({ lockVersion: 6, titulo: 'más nueva' });
  });

  it('quitarAusentes borra solo dentro de los proyectos dados, con sus cierres y comentarios', () => {
    cache.guardarTareas([tareaDe(1), tareaDe(2), tareaDe(3, { proyectoId: 12 })]);
    cache.guardarCierre(2, '2026-10-16T18:49:06Z');
    cache.guardarComentarios(2, 1);
    cache.quitarAusentes([1], [11]);
    expect(cache.tarea(2)).toBeNull();
    expect(cache.tarea(3)).not.toBeNull();
    expect(db.prepare('select count(*) from cierres').pluck().get()).toBe(0);
    expect(db.prepare('select count(*) from comentarios_cuenta').pluck().get()).toBe(0);
  });

  it('guardarDependencias conserva las relaciones con un extremo que el usuario no ve', () => {
    cache.guardarDependencias([{ id: 1, sucesoraId: 2, predecesoraId: 1, lag: 0 }], [1, 2]);
    cache.guardarDependencias([], [1]);
    expect(cache.dependencias()).toEqual([{ id: 1, sucesoraId: 2, predecesoraId: 1, lag: 0 }]);
  });

  it('guardarDependencias borra una relación entre dos tareas que el usuario ve y ya no existe', () => {
    cache.guardarDependencias([
      { id: 1, sucesoraId: 2, predecesoraId: 1, lag: 0 },
      { id: 2, sucesoraId: 51, predecesoraId: 50, lag: 0 },
    ], [1, 2, 50, 51]);
    cache.guardarDependencias([{ id: 5, sucesoraId: 3, predecesoraId: 2, lag: 2 }], [1, 2, 3]);
    expect(cache.dependencias()).toEqual([
      { id: 2, sucesoraId: 51, predecesoraId: 50, lag: 0 },
      { id: 5, sucesoraId: 3, predecesoraId: 2, lag: 2 },
    ]);
  });

  describe('copias más viejas', () => {
    let reloj: Date;
    beforeEach(() => { reloj = new Date('2026-10-19T10:00:00.000Z'); cache = crearCache(db, () => reloj); });

    it('una copia más vieja entra si la guardada es anterior a la lectura (restauración de OpenProject)', () => {
      cache.guardarTareas([tareaDe(1, { lockVersion: 9 })]);
      reloj = new Date('2026-10-19T10:06:00.000Z');
      expect(cache.guardarTareas([tareaDe(1, { lockVersion: 3 })], { leidaDesde: '2026-10-19T10:05:00.000Z' })).toEqual([1]);
      expect(cache.tarea(1)?.lockVersion).toBe(3);
    });

    it('una copia más vieja no pisa una escritura hecha durante la lectura', () => {
      reloj = new Date('2026-10-19T10:02:00.000Z');
      cache.guardarTareas([tareaDe(1, { lockVersion: 9 })]);
      expect(cache.guardarTareas([tareaDe(1, { lockVersion: 3 })], { leidaDesde: '2026-10-19T10:00:00.000Z' })).toEqual([]);
      expect(cache.tarea(1)?.lockVersion).toBe(9);
    });

    it('sin leidaDesde una copia más vieja no entra', () => {
      cache.guardarTareas([tareaDe(1, { lockVersion: 9 })]);
      expect(cache.guardarTareas([tareaDe(1, { lockVersion: 3 })])).toEqual([]);
      expect(cache.tarea(1)?.lockVersion).toBe(9);
    });
  });

  it('el catálogo reemplaza estados/tipos/prioridades y fusiona proyectos, versiones y personas por id', () => {
    const p = (id: number, nombre: string) => ({ id, nombre, identificador: `p${id}`, activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' });
    const persona = (id: number) => ({ id, nombre: `P${id}`, login: null, email: null, avatarUrl: null });
    const base: CatalogoOp = { estados: [{ id: 1, nombre: 'A', cerrado: false, color: '#fff' }], tipos: [], prioridades: [], proyectos: [p(1, 'uno'), p(2, 'dos')], versiones: [{ id: 5, nombre: 'v', proyectoId: 1, estado: 'abierta', inicio: null, fin: null }], personas: [persona(1)], asignables: { 1: [1], 2: [1] }, semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [] };
    cache.guardarCatalogo(base);
    cache.guardarCatalogo({ ...base, estados: [], proyectos: [p(2, 'dos!')], versiones: [], personas: [persona(2)], asignables: { 2: [2] } });
    const c = cache.catalogo()!;
    expect(c.estados).toEqual([]);
    expect(c.proyectos.map((x) => [x.id, x.nombre])).toEqual([[1, 'uno'], [2, 'dos!']]);
    expect(c.versiones).toHaveLength(1);
    expect(c.personas.map((x) => x.id)).toEqual([1, 2]);
    // Los asignables se reemplazan solo en los proyectos que trae la carga nueva.
    expect(c.asignables).toEqual({ 1: [1], 2: [2] });
  });

  it('quitarCierre borra la fecha de cierre', () => {
    cache.guardarTareas([tareaDe(1)]);
    cache.guardarCierre(1, '2026-08-01T10:00:00Z');
    cache.quitarCierre(1);
    expect(cache.tarea(1)!.cerradaEl).toBeNull();
  });

  it('quitarTareas borra las tareas con su cierre, sus comentarios y las dependencias que las tocan', () => {
    cache.guardarTareas([tareaDe(1), tareaDe(2), tareaDe(3)]);
    cache.guardarCierre(1, '2026-08-01T10:00:00Z');
    cache.guardarComentarios(1, 2);
    cache.agregarDependencia({ id: 1, sucesoraId: 2, predecesoraId: 1, lag: 0 });
    cache.agregarDependencia({ id: 2, sucesoraId: 3, predecesoraId: 2, lag: 0 });
    cache.quitarTareas([1]);
    expect(cache.tarea(1)).toBeNull();
    expect(db.prepare('select count(*) from cierres').pluck().get()).toBe(0);
    expect(db.prepare('select count(*) from comentarios_cuenta').pluck().get()).toBe(0);
    expect(cache.dependencias().map((d) => d.id)).toEqual([2]);
    expect(cache.tarea(2)).not.toBeNull();
    cache.quitarTareas([]);
  });

  it('proyectosDe devuelve los proyectos del usuario ordenados', () => {
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (9,'a','A','h','t','2026-01-01')").run();
    db.prepare('insert into usuario_proyectos values (9, 11), (9, 3)').run();
    expect(cache.proyectosDe(9)).toEqual([3, 11]);
    expect(cache.proyectosDe(1)).toEqual([]);
  });
  it('guardarVersion y quitarVersion cambian solo esa versión del catálogo', () => {
    const base: CatalogoOp = { estados: [], tipos: [], prioridades: [], proyectos: [], versiones: [{ id: 1, nombre: 'A', proyectoId: 11, estado: 'abierta', inicio: null, fin: null }], personas: [], asignables: {}, semanaNoLaborable: [], diasNoLaborables: [], plantillasOp: [] };
    cache.guardarCatalogo(base);
    cache.guardarVersion({ id: 2, nombre: 'B', proyectoId: 11, estado: 'abierta', inicio: null, fin: null });
    cache.guardarVersion({ id: 1, nombre: 'A2', proyectoId: 11, estado: 'cerrada', inicio: null, fin: null });
    expect(cache.catalogo()!.versiones.map((v) => [v.id, v.nombre, v.estado])).toEqual([[1, 'A2', 'cerrada'], [2, 'B', 'abierta']]);
    cache.quitarVersion(1);
    expect(cache.catalogo()!.versiones.map((v) => v.id)).toEqual([2]);
  });

  it('guardarVersion y quitarVersion sin catálogo no hacen nada', () => {
    cache.guardarVersion({ id: 2, nombre: 'B', proyectoId: 11, estado: 'abierta', inicio: null, fin: null });
    cache.quitarVersion(2);
    expect(cache.catalogo()).toBeNull();
  });
});
