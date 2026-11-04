import type { Database } from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { exito, falla, type CodigoError } from '../../compartido/api.js';
import type { DepsApp } from '../app.js';
import { responderTokenVencido } from '../errores.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { cifrar } from '../seguridad/cifrado.js';
import { hashear, verificar } from '../seguridad/contrasenas.js';
import { leerYo } from '../cuenta/yo.js';
import { descartarIntento, estaBloqueado, registrarIntento } from './intentos.js';
import { borrarSesion, borrarSesionesDe, buscarSesion, crearSesion, DURACION_SESION_MS, type UsuarioSesion } from './sesiones.js';

export const COOKIE_SESION = 'od_sesion';
const MSG_CREDENCIALES = 'Usuario o contraseña incorrectos';

declare module 'fastify' {
  interface FastifyRequest {
    usuario: Pick<UsuarioSesion, 'id' | 'login' | 'nombre'> | null;
  }
}

const esquemaToken = z.string().min(1).max(200);
const esquemaRegistro = z.strictObject({ token: esquemaToken, contrasena: z.string().min(8).max(200) });
const esquemaIngreso = z.strictObject({ login: z.string().min(1).max(200), contrasena: z.string().min(1).max(200) });
const esquemaRenovar = z.strictObject({ token: esquemaToken });

type DepsAuth = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'sync'>;

function responder(res: FastifyReply, estado: number, codigo: CodigoError, mensaje: string): FastifyReply {
  return res.code(estado).send(falla(codigo, mensaje));
}

// Solo los errores de yo() dicen algo sobre el token; lo demás es falla nuestra o de la red.
function errorDeValidacionDeToken(res: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ErrorOp) {
    if (error.tipo === 'no-autorizado') return responder(res, 400, 'token-invalido', 'OpenProject no aceptó ese token');
    if (error.tipo === 'red') return responder(res, 503, 'sin-conexion', 'No se pudo conectar con OpenProject');
  }
  throw error;
}

function ponerCookie(res: FastifyReply, idCrudo: string): void {
  res.setCookie(COOKIE_SESION, idCrudo, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: DURACION_SESION_MS / 1000,
  });
}

// Hash descartable: verificar contra él cuando el login no existe iguala el tiempo de respuesta.
let hashSenuelo: Promise<string> | null = null;
function senuelo(): Promise<string> {
  hashSenuelo ??= hashear('senuelo-sin-uso').catch((error: unknown) => {
    hashSenuelo = null;
    throw error;
  });
  return hashSenuelo;
}

/** Cabecera con la que el navegador marca un pedido automático que no cuenta como actividad. */
export const CABECERA_FONDO = 'x-opendash-fondo';

export function requerirSesion(
  deps: Pick<DepsApp, 'db' | 'ahora'>,
  opciones: { permitirTokenVencido?: boolean } = {},
): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, res: FastifyReply) => {
    const ahora = deps.ahora();
    const sesion = buscarSesion(deps.db, req.cookies[COOKIE_SESION], ahora);
    if (sesion === null) {
      return responder(res, 401, 'no-sesion', 'Tenés que iniciar sesión');
    }
    if (sesion.tokenVencido && opciones.permitirTokenVencido !== true) {
      return responderTokenVencido(res);
    }
    // Los pedidos de fondo (el vigilante de reuniones) no son actividad de la persona.
    if (req.headers[CABECERA_FONDO] !== '1') {
      deps.db.prepare('update usuarios set ultima_actividad = ? where id = ?').run(ahora.toISOString(), sesion.id);
    }
    req.usuario = { id: sesion.id, login: sesion.login, nombre: sesion.nombre };
  };
}

function guardarUsuario(db: Database, p: { id: number; login: string; nombre: string }, hash: string, tokenCifrado: string, visibles: number[] | null, ahora: Date): void {
  db.transaction(() => {
    // Si OpenProject cambió el login de esta persona, el registro viejo con ese login ya no es suyo.
    db.prepare('delete from usuarios where login = ? collate nocase and id <> ?').run(p.login, p.id);
    db.prepare(
      `insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado)
       values (@id, @login, @nombre, @hash, @token, 0, @creado)
       on conflict(id) do update set login = @login, nombre = @nombre, hash = @hash, token_cifrado = @token, token_vencido = 0`,
    ).run({ ...p, hash, token: tokenCifrado, creado: ahora.toISOString() });
    // Quien «olvidó» la contraseña pierde las sesiones abiertas con la anterior.
    borrarSesionesDe(db, p.id);
    // Falla cerrado: nunca se agregan proyectos acá (ver uno no es poder leer sus tareas); eso lo hace la
    // carga completa. En un re-registro solo se quitan los que dejaron de ser visibles.
    if (visibles !== null) {
      const borrar = db.prepare('delete from usuario_proyectos where usuario_id = ? and proyecto_id = ?');
      const propios = db.prepare('select proyecto_id from usuario_proyectos where usuario_id = ?').pluck().all(p.id) as number[];
      for (const id of propios) if (!visibles.includes(id)) borrar.run(p.id, id);
    }
  })();
}

const VIGENCIA_CARGA_MS = 60 * 60_000;

// ¿Hace falta una carga completa? Falta la marca o tiene más de 60 minutos.
function cargaCompletaVencida(db: Database, usuarioId: number, ahora: Date): boolean {
  const ultima = db.prepare('select valor from estado_sync where clave = ?').pluck().get(`ultimo_completo:${usuarioId}`) as string | undefined;
  return ultima === undefined || ahora.getTime() - Date.parse(ultima) > VIGENCIA_CARGA_MS;
}

export function registrarRutasAuth(app: FastifyInstance, deps: DepsAuth): void {
  // Se calcula de entrada; si falla, el próximo ingreso lo reintenta.
  senuelo().catch(() => {});
  const invalida = (res: FastifyReply) => responder(res, 400, 'validacion', 'Los datos enviados no son válidos');

  app.post('/api/auth/registro', async (req, res) => {
    const cuerpo = esquemaRegistro.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const { token, contrasena } = cuerpo.data;
    const cliente: ClienteOp = deps.crearCliente(token);
    let persona;
    try {
      persona = await cliente.yo();
    } catch (error) {
      return errorDeValidacionDeToken(res, error);
    }
    // Si falla la lista de proyectos el registro sigue y las filas existentes quedan como estaban.
    let proyectos: number[] | null = null;
    try {
      proyectos = (await cliente.proyectos()).map((p) => p.id);
    } catch (error) {
      app.log.error({ motivo: error instanceof Error ? error.message : 'desconocido' }, 'no se pudieron leer los proyectos al registrar');
    }
    const ahora = deps.ahora();
    guardarUsuario(
      deps.db,
      { id: persona.id, login: persona.login, nombre: persona.nombre },
      await hashear(contrasena),
      cifrar(token, deps.config.claveCifrado, `usuario:${persona.id}`),
      proyectos,
      ahora,
    );
    // La carga inicial no se espera: si falla, se registra sin datos sensibles y el registro sigue.
    void Promise.resolve()
      .then(() => deps.sync.cargaCompleta(persona.id))
      .catch((error: unknown) => {
        app.log.error({ motivo: error instanceof Error ? error.message : 'desconocido' }, 'falló la carga completa tras el registro');
      });
    ponerCookie(res, crearSesion(deps.db, persona.id, ahora));
    return exito({ id: persona.id, login: persona.login, nombre: persona.nombre });
  });

  app.post('/api/auth/ingreso', async (req, res) => {
    const cuerpo = esquemaIngreso.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const { login, contrasena } = cuerpo.data;
    const ahora = deps.ahora();
    if (estaBloqueado(deps.db, login, req.ip, ahora)) {
      return responder(res, 429, 'demasiados-intentos', 'Demasiados intentos, probá de nuevo en unos minutos');
    }
    const intento = registrarIntento(deps.db, login, req.ip, ahora);
    const fila = deps.db.prepare('select id, hash from usuarios where login = ? collate nocase').get(login.trim()) as { id: number; hash: string } | undefined;
    const correcto = await verificar(contrasena, fila?.hash ?? (await senuelo()));
    if (fila === undefined || !correcto) {
      return responder(res, 401, 'credenciales', MSG_CREDENCIALES);
    }
    descartarIntento(deps.db, intento);
    ponerCookie(res, crearSesion(deps.db, fila.id, ahora));
    if (cargaCompletaVencida(deps.db, fila.id, ahora)) {
      void Promise.resolve()
        .then(() => deps.sync.cargaCompleta(fila.id))
        .catch((error: unknown) => {
          app.log.error({ motivo: error instanceof Error ? error.message : 'desconocido' }, 'falló la carga completa tras el ingreso');
        });
    }
    return exito({ id: fila.id });
  });

  app.post('/api/auth/salir', async (req, res) => {
    const idCrudo = req.cookies[COOKIE_SESION];
    if (idCrudo !== undefined) borrarSesion(deps.db, idCrudo);
    res.clearCookie(COOKIE_SESION, { path: '/' });
    return exito({});
  });

  app.get('/api/auth/yo', { preHandler: requerirSesion(deps) }, async (req) => {
    return exito(leerYo(deps.db, req.usuario!.id));
  });

  app.put('/api/auth/token', { preHandler: requerirSesion(deps, { permitirTokenVencido: true }) }, async (req, res) => {
    const cuerpo = esquemaRenovar.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const usuario = req.usuario!;
    try {
      const persona = await deps.crearCliente(cuerpo.data.token).yo();
      if (persona.id !== usuario.id) {
        return responder(res, 400, 'token-invalido', 'Ese token pertenece a otra persona');
      }
    } catch (error) {
      return errorDeValidacionDeToken(res, error);
    }
    deps.db
      .prepare('update usuarios set token_cifrado = ?, token_vencido = 0 where id = ?')
      .run(cifrar(cuerpo.data.token, deps.config.claveCifrado, `usuario:${usuario.id}`), usuario.id);
    return exito({});
  });
}
