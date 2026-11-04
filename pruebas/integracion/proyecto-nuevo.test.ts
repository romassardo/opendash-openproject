// Proyectos nuevos y versiones por la API propia (Fastify real, cliente real) con personas de distinto rol, contra OpenProject 16.
import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EstadoNuevo, OpcionesNuevo } from '../../servidor/proyectos/nuevo.js';
import { crearApp } from '../../servidor/app.js';
import { clientePara } from '../../servidor/auth/clientes.js';
import { cargarConfig } from '../../servidor/config.js';
import { abrirDb } from '../../servidor/db/conexion.js';
import { crearClienteOp } from '../../servidor/openproject/cliente.js';
import { usuariosActivos } from '../../servidor/sync/activos.js';
import { crearCache } from '../../servidor/sync/cache.js';
import { crearServicioSync } from '../../servidor/sync/servicio.js';
import { admin, borrarProyecto, cfg, crearProyecto, quitarMembresia, tokenConRol } from './ayudas.js';

interface Persona { cookie: string }

let db: Database;
let app: FastifyInstance;
let proyectoId = 0;
let versionId = 0;
let sincronizar: (usuarioId: number) => Promise<void> = async () => {};
const proyectosACerrar: number[] = [];
const plantillaId = cfg.plantilla.plantillaId;

async function registrar(token: string): Promise<Persona> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/registro', payload: { token, contrasena: 'una-contrasena-larga' } });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
  await sincronizar((res.json() as { datos: { id: number } }).datos.id);
  return { cookie };
}

const llamar = (persona: Persona, metodo: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method: metodo, url, payload: payload as object | undefined, headers: { cookie: persona.cookie } });

let proyectAdmin: Persona;
let lector: Persona;

beforeAll(async () => {
  const config = cargarConfig({ OPENPROJECT_URL: cfg.url, OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 7).toString('base64'), OPENDASH_DB: ':memory:' });
  db = abrirDb(':memory:');
  const ahora = (): Date => new Date();
  const crearCliente = (token: string) => crearClienteOp({ baseUrl: cfg.url, token });
  const sync = crearServicioSync({
    db, cache: crearCache(db), clientePara: (id) => clientePara({ config, db, crearCliente }, id), ahora, usuariosActivos: () => usuariosActivos(db, ahora()),
  });
  sincronizar = (id) => sync.cargaCompleta(id);
  app = await crearApp({ config, db, crearCliente, ahora, sync });

  proyectoId = await crearProyecto(`int-nuevo-${Date.now()}`, 'Integración proyecto nuevo');
  versionId = (await admin.crearVersion(proyectoId, { nombre: 'Versión de prueba', inicio: null, fin: null })).id;
  // «Project admin» y «Reader» ven la plantilla (y el proyecto de la versión) con su rol.
  const tokenAdmin = await tokenConRol('Project admin', plantillaId);
  const tokenLector = await tokenConRol('Reader', plantillaId);
  await tokenConRol('Reader', proyectoId);
  await tokenConRol('Project admin', proyectoId);
  proyectAdmin = await registrar(tokenAdmin);
  lector = await registrar(tokenLector);
});

afterAll(async () => {
  await app?.close();
  for (const id of [proyectoId, ...proyectosACerrar]) if (id !== 0) await borrarProyecto(id);
  quitarMembresia('Project admin', plantillaId);
  quitarMembresia('Reader', plantillaId);
});

describe('GET /api/proyectos/nuevo con distintos roles', () => {
  it('Reader: no puede crear vacío ni copiar la plantilla', async () => {
    const res = await llamar(lector, 'GET', '/api/proyectos/nuevo');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { datos: OpcionesNuevo }).datos).toEqual({ vacio: false, plantillas: [] });
  });

  it('Project admin: puede copiar la plantilla; crear vacío exige un permiso global que no tiene', async () => {
    const res = await llamar(proyectAdmin, 'GET', '/api/proyectos/nuevo');
    expect(res.statusCode).toBe(200);
    const datos = (res.json() as { datos: OpcionesNuevo }).datos;
    expect(datos.vacio).toBe(false);
    expect(datos.plantillas.map((p) => p.id)).toContain(plantillaId);
  });
});

describe('POST /api/proyectos/nuevo con distintos roles', () => {
  it('Reader: 403 en vacío y en copia, y no arranca nada', async () => {
    const vacio = await llamar(lector, 'POST', '/api/proyectos/nuevo', { nombre: `Lector vacío ${Date.now()}`, plantillaId: null });
    expect(vacio.statusCode).toBe(403);
    const copia = await llamar(lector, 'POST', '/api/proyectos/nuevo', { nombre: `Lector copia ${Date.now()}`, plantillaId });
    expect(copia.statusCode).toBe(403);
  });

  it('Project admin: 403 en vacío; la copia de la plantilla corre y deja el proyecto creado', async () => {
    const vacio = await llamar(proyectAdmin, 'POST', '/api/proyectos/nuevo', { nombre: `PA vacío ${Date.now()}`, plantillaId: null });
    expect(vacio.statusCode).toBe(403);
    const nombre = `PA copia ${Date.now()}`;
    const res = await llamar(proyectAdmin, 'POST', '/api/proyectos/nuevo', { nombre, plantillaId });
    expect(res.statusCode).toBe(200);
    const trabajo = (res.json() as { datos: { trabajo: string } }).datos.trabajo;
    let estado: EstadoNuevo | null = null;
    for (let i = 0; i < 90 && (estado === null || (estado.paso !== 'listo' && estado.paso !== 'fallo')); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      estado = ((await llamar(proyectAdmin, 'GET', `/api/proyectos/nuevo/${trabajo}`)).json() as { datos: EstadoNuevo }).datos;
    }
    // Pase lo que pase en OpenProject, si el proyecto se creó hay que borrarlo.
    const creado = (await admin.catalogo()).proyectos.find((p) => p.nombre === nombre);
    if (creado !== undefined) proyectosACerrar.push(creado.id);
    expect(estado?.paso).toBe('listo');
    expect(estado?.proyectoId).toBe(creado?.id);
  });
});

describe('PATCH /api/versiones/:id', () => {
  it('un 403 de OpenProject al cambiar una versión llega como «no tenés permiso»', async () => {
    const res = await llamar(lector, 'PATCH', `/api/versiones/${versionId}`, { nombre: 'Renombrada por el lector' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, codigo: 'prohibido', mensaje: 'No tenés permiso para hacer eso en OpenProject' });
  });
});
