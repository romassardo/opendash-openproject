import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import type { DepsApp } from '../app.js';
import { clientePara } from '../auth/clientes.js';
import { leerPlantillas } from '../ajustes/repositorio.js';
import { requerirSesion } from '../auth/rutas.js';
import { aRespuestaError, responderError, responderTokenVencido } from '../errores.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { crearCache } from '../sync/cache.js';
import { plantillasVisibles } from './plantillas.js';

type DepsNuevo = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'registro' | 'sync'>;

export type PasoNuevo = 'creando' | 'copiando' | 'listo' | 'fallo';
export interface EstadoNuevo { paso: PasoNuevo; proyectoId: number | null; noCopiado: string[]; mensaje: string | null }
export interface OpcionesNuevo { vacio: boolean; plantillas: { id: number; nombre: string }[] }

const ESPERA_ENTRE_CONSULTAS_MS = 1000;
/** Plazo para que termine la copia, medido con el reloj: cada consulta puede tardar hasta 30 s. */
const PLAZO_COPIA_MS = 120_000;
const VIDA_TRABAJO_MS = 10 * 60 * 1000;
const MSG_LENTA = 'La copia tarda demasiado; fijate en Proyectos si quedó creada';
const MSG_SIN_SEGUIMIENTO = 'Se perdió el seguimiento de la copia, pero puede haber quedado creada; fijate en Proyectos antes de volver a intentar';
const MSG_NO_APARECE = 'se creó, pero OpenDash todavía no lo ve; fijate en Proyectos en unos minutos';
const MSG_INTERNO = 'Algo salió mal en el servidor';

const esquemaNuevo = z.strictObject({
  nombre: z.string().trim().min(1).max(255),
  plantillaId: z.number().int().positive().nullable(),
});

interface Trabajo { usuarioId: number; vence: number; estado: EstadoNuevo }

const esperar = (ms: number): Promise<void> => new Promise((resolver) => { setTimeout(resolver, ms); });
const normalizar = (nombre: string): string => nombre.trim().toLowerCase();
const esPasajero = (e: unknown): boolean => e instanceof ErrorOp && (e.tipo === 'red' || e.tipo === 'incierto');

export function registrarRutasNuevoProyecto(app: FastifyInstance, deps: DepsNuevo): void {
  const cache = crearCache(deps.db, deps.ahora);
  const sesion = requerirSesion(deps);
  const trabajos = new Map<string, Trabajo>();
  /** Nombres que cada persona está creando ahora, para que un doble clic no cree dos proyectos. */
  const enCurso = new Map<number, Set<string>>();

  const reservar = (usuarioId: number, clave: string): boolean => {
    const nombres = enCurso.get(usuarioId) ?? new Set<string>();
    if (nombres.has(clave)) return false;
    enCurso.set(usuarioId, new Set([...nombres, clave]));
    return true;
  };
  const liberar = (usuarioId: number, clave: string): void => {
    const quedan = new Set([...(enCurso.get(usuarioId) ?? [])].filter((n) => n !== clave));
    if (quedan.size === 0) enCurso.delete(usuarioId);
    else enCurso.set(usuarioId, quedan);
  };

  const barrer = (): void => {
    const ahora = deps.ahora().getTime();
    for (const [id, t] of trabajos) if (t.vence <= ahora) trabajos.delete(id);
  };

  /** Plantillas que la persona ve, con la marca de plantilla de la tanda 2 (las de OpenProject, más las marcadas a mano). */
  const idsPlantillas = (usuarioId: number): number[] => {
    const visibles = new Set(cache.proyectosDe(usuarioId));
    return plantillasVisibles(cache.catalogo()?.plantillasOp ?? [], leerPlantillas(deps.db), visibles);
  };

  async function opciones(cliente: ClienteOp, usuarioId: number): Promise<OpcionesNuevo> {
    const nombres = new Map((cache.catalogo()?.proyectos ?? []).map((p) => [p.id, p.nombre] as const));
    const [vacio, permisos] = await Promise.all([
      cliente.puedeCrearProyectos(usuarioId),
      Promise.all(idsPlantillas(usuarioId).map(async (id) => ((await cliente.capacidades(usuarioId, id)).copiarProyecto ? id : null))),
    ]);
    const plantillas = permisos.filter((id): id is number => id !== null).map((id) => ({ id, nombre: nombres.get(id) ?? `Proyecto ${id}` }));
    return { vacio, plantillas };
  }

  function fijar(trabajo: Trabajo, cambios: Partial<EstadoNuevo>): void {
    trabajo.estado = { ...trabajo.estado, ...cambios };
  }

  function mensajeDe(e: unknown, usuarioId: number): string {
    if (!(e instanceof ErrorOp)) return MSG_INTERNO;
    const { cuerpo } = aRespuestaError(e, { db: deps.db, usuarioId });
    return cuerpo.ok ? MSG_INTERNO : cuerpo.mensaje;
  }

  /** Vuelve a leer lo que tiene OpenProject, para que el proyecto (y el control de nombre repetido) lo vea. Nunca rechaza. */
  async function recargar(usuarioId: number): Promise<void> {
    try {
      await deps.sync.cargaCompleta(usuarioId);
    } catch (fallo) {
      deps.registro?.warn({ motivo: fallo instanceof Error ? fallo.message : 'desconocido' }, 'no se pudo recargar tras crear un proyecto');
    }
  }

  /** Sigue el job de copia hasta que termine; un error pasajero de red no corta el seguimiento mientras dure el plazo. */
  async function esperarCopia(trabajo: Trabajo, cliente: ClienteOp, job: string): Promise<number | 'fallo'> {
    const limite = deps.ahora().getTime() + PLAZO_COPIA_MS;
    for (let intento = 0; ; intento++) {
      if (deps.ahora().getTime() >= limite) {
        fijar(trabajo, { paso: 'fallo', mensaje: MSG_LENTA });
        return 'fallo';
      }
      if (intento > 0) await esperar(ESPERA_ENTRE_CONSULTAS_MS);
      let copia;
      try {
        copia = await cliente.estadoCopia(job);
      } catch (e) {
        if (esPasajero(e)) continue;
        deps.registro?.error({ motivo: e instanceof Error ? e.message : 'desconocido' }, 'falló el seguimiento de la copia del proyecto');
        fijar(trabajo, { paso: 'fallo', mensaje: `${mensajeDe(e, trabajo.usuarioId)}. ${MSG_SIN_SEGUIMIENTO}` });
        return 'fallo';
      }
      if (copia.estado === 'fallo') {
        const motivo = copia.errores.length > 0 ? copia.errores.join('. ') : 'OpenProject no pudo copiar la plantilla';
        fijar(trabajo, { paso: 'fallo', proyectoId: copia.proyectoId, mensaje: copia.proyectoId === null ? motivo : `Quedó un proyecto a medias: ${motivo}` });
        return 'fallo';
      }
      if (copia.estado === 'listo') {
        if (copia.proyectoId === null) {
          fijar(trabajo, { paso: 'fallo', mensaje: 'OpenProject terminó la copia pero no dijo qué proyecto creó; fijate en Proyectos si quedó creada' });
          return 'fallo';
        }
        fijar(trabajo, { noCopiado: copia.errores });
        return copia.proyectoId;
      }
    }
  }

  async function ejecutar(trabajo: Trabajo, cliente: ClienteOp, nombre: string, plantillaId: number | null): Promise<void> {
    const { usuarioId } = trabajo;
    let proyectoId: number | null = null;
    let copiaIniciada = false;
    try {
      if (plantillaId === null) {
        proyectoId = (await cliente.crearProyecto(nombre)).id;
      } else {
        const job = await cliente.copiarProyecto(plantillaId, nombre);
        copiaIniciada = true;
        fijar(trabajo, { paso: 'copiando' });
        const resultado = await esperarCopia(trabajo, cliente, job);
        if (resultado === 'fallo') {
          // La copia sigue o quedó en OpenProject: se recarga para que el control de nombre repetido la vea.
          await recargar(usuarioId);
          return;
        }
        proyectoId = resultado;
        for (const union of await cliente.unionesEntre(plantillaId, proyectoId)) await cliente.borrarDependencia(union.id);
      }
      await recargar(usuarioId);
      if (!cache.proyectosDe(usuarioId).includes(proyectoId)) {
        fijar(trabajo, { paso: 'fallo', proyectoId: null, mensaje: `El proyecto «${nombre}» ${MSG_NO_APARECE}` });
        return;
      }
      fijar(trabajo, { paso: 'listo', proyectoId });
    } catch (e) {
      deps.registro?.error({ motivo: e instanceof Error ? e.message : 'desconocido' }, 'falló la creación del proyecto');
      const base = mensajeDe(e, usuarioId);
      // Con el proyecto ya creado se recarga antes de ofrecer «Abrir el proyecto», que lo busca en la caché.
      if (proyectoId !== null || copiaIniciada) await recargar(usuarioId);
      fijar(trabajo, {
        paso: 'fallo',
        proyectoId,
        mensaje: proyectoId !== null ? `El proyecto «${nombre}» se creó, pero no se terminó de preparar: ${base}`
          : copiaIniciada ? `${base}. ${MSG_SIN_SEGUIMIENTO}` : base,
      });
    } finally {
      liberar(usuarioId, normalizar(nombre));
    }
  }

  app.get('/api/proyectos/nuevo', { preHandler: sesion }, async (req, res) => {
    const usuarioId = req.usuario!.id;
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      return exito(await opciones(cliente, usuarioId));
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.post('/api/proyectos/nuevo', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaNuevo.safeParse(req.body);
    if (!cuerpo.success) return res.code(400).send(falla('validacion', 'La solicitud no es válida'));
    const { nombre, plantillaId } = cuerpo.data;
    const usuarioId = req.usuario!.id;
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    const visibles = new Set(cache.proyectosDe(usuarioId));
    const clave = normalizar(nombre);
    const repetido = (cache.catalogo()?.proyectos ?? []).some((p) => visibles.has(p.id) && normalizar(p.nombre) === clave);
    // Un nombre que esta misma persona ya está creando cuenta como repetido (doble clic).
    if (repetido || !reservar(usuarioId, clave)) return res.code(400).send(falla('validacion', `Ya hay un proyecto que se llama «${nombre}»`));
    try {
      const permitidas = await opciones(cliente, usuarioId);
      const puede = plantillaId === null ? permitidas.vacio : permitidas.plantillas.some((p) => p.id === plantillaId);
      if (!puede) {
        liberar(usuarioId, clave);
        return res.code(403).send(falla('prohibido', 'No tenés permiso para hacer eso en OpenProject'));
      }
    } catch (e) {
      liberar(usuarioId, clave);
      return responderError(res, e, { db: deps.db, usuarioId });
    }
    barrer();
    const id = randomUUID();
    const trabajo: Trabajo = {
      usuarioId,
      vence: deps.ahora().getTime() + VIDA_TRABAJO_MS,
      estado: { paso: 'creando', proyectoId: null, noCopiado: [], mensaje: null },
    };
    trabajos.set(id, trabajo);
    void ejecutar(trabajo, cliente, nombre, plantillaId);
    return exito({ trabajo: id });
  });

  app.get('/api/proyectos/nuevo/:trabajo', { preHandler: sesion }, async (req, res) => {
    barrer();
    const trabajo = trabajos.get((req.params as { trabajo: string }).trabajo);
    if (trabajo === undefined || trabajo.usuarioId !== req.usuario!.id) {
      return res.code(404).send(falla('no-encontrado', 'No encontramos ese trabajo'));
    }
    return exito(trabajo.estado);
  });
}
