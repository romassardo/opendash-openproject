import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import estaticos from '@fastify/static';
import type { Database } from 'better-sqlite3';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply } from 'fastify';
import { exito, falla } from '../compartido/api.js';
import { registrarRutasAjustes } from './ajustes/rutas.js';
import { registrarRutasAvisos } from './avisos/rutas.js';
import { registrarRutasLinea } from './linea/rutas.js';
import { registrarRutasAuth } from './auth/rutas.js';
import { registrarRutasCalendario } from './calendario/rutas.js';
import { crearServicioCalendario, type ServicioCalendario } from './calendario/servicio.js';
import { registrarRutasCuenta } from './cuenta/rutas.js';
import { registrarRutasEquipo } from './equipo/rutas.js';
import { registrarRutasFeriados } from './feriados/rutas.js';
import type { ServicioFeriados } from './feriados/servicio.js';
import { registrarRutasHoras } from './horas/rutas.js';
import { registrarRutasNotificaciones } from './notificaciones/rutas.js';
import { registrarRutasPersonas } from './personas/rutas.js';
import { registrarRutasMiembros } from './proyectos/miembros.js';
import { registrarRutasNuevoProyecto } from './proyectos/nuevo.js';
import { registrarRutasVersiones } from './proyectos/versiones.js';
import { registrarRutasAdjuntos } from './tareas/adjuntos.js';
import { registrarRutasTareas } from './tareas/rutas.js';
import { registrarRutasVacaciones } from './vacaciones/rutas.js';
import { registrarCabeceras } from './seguridad/cabeceras.js';
import { registrarChequeoOrigen } from './seguridad/origen.js';
import type { Config } from './config.js';
import type { ClienteOp } from './openproject/cliente.js';
import type { ServicioSync } from './sync/servicio.js';

export const MENSAJE_INTERNO = 'Algo salió mal en el servidor';

export interface DepsApp {
  config: Config;
  db: Database;
  crearCliente: (token: string) => ClienteOp;
  ahora: () => Date;
  sync: ServicioSync;
  /** Sin él, crearApp arma uno con la lectura real, sin iniciarlo (la ronda periódica la arranca main). */
  calendario?: ServicioCalendario;
  /** Lo arranca y detiene main; las rutas solo leen la base, así que crearApp no arma uno (sin timers ni red). */
  feriados?: ServicioFeriados;
  /** Registro del servidor; sin él, Fastify no registra nada. */
  registro?: FastifyBaseLogger;
  /** Carpeta de la web compilada; por defecto `dist/web` junto al servidor. */
  rutaWeb?: string;
}

const CACHE_INDEX = 'no-cache';
const CACHE_ASSETS = 'public, max-age=31536000, immutable';

// Compilado queda en dist/servidor/servidor/ (la web, en dist/web); con tsx, en servidor/.
function rutaWebPorDefecto(): string {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const dist = resolve(aqui, '../..');
  return basename(dist) === 'dist' ? join(dist, 'web') : resolve(aqui, '../dist/web');
}

export async function crearApp(deps: DepsApp): Promise<FastifyInstance> {
  const app = deps.registro === undefined ? Fastify({ logger: false }) : Fastify({ loggerInstance: deps.registro });
  await app.register(cookie);
  app.decorateRequest('usuario', null);
  registrarCabeceras(app);
  registrarChequeoOrigen(app);

  // Cuerpos mal formados o demasiado grandes (4xx de Fastify) salen con el sobre de la API.
  app.setErrorHandler((error, req, res) => {
    const estado = (error as { statusCode?: number }).statusCode ?? 500;
    if (estado >= 400 && estado < 500) {
      return res.code(estado).send(falla('validacion', 'La solicitud no es válida'));
    }
    req.log.error({ motivo: error instanceof Error ? error.message : 'desconocido' }, 'error no controlado');
    return res.code(500).send(falla('interno', MENSAJE_INTERNO));
  });

  app.get('/api/salud', async () => exito({ estado: 'ok' }));
  registrarRutasAuth(app, deps);
  registrarRutasTareas(app, deps);
  registrarRutasAdjuntos(app, deps);
  registrarRutasVersiones(app, deps);
  registrarRutasMiembros(app, deps);
  registrarRutasNuevoProyecto(app, deps);
  registrarRutasNotificaciones(app, deps);
  registrarRutasPersonas(app, deps);
  const calendario = deps.calendario ?? crearServicioCalendario({ db: deps.db, config: deps.config, ahora: deps.ahora });
  const depsConCalendario = { ...deps, calendario };
  registrarRutasCuenta(app, depsConCalendario);
  registrarRutasCalendario(app, depsConCalendario);
  registrarRutasVacaciones(app, deps);
  registrarRutasAjustes(app, deps);
  registrarRutasAvisos(app, deps);
  registrarRutasLinea(app, deps);
  registrarRutasHoras(app, deps);
  registrarRutasEquipo(app, deps);
  registrarRutasFeriados(app, deps);

  await registrarWeb(app, deps);
  return app;
}

async function registrarWeb(app: FastifyInstance, deps: DepsApp): Promise<void> {
  const noEncontrado = (res: FastifyReply) => res.code(404).send(falla('no-encontrado', 'No existe ese recurso'));

  if (!deps.config.produccion) {
    app.setNotFoundHandler((_req, res) => noEncontrado(res));
    return;
  }

  const raiz = deps.rutaWeb ?? rutaWebPorDefecto();
  const rutaIndex = join(raiz, 'index.html');
  if (!existsSync(rutaIndex)) {
    throw new Error('Falta la compilación de la web: corré npm run build');
  }
  const indexHtml = readFileSync(rutaIndex, 'utf-8');
  await app.register(estaticos, {
    root: raiz,
    cacheControl: false,
    setHeaders: (res, ruta) => {
      const esAsset = relative(raiz, ruta).split(sep)[0] === 'assets';
      res.header('Cache-Control', esAsset ? CACHE_ASSETS : CACHE_INDEX);
    },
  });

  // Rutas del navegador (react-router): cualquier GET que no sea de la API recibe index.html.
  app.setNotFoundHandler((req, res) => {
    const camino = req.url.split('?')[0] ?? '';
    const esApi = camino === '/api' || camino.startsWith('/api/');
    const ultimo = camino.split('/').pop() ?? '';
    const pareceArchivo = camino.startsWith('/assets/') || ultimo.includes('.');
    const esNavegacion = req.method === 'GET' || req.method === 'HEAD';
    if (!esNavegacion || esApi || pareceArchivo) return noEncontrado(res);
    return res.code(200).header('Cache-Control', CACHE_INDEX).type('text/html; charset=utf-8').send(indexHtml);
  });
}
