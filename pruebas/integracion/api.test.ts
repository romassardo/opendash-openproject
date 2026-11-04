// La API propia (Fastify real, SQLite en memoria, cliente real) contra el OpenProject de Docker.
import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Respuesta } from '../../compartido/api.js';
import type { Catalogo, Dependencia, RespuestaComentario, Tarea } from '../../compartido/tipos.js';
import { crearApp } from '../../servidor/app.js';
import { clientePara } from '../../servidor/auth/clientes.js';
import { cargarConfig } from '../../servidor/config.js';
import { abrirDb } from '../../servidor/db/conexion.js';
import { crearClienteOp } from '../../servidor/openproject/cliente.js';
import { usuariosActivos } from '../../servidor/sync/activos.js';
import { crearCache } from '../../servidor/sync/cache.js';
import { crearServicioSync } from '../../servidor/sync/servicio.js';
import { cfg, cruda, hecho } from './ayudas.js';

let db: Database;
let app: FastifyInstance;
let cookie = '';
const creadas: number[] = [];

async function llamar<T>(metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<{ estado: number; cuerpo: Respuesta<T> }> {
  const res = await app.inject({ method: metodo, url, payload: payload as object | undefined, headers: { cookie } });
  return { estado: res.statusCode, cuerpo: res.json() as Respuesta<T> };
}

function datos<T>(r: { cuerpo: Respuesta<T> }): T {
  if (!r.cuerpo.ok) throw new Error(`Respuesta de error: ${JSON.stringify(r.cuerpo)}`);
  return r.cuerpo.datos;
}

async function nuevaTarea(titulo: string): Promise<Tarea> {
  const t = datos(await llamar<Tarea>('POST', '/api/tareas', { titulo, proyectoId: cfg.proyectoId }));
  creadas.push(t.id);
  return t;
}

beforeAll(async () => {
  const config = cargarConfig({
    OPENPROJECT_URL: cfg.url,
    OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 7).toString('base64'),
    OPENDASH_DB: ':memory:',
  });
  db = abrirDb(':memory:');
  const ahora = (): Date => new Date();
  const crearCliente = (token: string) => crearClienteOp({ baseUrl: cfg.url, token });
  const sync = crearServicioSync({
    db,
    cache: crearCache(db),
    clientePara: (id) => clientePara({ config, db, crearCliente }, id),
    ahora,
    usuariosActivos: () => usuariosActivos(db, ahora()),
  });
  app = await crearApp({ config, db, crearCliente, ahora, sync });

  const registro = await app.inject({ method: 'POST', url: '/api/auth/registro', payload: { token: cfg.token, contrasena: 'una-contrasena-larga' } });
  expect(registro.statusCode).toBe(200);
  const setCookie = registro.headers['set-cookie'];
  cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
  const yo = (registro.json() as { datos: { id: number } }).datos.id;
  await sync.cargaCompleta(yo);
});

afterAll(async () => {
  for (const id of creadas) await cruda('DELETE', `/api/v3/work_packages/${id}`);
  await app?.close();
});

describe('API propia contra OpenProject 16', () => {
  it('registro con el token de admin y carga completa: catálogo y tareas sembradas en la caché', async () => {
    const catalogo = datos(await llamar<Catalogo>('GET', '/api/catalogo'));
    expect(catalogo.estados.map((e) => e.nombre)).toEqual(expect.arrayContaining(['New', 'In progress', 'On hold', 'Closed']));
    expect(catalogo.versiones.filter((v) => v.proyectoId === cfg.proyectoId).map((v) => v.nombre).sort()).toEqual(['En curso', 'Finalizado']);
    const { tareas, dependencias } = datos(await llamar<{ tareas: Tarea[]; dependencias: Dependencia[] }>('GET', '/api/tareas'));
    const titulos = tareas.map((t) => t.titulo);
    expect(titulos).toEqual(expect.arrayContaining(['Tarea de prueba 1', 'Tarea de prueba 4 (sin responsable ni fechas)']));
    expect(dependencias.filter((d) => d.predecesoraId === cfg.tareas[0]).length).toBe(2);
  });

  it('mover: En curso pone estado In progress y versión «En curso»; Cerrado pone Closed y «Finalizado»; Nuevo no toca la versión', async () => {
    const catalogo = datos(await llamar<Catalogo>('GET', '/api/catalogo'));
    const estado = (n: string) => catalogo.estados.find((e) => e.nombre === n)!.id;
    let t = await nuevaTarea('Mover por columnas');
    const paso = async (columna: string) => {
      const r = await llamar<Tarea>('POST', `/api/tareas/${t.id}/mover`, { lockVersion: t.lockVersion, columna });
      expect(r.estado).toBe(200);
      t = datos(r);
      return t;
    };
    const curso = await paso('curso');
    expect(curso).toMatchObject({ estadoId: estado('In progress'), versionId: cfg.versiones['En curso'] });
    const pausa = await paso('pausa');
    expect(pausa.estadoId).toBe(estado('On hold'));
    // «En pausa» no existe como versión en el proyecto sembrado: la versión anterior queda como estaba.
    expect(pausa.versionId).toBe(cfg.versiones['En curso']);
    const cerrado = await paso('cerrado');
    expect(cerrado).toMatchObject({ estadoId: estado('Closed'), versionId: cfg.versiones['Finalizado'] });
    expect(cerrado.cerradaEl).not.toBeNull();
    const nuevo = await paso('nuevo');
    expect(nuevo).toMatchObject({ estadoId: estado('New'), versionId: cfg.versiones['Finalizado'], cerradaEl: null });
  });

  it('conflicto: guardar con un lockVersion viejo responde 409 «conflicto» y no pisa el título', async () => {
    const t = await nuevaTarea('Para conflicto');
    const ok = await llamar<Tarea>('PATCH', `/api/tareas/${t.id}`, { lockVersion: t.lockVersion, cambios: { titulo: 'Cambio 1' } });
    expect(ok.estado).toBe(200);
    const viejo = await llamar<Tarea>('PATCH', `/api/tareas/${t.id}`, { lockVersion: t.lockVersion, cambios: { titulo: 'Cambio pisado' } });
    expect(viejo.estado).toBe(409);
    expect(viejo.cuerpo).toMatchObject({ ok: false, codigo: 'conflicto' });
    const actual = datos(await llamar<{ tarea: Tarea }>('GET', `/api/tareas/${t.id}`)).tarea;
    expect(actual.titulo).toBe('Cambio 1');
  });

  it('comentarios: la ruta devuelve las actividades y comentar no invalida el lockVersion que tiene la pantalla', async () => {
    const t = await nuevaTarea('Para comentar');
    const r = await llamar<RespuestaComentario>('POST', `/api/tareas/${t.id}/comentarios`, { texto: 'Hola desde la API propia' });
    expect(r.estado).toBe(200);
    expect(datos(r).actividades.map((a) => a.comentario)).toContain('Hola desde la API propia');
    // La ruta no devuelve la tarea ni su lockVersion; no hace falta porque OpenProject 16 no lo sube al comentar.
    expect(Object.keys(datos(r))).toEqual(['actividades', 'sinReleer']);
    expect(datos(r).sinReleer).toBeNull();
    const guardar = await llamar<Tarea>('PATCH', `/api/tareas/${t.id}`, { lockVersion: t.lockVersion, cambios: { titulo: 'Después de comentar' } });
    hecho('PATCH con el lockVersion previo al comentario, vía API propia', guardar.estado);
    expect(guardar.estado).toBe(200);
    const detalle = datos(await llamar<{ tarea: Tarea }>('GET', `/api/tareas/${t.id}`)).tarea;
    expect(detalle.comentarios).toBe(1);
  });

  it('dependencias: crear y borrar por la API propia se reflejan en OpenProject y en la caché', async () => {
    const a = await nuevaTarea('Dep A');
    const b = await nuevaTarea('Dep B');
    const dep = datos(await llamar<Dependencia>('POST', `/api/tareas/${b.id}/dependencias`, { esperaA: a.id }));
    expect(dep).toMatchObject({ sucesoraId: b.id, predecesoraId: a.id });
    const lista = datos(await llamar<{ dependencias: Dependencia[] }>('GET', '/api/tareas')).dependencias;
    expect(lista.some((d) => d.id === dep.id)).toBe(true);
    const borrada = await llamar<null>('DELETE', `/api/dependencias/${dep.id}`);
    expect(borrada.estado).toBe(200);
    expect((await cruda('GET', `/api/v3/relations/${dep.id}`)).estado).toBe(404);
  });

  it('token inválido en el registro: 400 token-invalido', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/registro', payload: { token: 'no-es-un-token', contrasena: 'una-contrasena-larga' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ ok: false, codigo: 'token-invalido' });
  });
});
