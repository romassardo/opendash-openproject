import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogoOp, Proyecto } from '../../compartido/tipos.js';
import { syncFalso } from '../../pruebas/fabricas/sync.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { guardarPlantilla } from '../ajustes/repositorio.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { cifrar } from '../seguridad/cifrado.js';
import { crearCache } from '../sync/cache.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const ahora = new Date('2026-10-25T12:00:00.000Z');
const proyecto = (id: number, nombre: string): Proyecto =>
  ({ id, nombre, identificador: `p${id}`, activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' });

const CATALOGO: CatalogoOp = {
  estados: [], tipos: [], prioridades: [], versiones: [], personas: [], asignables: {}, semanaNoLaborable: [], diasNoLaborables: [],
  proyectos: [proyecto(11, 'Portal'), proyecto(17, 'Proyectos Template'), proyecto(18, 'Otra plantilla')],
  plantillasOp: [17, 18],
};
const CAPS = { crearMiembro: false, cambiarMiembro: false, quitarMiembro: false, copiarProyecto: true };

describe('API de proyectos nuevos', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;
  let sesionAjena: string;
  const cliente = {
    puedeCrearProyectos: vi.fn(), capacidades: vi.fn(), crearProyecto: vi.fn(), copiarProyecto: vi.fn(), estadoCopia: vi.fn(),
    unionesEntre: vi.fn(), borrarDependencia: vi.fn(),
  };
  // La carga completa de verdad deja al proyecto nuevo entre los de la persona; acá se simula.
  const creados = new Set<number>();
  const cargaCompleta = vi.fn(async (u: number) => {
    for (const id of creados) db.prepare('insert or ignore into usuario_proyectos (usuario_id, proyecto_id) values (?, ?)').run(u, id);
  });
  let reloj = ahora;
  const pedir = (metodo: 'GET' | 'POST', url: string, payload?: unknown, cookie = sesion) =>
    app.inject({ method: metodo, url, cookies: { od_sesion: cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
  const consultar = async (trabajo: string) => (await pedir('GET', `/api/proyectos/nuevo/${trabajo}`)).json().datos;
  const hastaQue = async (trabajo: string, paso: string) => {
    await vi.waitFor(async () => expect((await consultar(trabajo)).paso).toBe(paso), { timeout: 4000 });
    return consultar(trabajo);
  };

  beforeEach(async () => {
    db = abrirDb(':memory:');
    Object.values(cliente).forEach((f) => f.mockReset());
    cargaCompleta.mockClear();
    creados.clear();
    [30, 31].forEach((id) => creados.add(id));
    reloj = ahora;
    app = await crearApp({
      config, db, crearCliente: () => cliente as unknown as ClienteOp, ahora: () => reloj,
      sync: { ...syncFalso(), cargaCompleta },
    });
    const token = cifrar('token', config.claveCifrado);
    for (const [id, login] of [[9, 'ana'], [10, 'beto']] as const) {
      db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (?, ?, ?, 'h', ?, 0, ?)")
        .run(id, login, login, token, ahora.toISOString());
      for (const p of [11, 17, 18]) db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (?, ?)').run(id, p);
    }
    sesion = crearSesion(db, 9, ahora);
    sesionAjena = crearSesion(db, 10, ahora);
    crearCache(db, () => ahora).guardarCatalogo(CATALOGO);
    cliente.puedeCrearProyectos.mockResolvedValue(true);
    cliente.capacidades.mockImplementation(async (_u: number, p: number) => ({ ...CAPS, copiarProyecto: p === 17 }));
    cliente.unionesEntre.mockResolvedValue([]);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    db.close();
  });

  it('opciones: vacío si puede crear, y solo las plantillas que puede copiar', async () => {
    const res = await pedir('GET', '/api/proyectos/nuevo');
    expect(res.json().datos).toEqual({ vacio: true, plantillas: [{ id: 17, nombre: 'Proyectos Template' }] });
  });

  it('opciones: respeta las plantillas marcadas y desmarcadas a mano en Ajustes', async () => {
    guardarPlantilla(db, 11, true);
    guardarPlantilla(db, 17, false);
    cliente.capacidades.mockResolvedValue({ ...CAPS, copiarProyecto: true });
    const res = await pedir('GET', '/api/proyectos/nuevo');
    expect(res.json().datos.plantillas).toEqual([{ id: 11, nombre: 'Portal' }, { id: 18, nombre: 'Otra plantilla' }]);
    const desmarcada = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'X', plantillaId: 17 });
    expect(desmarcada.statusCode).toBe(403);
    cliente.crearProyecto.mockResolvedValue(proyecto(30, 'Y'));
    cliente.copiarProyecto.mockResolvedValue('job');
    cliente.estadoCopia.mockResolvedValue({ estado: 'listo', proyectoId: 31, errores: [] });
    const manual = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Y', plantillaId: 11 });
    expect(manual.statusCode).toBe(200);
  });

  it('opciones: sin permisos no hay nada', async () => {
    cliente.puedeCrearProyectos.mockResolvedValue(false);
    cliente.capacidades.mockResolvedValue({ ...CAPS, copiarProyecto: false });
    const res = await pedir('GET', '/api/proyectos/nuevo');
    expect(res.json().datos).toEqual({ vacio: false, plantillas: [] });
  });

  it('vacío: crea y queda listo', async () => {
    cliente.crearProyecto.mockResolvedValue(proyecto(30, 'Nuevo'));
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: '  Nuevo ', plantillaId: null });
    expect(res.statusCode).toBe(200);
    const final = await hastaQue(res.json().datos.trabajo, 'listo');
    expect(final).toEqual({ paso: 'listo', proyectoId: 30, noCopiado: [], mensaje: null });
    expect(cliente.crearProyecto).toHaveBeenCalledWith('Nuevo');
    expect(cargaCompleta).toHaveBeenCalledWith(9);
  });

  it('desde la plantilla: copia, borra la unión cruzada y queda listo', async () => {
    cliente.copiarProyecto.mockResolvedValue('job-1');
    cliente.estadoCopia
      .mockResolvedValueOnce({ estado: 'en-curso', proyectoId: null, errores: [] })
      .mockResolvedValue({ estado: 'listo', proyectoId: 31, errores: ['No se copiaron los adjuntos'] });
    cliente.unionesEntre.mockResolvedValue([{ id: 500, sucesoraId: 1, predecesoraId: 2, lag: 0 }]);
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Del modelo', plantillaId: 17 });
    expect(res.statusCode).toBe(200);
    const trabajo = res.json().datos.trabajo as string;
    const final = await hastaQue(trabajo, 'listo');
    expect(final).toEqual({ paso: 'listo', proyectoId: 31, noCopiado: ['No se copiaron los adjuntos'], mensaje: null });
    expect(cliente.copiarProyecto).toHaveBeenCalledWith(17, 'Del modelo');
    expect(cliente.unionesEntre).toHaveBeenCalledWith(17, 31);
    expect(cliente.borrarDependencia).toHaveBeenCalledWith(500);
    expect(cargaCompleta).toHaveBeenCalledWith(9);
  });

  it('job en failure: paso fallo con mensaje', async () => {
    cliente.copiarProyecto.mockResolvedValue('job-1');
    cliente.estadoCopia.mockResolvedValue({ estado: 'fallo', proyectoId: null, errores: ['Falta el permiso', 'Otro error'] });
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Del modelo', plantillaId: 17 });
    const final = await hastaQue(res.json().datos.trabajo, 'fallo');
    expect(final.mensaje).toBe('Falta el permiso. Otro error');
    expect(final.proyectoId).toBeNull();
    expect(cliente.borrarDependencia).not.toHaveBeenCalled();
  });

  it('un error al arrancar la copia es un fallo, no un trabajo colgado', async () => {
    cliente.copiarProyecto.mockRejectedValue(new ErrorOp('prohibido', 'x', 403));
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Del modelo', plantillaId: 17 });
    const final = await hastaQue(res.json().datos.trabajo, 'fallo');
    expect(final.mensaje).toBe('No tenés permiso para hacer eso en OpenProject');
  });

  it('más de 120 s: fallo con «La copia tarda demasiado; fijate en Proyectos si quedó creada»', async () => {
    cliente.copiarProyecto.mockResolvedValue('job-1');
    // Cada consulta tarda 40 s de reloj: el plazo es de tiempo, no de cantidad de consultas.
    cliente.estadoCopia.mockImplementation(async () => {
      reloj = new Date(reloj.getTime() + 40_000);
      return { estado: 'en-curso', proyectoId: null, errores: [] };
    });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Lenta', plantillaId: 17 });
    const trabajo = res.json().datos.trabajo as string;
    expect((await consultar(trabajo)).paso).toBe('copiando');
    await vi.advanceTimersByTimeAsync(10_000);
    const final = await consultar(trabajo);
    expect(final.paso).toBe('fallo');
    expect(final.mensaje).toBe('La copia tarda demasiado; fijate en Proyectos si quedó creada');
    expect(cliente.estadoCopia).toHaveBeenCalledTimes(3);
    expect(cargaCompleta).toHaveBeenCalledWith(9);
  });

  it('un error pasajero de red al consultar la copia no corta el seguimiento', async () => {
    cliente.copiarProyecto.mockResolvedValue('job-1');
    cliente.estadoCopia
      .mockRejectedValueOnce(new ErrorOp('red', 'x'))
      .mockRejectedValueOnce(new ErrorOp('incierto', 'x'))
      .mockResolvedValue({ estado: 'listo', proyectoId: 31, errores: [] });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Del modelo', plantillaId: 17 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await consultar(res.json().datos.trabajo)).toMatchObject({ paso: 'listo', proyectoId: 31 });
  });

  it('un error que no es pasajero al consultar la copia es un fallo que avisa que puede haber quedado creada, y recarga', async () => {
    cliente.copiarProyecto.mockResolvedValue('job-1');
    cliente.estadoCopia.mockRejectedValue(new ErrorOp('prohibido', 'x', 403));
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Del modelo', plantillaId: 17 });
    const final = await hastaQue(res.json().datos.trabajo, 'fallo');
    expect(final.proyectoId).toBeNull();
    expect(final.mensaje).toContain('puede haber quedado creada');
    expect(cargaCompleta).toHaveBeenCalledWith(9);
  });

  it('un nombre que la misma persona ya está creando da el mismo 400; al terminar se puede volver a usar', async () => {
    let soltar: (p: unknown) => void = () => {};
    cliente.crearProyecto.mockReturnValue(new Promise((resolver) => { soltar = resolver; }));
    const primera = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Doble', plantillaId: null });
    expect(primera.statusCode).toBe(200);
    const segunda = await pedir('POST', '/api/proyectos/nuevo', { nombre: ' DOBLE ', plantillaId: null });
    expect(segunda.statusCode).toBe(400);
    expect(segunda.json().mensaje).toBe('Ya hay un proyecto que se llama «DOBLE»');
    expect(cliente.crearProyecto).toHaveBeenCalledTimes(1);
    soltar(proyecto(30, 'Doble'));
    await hastaQue(primera.json().datos.trabajo, 'listo');
    cliente.crearProyecto.mockRejectedValue(new ErrorOp('prohibido', 'x', 403));
    const tercera = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Doble', plantillaId: null });
    // El catálogo no tiene el proyecto nuevo (la carga es simulada): la reserva se liberó y el pedido pasa.
    expect(tercera.statusCode).toBe(200);
  });

  it('si el proyecto no aparece entre los de la persona tras la carga, no se ofrece abrirlo', async () => {
    creados.clear();
    cliente.crearProyecto.mockResolvedValue(proyecto(30, 'Nuevo'));
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Nuevo', plantillaId: null });
    const final = await hastaQue(res.json().datos.trabajo, 'fallo');
    expect(final.proyectoId).toBeNull();
    expect(final.mensaje).toContain('todavía no lo ve');
  });

  it('si falla el borrado de la unión, dice qué proyecto quedó', async () => {
    cliente.copiarProyecto.mockResolvedValue('job-1');
    cliente.estadoCopia.mockResolvedValue({ estado: 'listo', proyectoId: 31, errores: [] });
    cliente.unionesEntre.mockRejectedValue(new ErrorOp('red', 'x'));
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Del modelo', plantillaId: 17 });
    const final = await hastaQue(res.json().datos.trabajo, 'fallo');
    expect(final.proyectoId).toBe(31);
    expect(final.mensaje).toContain('se creó');
    // Con el proyecto ya creado se recarga, así «Abrir el proyecto» lo encuentra.
    expect(cargaCompleta).toHaveBeenCalledWith(9);
    expect(db.prepare('select 1 from usuario_proyectos where usuario_id = 9 and proyecto_id = 31').get()).toBeDefined();
  });

  it('otra persona no ve el trabajo (404)', async () => {
    cliente.crearProyecto.mockResolvedValue(proyecto(30, 'Nuevo'));
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Nuevo', plantillaId: null });
    const trabajo = res.json().datos.trabajo as string;
    const ajeno = await pedir('GET', `/api/proyectos/nuevo/${trabajo}`, undefined, sesionAjena);
    expect(ajeno.statusCode).toBe(404);
    expect((await pedir('GET', '/api/proyectos/nuevo/inexistente')).statusCode).toBe(404);
  });

  it('nombre repetido: validación, sin llamar a OpenProject', async () => {
    const res = await pedir('POST', '/api/proyectos/nuevo', { nombre: '  portal ', plantillaId: null });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, codigo: 'validacion', mensaje: 'Ya hay un proyecto que se llama «portal»' });
    const copia = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'PROYECTOS TEMPLATE', plantillaId: 17 });
    expect(copia.statusCode).toBe(400);
    expect(cliente.crearProyecto).not.toHaveBeenCalled();
    expect(cliente.copiarProyecto).not.toHaveBeenCalled();
  });

  it('sin permiso para crear o copiar: 403 y no arranca nada', async () => {
    cliente.puedeCrearProyectos.mockResolvedValue(false);
    const vacio = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Nuevo', plantillaId: null });
    expect(vacio.statusCode).toBe(403);
    const otra = await pedir('POST', '/api/proyectos/nuevo', { nombre: 'Nuevo', plantillaId: 18 });
    expect(otra.statusCode).toBe(403);
    expect(cliente.crearProyecto).not.toHaveBeenCalled();
    expect(cliente.copiarProyecto).not.toHaveBeenCalled();
  });

  it('cuerpo inválido: 400', async () => {
    expect((await pedir('POST', '/api/proyectos/nuevo', { nombre: '', plantillaId: null })).statusCode).toBe(400);
    expect((await pedir('POST', '/api/proyectos/nuevo', { nombre: 'x' })).statusCode).toBe(400);
  });
});
