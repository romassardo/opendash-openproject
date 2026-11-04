import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import type { Miembro, Persona, Rol } from '../../compartido/tipos.js';
import type { DepsApp } from '../app.js';
import { clientePara } from '../auth/clientes.js';
import { requerirSesion } from '../auth/rutas.js';
import { responderError, responderTokenVencido } from '../errores.js';
import { PATRON_ID } from '../identificadores.js';
import { ErrorOp } from '../openproject/errores.js';
import { crearCache } from '../sync/cache.js';

type DepsMiembros = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'registro' | 'sync'>;

/** Un miembro con lo que la pantalla necesita para dibujarlo. */
export interface MiembroDeProyecto extends Miembro {
  nombre: string;
  avatarUrl: string | null;
  /** Tareas abiertas del proyecto de las que es responsable. */
  tareasAbiertas: number;
}
export interface PermisosMiembros { agregar: boolean; cambiar: boolean; quitar: boolean }
export interface ListaMiembros { miembros: MiembroDeProyecto[]; roles: Rol[]; candidatos: Persona[]; puede: PermisosMiembros }

const MSG_INVALIDA = 'La solicitud no es válida';
/** Lo máximo que un cambio espera a releer los asignables; después responde y la lectura sigue sola. */
const ESPERA_ASIGNABLES_MS = 3000;

const esquemaAlta = z.strictObject({ personaId: z.number().int().positive(), rolId: z.number().int().positive() });
const esquemaRol = z.strictObject({ rolId: z.number().int().positive() });
const esquemaQuitar = z.strictObject({ pasarA: z.number().int().positive().nullable() });

export function registrarRutasMiembros(app: FastifyInstance, deps: DepsMiembros): void {
  const cache = crearCache(deps.db, deps.ahora);
  const sesion = requerirSesion(deps);
  const idDe = (crudo: string): number | null => (PATRON_ID.test(crudo) ? Number(crudo) : null);
  const invalida = falla('validacion', MSG_INVALIDA);
  const noEncontrado = falla('no-encontrado', 'No encontramos ese proyecto o ese miembro');

  const MSG_SIN_PERMISO = 'No tenés permiso para hacer eso en OpenProject';
  const abiertasDe = (proyectoId: number, personaId: number): number[] => {
    const cerrados = new Set((cache.catalogo()?.estados ?? []).filter((e) => e.cerrado).map((e) => e.id));
    return cache.tareas([proyectoId]).filter((t) => t.responsableId === personaId && !cerrados.has(t.estadoId)).map((t) => t.id);
  };

  async function releerAsignables(usuarioId: number, proyectoId: number): Promise<void> {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const espera = new Promise<void>((resolver) => { temporizador = setTimeout(resolver, ESPERA_ASIGNABLES_MS); temporizador.unref(); });
    // Si la lectura pierde la carrera y falla después, el rechazo no puede quedar sin manejar.
    const lectura = deps.sync.releerAsignables(usuarioId, proyectoId).catch((fallo: unknown) => {
      deps.registro?.warn({ motivo: fallo instanceof Error ? fallo.message : 'desconocido' }, 'no se pudieron releer los asignables');
    });
    try {
      await Promise.race([lectura, espera]);
    } finally {
      clearTimeout(temporizador);
    }
  }

  /** Si la persona agregada usa OpenDash, su carga completa corre ya: ve el proyecto sin esperar a la de la hora. */
  function cargarParaLaNueva(personaId: number): void {
    if (clientePara(deps, personaId) === null) return;
    deps.sync.cargaCompleta(personaId).catch((fallo: unknown) => {
      deps.registro?.warn({ motivo: fallo instanceof Error ? fallo.message : 'desconocido' }, 'no se pudo cargar lo del miembro agregado');
    });
  }

  app.get('/api/proyectos/:id/miembros', { preHandler: sesion }, async (req, res) => {
    const proyectoId = idDe((req.params as { id: string }).id);
    if (proyectoId === null) return res.code(400).send(invalida);
    const usuarioId = req.usuario!.id;
    if (!cache.proyectosDe(usuarioId).includes(proyectoId)) return res.code(404).send(noEncontrado);
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      const [crudos, caps] = await Promise.all([cliente.miembros(proyectoId), cliente.capacidades(usuarioId, proyectoId)]);
      const puede: PermisosMiembros = { agregar: caps.crearMiembro, cambiar: caps.cambiarMiembro, quitar: caps.quitarMiembro };
      const [roles, candidatos] = await Promise.all([
        puede.agregar || puede.cambiar ? cliente.rolesDeProyecto() : Promise.resolve<Rol[]>([]),
        puede.agregar ? cliente.candidatos(proyectoId) : Promise.resolve<Persona[]>([]),
      ]);
      const personas = new Map((cache.catalogo()?.personas ?? []).map((p) => [p.id, p] as const));
      const miembros = crudos.map((m): MiembroDeProyecto => {
        const persona = personas.get(m.personaId);
        return {
          ...m,
          nombre: persona?.nombre ?? `Persona ${m.personaId}`,
          avatarUrl: persona?.avatarUrl ?? null,
          tareasAbiertas: abiertasDe(proyectoId, m.personaId).length,
        };
      });
      return exito<ListaMiembros>({ miembros, roles, candidatos, puede });
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.post('/api/proyectos/:id/miembros', { preHandler: sesion }, async (req, res) => {
    const proyectoId = idDe((req.params as { id: string }).id);
    const cuerpo = esquemaAlta.safeParse(req.body);
    if (proyectoId === null || !cuerpo.success) return res.code(400).send(invalida);
    const usuarioId = req.usuario!.id;
    if (!cache.proyectosDe(usuarioId).includes(proyectoId)) return res.code(404).send(noEncontrado);
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      const creado = await cliente.agregarMiembro(proyectoId, cuerpo.data.personaId, cuerpo.data.rolId);
      await releerAsignables(usuarioId, proyectoId);
      cargarParaLaNueva(cuerpo.data.personaId);
      return exito(creado);
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.patch('/api/miembros/:id', { preHandler: sesion }, async (req, res) => {
    const id = idDe((req.params as { id: string }).id);
    const cuerpo = esquemaRol.safeParse(req.body);
    if (id === null || !cuerpo.success) return res.code(400).send(invalida);
    const usuarioId = req.usuario!.id;
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      const { proyectoId } = await cliente.membresia(id);
      if (!cache.proyectosDe(usuarioId).includes(proyectoId)) return res.code(404).send(noEncontrado);
      const cambiado = await cliente.cambiarRol(id, cuerpo.data.rolId);
      await releerAsignables(usuarioId, proyectoId);
      return exito(cambiado);
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.delete('/api/miembros/:id', { preHandler: sesion }, async (req, res) => {
    const id = idDe((req.params as { id: string }).id);
    const cuerpo = esquemaQuitar.safeParse(req.body ?? { pasarA: null });
    if (id === null || !cuerpo.success) return res.code(400).send(invalida);
    const usuarioId = req.usuario!.id;
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    const { pasarA } = cuerpo.data;
    try {
      const miembro = await cliente.membresia(id);
      const { proyectoId, personaId } = miembro;
      if (!cache.proyectosDe(usuarioId).includes(proyectoId)) return res.code(404).send(noEncontrado);
      if (pasarA !== null) {
        const asignables = cache.catalogo()?.asignables[proyectoId];
        if (pasarA === personaId || (asignables !== undefined && !asignables.includes(pasarA))) {
          return res.code(400).send(falla('validacion', 'Esa persona no puede recibir las tareas de este proyecto'));
        }
      }
      // Sin permiso para sacar no se toca ninguna tarea: la autorización no puede quedar solo en el botón.
      if (!(await cliente.capacidades(usuarioId, proyectoId)).quitarMiembro) return res.code(403).send(falla('prohibido', MSG_SIN_PERMISO));
      // Las tareas abiertas se reasignan antes de sacarlo: si una falla, no se saca a nadie. Se leen de OpenProject,
      // no de la caché, que puede estar atrasada.
      const abiertas = await cliente.tareasAbiertasDe(proyectoId, personaId);
      let reasignadas = 0;
      for (const tarea of abiertas) {
        try {
          const nueva = await cliente.actualizarTarea(tarea.id, tarea.lockVersion, { responsableId: pasarA });
          cache.guardarTareas([nueva]);
          reasignadas += 1;
        } catch (e) {
          if (e instanceof ErrorOp && ['conflicto', 'validacion', 'prohibido', 'no-encontrado'].includes(e.tipo)) {
            const avance = reasignadas === 0 ? 'No se reasignó ninguna' : `Ya se reasignaron ${reasignadas} de ${abiertas.length}`;
            return res.code(409).send(falla('conflicto', `No se pudo reasignar «${tarea.titulo}» (${e.message}). ${avance}: resolvela y volvé a intentar. No se sacó al miembro.`));
          }
          throw e;
        }
      }
      await cliente.quitarMiembro(id);
      await releerAsignables(usuarioId, proyectoId);
      return exito({});
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });
}
