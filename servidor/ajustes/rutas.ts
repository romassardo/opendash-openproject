import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import { ICONOS_PROYECTO, TONOS } from '../../compartido/estilos.js';
import { NOMBRE_COLUMNA } from '../../compartido/columnas.js';
import type { Columna, MapeoTablero } from '../../compartido/tipos.js';
import type { DepsApp } from '../app.js';
import { requerirSesion } from '../auth/rutas.js';
import { PATRON_ID } from '../identificadores.js';
import { crearCache } from '../sync/cache.js';
import { guardarEstilo, guardarPlantilla, guardarHoras, guardarMetricas, guardarReceptores, guardarTablero, leerAjustes, leerReceptores } from './repositorio.js';

type DepsAjustes = Pick<DepsApp, 'db' | 'ahora' | 'sync'>;

const MSG_INVALIDA = 'Los datos enviados no son válidos';
const MSG_SIN_CATALOGO = 'Todavía se están cargando los datos de OpenProject; probá en un momento.';
const COLUMNAS: Columna[] = ['nuevo', 'curso', 'pausa', 'cerrado'];

const esquemaEstilo = z.strictObject({ color: z.enum(TONOS), icono: z.enum(ICONOS_PROYECTO) });
const esquemaPlantilla = z.strictObject({ plantilla: z.boolean() });
const horas = z.number().min(0.25).max(80);
const esquemaMetricas = z.strictObject({ horasPorDefecto: horas, horasSemanaLargas: horas, capacidadPorDefecto: horas, restarReuniones: z.boolean().default(false) });
const esquemaHoras = z.strictObject({ jornadaHoras: z.number().min(1).max(12) });
const idEstado = z.number().int().positive().nullable();
const esquemaAvisos = z.strictObject({ receptores: z.array(z.number().int().positive()).max(200) });
const esquemaTablero = z.strictObject({ nuevo: idEstado, curso: idEstado, pausa: idEstado, cerrado: idEstado });

export function registrarRutasAjustes(app: FastifyInstance, deps: DepsAjustes): void {
  const cache = crearCache(deps.db, deps.ahora);
  const sesion = requerirSesion(deps);
  const sesionAvisos = requerirSesion(deps, { permitirTokenVencido: true });
  const desactualizado = (): boolean => deps.sync.estado().desactualizado;
  const invalida = (res: FastifyReply, mensaje = MSG_INVALIDA): FastifyReply => res.code(400).send(falla('validacion', mensaje));

  app.get('/api/ajustes', { preHandler: sesion }, async (req) =>
    exito(leerAjustes(deps.db, cache.proyectosDe(req.usuario!.id), cache.catalogo()?.proyectos.map((p) => p.id)), desactualizado()));

  app.put('/api/proyectos/:id/estilo', { preHandler: sesion }, async (req, res) => {
    const crudo = (req.params as { id: string }).id;
    if (!PATRON_ID.test(crudo)) return invalida(res, 'El identificador no es válido');
    const cuerpo = esquemaEstilo.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const id = Number(crudo);
    // Un proyecto que esta persona no ve responde igual que uno que no existe.
    if (!cache.proyectosDe(req.usuario!.id).includes(id)) return res.code(404).send(falla('no-encontrado', 'No existe ese proyecto'));
    guardarEstilo(deps.db, id, cuerpo.data);
    return exito(cuerpo.data);
  });

  app.put('/api/proyectos/:id/plantilla', { preHandler: sesion }, async (req, res) => {
    const crudo = (req.params as { id: string }).id;
    if (!PATRON_ID.test(crudo)) return invalida(res, 'El identificador no es válido');
    const cuerpo = esquemaPlantilla.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const id = Number(crudo);
    if (!cache.proyectosDe(req.usuario!.id).includes(id)) return res.code(404).send(falla('no-encontrado', 'No existe ese proyecto'));
    guardarPlantilla(deps.db, id, cuerpo.data.plantilla);
    return exito({ plantilla: cuerpo.data.plantilla });
  });

  app.put('/api/ajustes/metricas', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaMetricas.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    guardarMetricas(deps.db, cuerpo.data);
    return exito(cuerpo.data);
  });

  app.put('/api/ajustes/horas', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaHoras.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    guardarHoras(deps.db, cuerpo.data);
    return exito(cuerpo.data);
  });

  app.put('/api/ajustes/avisos', { preHandler: sesionAvisos }, async (req, res) => {
    const cuerpo = esquemaAvisos.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    // Con una lista ya elegida, solo la cambian quienes están en ella; con la lista vacía la completa cualquiera.
    const actuales = leerReceptores(deps.db);
    if (actuales.length > 0 && !actuales.includes(req.usuario!.id)) {
      return res.code(403).send(falla('prohibido', 'Solo quienes reciben los avisos pueden cambiar esta lista.'));
    }
    const receptores = [...new Set(cuerpo.data.receptores)];
    const registrados = new Set(deps.db.prepare('select id from usuarios').pluck().all() as number[]);
    if (!receptores.every((id) => registrados.has(id))) return invalida(res, 'Solo se puede elegir a personas que ya entraron a OpenDash.');
    guardarReceptores(deps.db, receptores);
    return exito({ receptores });
  });

  app.put('/api/ajustes/tablero', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaTablero.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const catalogo = cache.catalogo();
    if (catalogo === null) return res.code(503).send(falla('sin-conexion', MSG_SIN_CATALOGO));
    const motivo = motivoInvalido(cuerpo.data, catalogo.estados);
    if (motivo !== null) return invalida(res, motivo);
    guardarTablero(deps.db, cuerpo.data);
    return exito(cuerpo.data);
  });
}

/** Por qué el mapeo no sirve, o `null` si está bien. */
function motivoInvalido(mapeo: MapeoTablero, estados: { id: number; cerrado: boolean }[]): string | null {
  const vistos = new Set<number>();
  for (const columna of COLUMNAS) {
    const id = mapeo[columna];
    if (id === null) continue;
    const estado = estados.find((e) => e.id === id);
    if (estado === undefined) return `El estado elegido para «${NOMBRE_COLUMNA[columna]}» no existe en OpenProject`;
    if (columna === 'cerrado' && !estado.cerrado) return 'El estado elegido para «Cerrado» tiene que ser un estado cerrado';
    if (columna !== 'cerrado' && estado.cerrado) return `El estado elegido para «${NOMBRE_COLUMNA[columna]}» tiene que ser un estado abierto`;
    if (vistos.has(id)) return 'No se puede repetir un estado en dos columnas';
    vistos.add(id);
  }
  return null;
}
