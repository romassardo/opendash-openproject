import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import type { Ajustes, CatalogoOp } from '../../compartido/tipos.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import { crearCache } from '../sync/cache.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const AHORA = new Date('2026-10-19T12:00:00.000Z');
const proyecto = (id: number) => ({ id, nombre: `Proy ${id}`, identificador: `p${id}`, activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' });

const CATALOGO: CatalogoOp = {
  estados: [
    { id: 10, nombre: 'New', cerrado: false, color: '#fff' },
    { id: 11, nombre: 'In progress', cerrado: false, color: '#fff' },
    { id: 13, nombre: 'On hold', cerrado: false, color: '#fff' },
    { id: 12, nombre: 'Closed', cerrado: true, color: '#000' },
    { id: 14, nombre: 'Rejected', cerrado: true, color: '#000' },
  ],
  tipos: [],
  prioridades: [],
  proyectos: [proyecto(1), proyecto(2), proyecto(3)],
  versiones: [],
  personas: [],
  asignables: {},
  semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [],
};
const SIN_MAPEO = { nuevo: null, curso: null, pausa: null, cerrado: null };

describe('rutas de ajustes del equipo', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;

  const pedir = (metodo: 'GET' | 'PUT', url: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, cookies: { od_sesion: sesion } });

  beforeEach(async () => {
    db = abrirDb(':memory:');
    app = await crearApp({ config, db, crearCliente: () => ({}) as never, ahora: () => AHORA, sync: syncFalso() });
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (9,'rmedina','Ramiro','h','t',?)").run(AHORA.toISOString());
    db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (9, 1), (9, 2)').run();
    crearCache(db).guardarCatalogo(CATALOGO);
    sesion = crearSesion(db, 9, AHORA);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('ajustes completa con el estilo por defecto los proyectos sin estilo', async () => {
    db.prepare("insert into proyecto_estilo (proyecto_id, color, icono) values (2, 'rosa', 'cohete'), (3, 'verde', 'globo')").run();
    const r = await pedir('GET', '/api/ajustes');
    expect(r.statusCode).toBe(200);
    const d = r.json().datos as Ajustes;
    // el proyecto 1 no tiene fila: recibe el primer tono libre del catálogo (azul; rosa y verde ya están elegidos) e ícono carpeta; el 3 no es visible: no aparece
    expect(d.estilos).toEqual({ 1: { color: 'azul', icono: 'carpeta' }, 2: { color: 'rosa', icono: 'cohete' } });
    expect(d.metricas).toEqual({ horasPorDefecto: 4, horasSemanaLargas: 4, capacidadPorDefecto: 40, restarReuniones: false });
  });

  it('los colores por defecto se reparten sobre todo el catálogo, sin repetir', async () => {
    // 1 % 7 y 8 % 7 darían el mismo tono con el cálculo por id
    crearCache(db).guardarCatalogo({ ...CATALOGO, proyectos: [proyecto(1), proyecto(8)] });
    db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (9, 8)').run();
    const ambos = ((await pedir('GET', '/api/ajustes')).json().datos as Ajustes).estilos;
    expect(ambos[1]!.color).not.toBe(ambos[8]!.color);
    db.prepare('delete from usuario_proyectos where usuario_id = 9 and proyecto_id in (1, 2)').run();
    const solo8 = ((await pedir('GET', '/api/ajustes')).json().datos as Ajustes).estilos;
    expect(solo8[8]!.color).toBe(ambos[8]!.color);
  });

  it('guarda el estilo de un proyecto visible y lo devuelve en ajustes', async () => {
    const r = await pedir('PUT', '/api/proyectos/1/estilo', { color: 'turquesa', icono: 'llama' });
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual({ color: 'turquesa', icono: 'llama' });
    await pedir('PUT', '/api/proyectos/1/estilo', { color: 'verde', icono: 'globo' });
    expect(((await pedir('GET', '/api/ajustes')).json().datos as Ajustes).estilos[1]).toEqual({ color: 'verde', icono: 'globo' });
  });

  it('guardar el estilo de un proyecto no visible responde no-encontrado', async () => {
    const r = await pedir('PUT', '/api/proyectos/3/estilo', { color: 'verde', icono: 'globo' });
    expect(r.statusCode).toBe(404);
    expect(r.json().codigo).toBe('no-encontrado');
    expect(db.prepare('select count(*) from proyecto_estilo').pluck().get()).toBe(0);
  });

  it('PUT plantilla guarda la marca de un proyecto visible', async () => {
    const r = await pedir('PUT', '/api/proyectos/1/plantilla', { plantilla: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual({ plantilla: true });
    const cat = (await pedir('GET', '/api/catalogo')).json().datos as { plantillas: number[] };
    expect(cat.plantillas).toEqual([1]);
    await pedir('PUT', '/api/proyectos/1/plantilla', { plantilla: false });
    expect(((await pedir('GET', '/api/catalogo')).json().datos as { plantillas: number[] }).plantillas).toEqual([]);
  });

  it('PUT plantilla de un proyecto ajeno da 404', async () => {
    const r = await pedir('PUT', '/api/proyectos/3/plantilla', { plantilla: true });
    expect(r.statusCode).toBe(404);
    expect(db.prepare("select count(*) from ajustes where clave = 'plantillas'").pluck().get()).toBe(0);
  });

  it('PUT plantilla rechaza cuerpos y ids inválidos', async () => {
    expect((await pedir('PUT', '/api/proyectos/1/plantilla', { plantilla: 'si' })).statusCode).toBe(400);
    expect((await pedir('PUT', '/api/proyectos/1/plantilla', { plantilla: true, otro: 1 })).statusCode).toBe(400);
    expect((await pedir('PUT', '/api/proyectos/abc/plantilla', { plantilla: true })).statusCode).toBe(400);
  });

  it('el estilo rechaza tonos, íconos y campos que no existen', async () => {
    for (const malo of [{ color: 'gris', icono: 'carpeta' }, { color: 'azul', icono: 'pelota' }, { color: 'azul' }, { color: 'azul', icono: 'carpeta', otro: 1 }]) {
      const r = await pedir('PUT', '/api/proyectos/1/estilo', malo);
      expect(r.statusCode, JSON.stringify(malo)).toBe(400);
      expect(r.json().codigo).toBe('validacion');
    }
    expect((await pedir('PUT', '/api/proyectos/abc/estilo', { color: 'azul', icono: 'carpeta' })).statusCode).toBe(400);
  });

  it('guarda los valores de las métricas', async () => {
    const m = { horasPorDefecto: 2.5, horasSemanaLargas: 6, capacidadPorDefecto: 32, restarReuniones: false };
    const r = await pedir('PUT', '/api/ajustes/metricas', m);
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual(m);
    expect(((await pedir('GET', '/api/ajustes')).json().datos as Ajustes).metricas).toEqual(m);
  });

  it('restarReuniones vale false por defecto y se guarda', async () => {
    const base = { horasPorDefecto: 4, horasSemanaLargas: 4, capacidadPorDefecto: 40 };
    expect(((await pedir('GET', '/api/ajustes')).json().datos as Ajustes).metricas.restarReuniones).toBe(false);
    const r = await pedir('PUT', '/api/ajustes/metricas', { ...base, restarReuniones: true });
    expect(r.json().datos).toEqual({ ...base, restarReuniones: true });
    expect(((await pedir('GET', '/api/ajustes')).json().datos as Ajustes).metricas.restarReuniones).toBe(true);
    expect((await pedir('PUT', '/api/ajustes/metricas', { ...base, restarReuniones: 'si' })).statusCode).toBe(400);
  });

  it('un PUT de métricas sin restarReuniones lo deja en false', async () => {
    const base = { horasPorDefecto: 4, horasSemanaLargas: 4, capacidadPorDefecto: 40 };
    await pedir('PUT', '/api/ajustes/metricas', { ...base, restarReuniones: true });
    const r = await pedir('PUT', '/api/ajustes/metricas', base);
    expect(r.json().datos).toEqual({ ...base, restarReuniones: false });
    expect(((await pedir('GET', '/api/ajustes')).json().datos as Ajustes).metricas.restarReuniones).toBe(false);
  });

  it('las métricas aceptan los extremos 0,25 y 80 y rechazan lo que está fuera', async () => {
    expect((await pedir('PUT', '/api/ajustes/metricas', { horasPorDefecto: 0.25, horasSemanaLargas: 80, capacidadPorDefecto: 80 })).statusCode).toBe(200);
    for (const malo of [
      { horasPorDefecto: 0.2, horasSemanaLargas: 4, capacidadPorDefecto: 40 },
      { horasPorDefecto: 4, horasSemanaLargas: 80.5, capacidadPorDefecto: 40 },
      { horasPorDefecto: 4, horasSemanaLargas: 4 },
      { horasPorDefecto: 4, horasSemanaLargas: 4, capacidadPorDefecto: 40, otra: 1 },
    ]) {
      const r = await pedir('PUT', '/api/ajustes/metricas', malo);
      expect(r.statusCode, JSON.stringify(malo)).toBe(400);
      expect(r.json().codigo).toBe('validacion');
    }
  });

  it('guarda el mapeo del tablero y el catálogo lo trae', async () => {
    const mapeo = { nuevo: 10, curso: 11, pausa: 13, cerrado: 14 };
    const r = await pedir('PUT', '/api/ajustes/tablero', mapeo);
    expect(r.statusCode).toBe(200);
    expect(r.json().datos).toEqual(mapeo);
    expect((await pedir('GET', '/api/catalogo')).json().datos.tablero).toEqual(mapeo);
  });

  it('el tablero acepta ids nulos (por nombre)', async () => {
    const r = await pedir('PUT', '/api/ajustes/tablero', { ...SIN_MAPEO, cerrado: 12 });
    expect(r.statusCode).toBe(200);
  });

  it('el tablero rechaza un estado abierto en Cerrado', async () => {
    const r = await pedir('PUT', '/api/ajustes/tablero', { ...SIN_MAPEO, cerrado: 11 });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'validacion' });
    expect(r.json().mensaje).toMatch(/Cerrado/);
  });

  it('el tablero rechaza un estado cerrado en una columna abierta', async () => {
    for (const col of ['nuevo', 'curso', 'pausa']) {
      const r = await pedir('PUT', '/api/ajustes/tablero', { ...SIN_MAPEO, [col]: 12 });
      expect(r.statusCode, col).toBe(400);
    }
  });

  it('el tablero rechaza ids repetidos', async () => {
    const r = await pedir('PUT', '/api/ajustes/tablero', { ...SIN_MAPEO, curso: 11, pausa: 11 });
    expect(r.statusCode).toBe(400);
    expect(r.json().mensaje).toMatch(/repet/i);
  });

  it('el tablero rechaza un id que no está en el catálogo', async () => {
    const r = await pedir('PUT', '/api/ajustes/tablero', { ...SIN_MAPEO, curso: 999 });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe('validacion');
  });

  it('sin sesión ninguna ruta responde 401', async () => {
    sesion = 'otra';
    expect((await pedir('GET', '/api/ajustes')).statusCode).toBe(401);
    expect((await pedir('PUT', '/api/ajustes/tablero', SIN_MAPEO)).statusCode).toBe(401);
  });
});
