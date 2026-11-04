import type { Dependencia } from '../../compartido/tipos.js';
import type { ClienteOp } from './cliente.js';
import { ErrorOp, tipoDeEstadoHttp } from './errores.js';
import { aDependencia, aProyecto, idDeHref } from './mapeo.js';
import { ESPERA_MAXIMA_MS, idNumericoDe, mensajeDelCuerpo, MENSAJE_POR_TIPO, type ContextoOp } from './base.js';

/** Proyectos nuevos, copia desde una plantilla y uniones entre proyectos. */
export function crearProyectosOp(ctx: ContextoOp): Pick<ClienteOp, 'crearProyecto' | 'copiarProyecto' | 'estadoCopia' | 'unionesEntre'> {
  const { pedir, todos } = ctx;
  const { base, llamar, autorizacion } = ctx;

  /** Ids de todas las tareas del proyecto (abiertas y cerradas). */
  async function idsDeTareas(proyectoId: number): Promise<Set<number>> {
    const elementos = await todos(`/api/v3/projects/${proyectoId}/work_packages`, { filters: '[]' });
    return new Set(elementos.map(idNumericoDe).filter((id): id is number => id !== null));
  }

  /** POST que responde 303 con el job: el `Location` se lee sin seguir la redirección. */
  async function postearCopia(ruta: string, cuerpo: unknown): Promise<string> {
    let res: Response;
    let texto = '';
    try {
      res = await llamar(`${base}${ruta}`, {
        method: 'POST',
        headers: { Authorization: autorizacion, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        redirect: 'manual',
        signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
      });
      if (res.status < 300 || res.status >= 400) texto = await res.text();
    } catch (causa) {
      throw new ErrorOp('incierto', MENSAJE_POR_TIPO.incierto, null, { cause: causa });
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const id = /\/job_statuses\/([\w-]+)\/?$/.exec(res.headers.get('location') ?? '')?.[1];
      if (id === undefined) throw new ErrorOp('incierto', 'OpenProject empezó la copia pero no dijo cómo seguirla', res.status);
      return id;
    }
    if (!res.ok) {
      const tipo = tipoDeEstadoHttp(res.status, 'POST');
      throw new ErrorOp(tipo, (tipo === 'validacion' ? mensajeDelCuerpo(texto) : null) ?? MENSAJE_POR_TIPO[tipo], res.status);
    }
    throw new ErrorOp('incierto', 'OpenProject respondió a la copia sin dar el trabajo', res.status);
  }


  return {
    async crearProyecto(nombre) {
      return aProyecto(await pedir('POST', '/api/v3/projects', { name: nombre }));
    },

    async copiarProyecto(plantillaId, nombre) {
      // El formulario trae el identificador armado y la lista de qué copiar: sin `_meta` OpenProject copia un proyecto vacío.
      const formulario = (await pedir('POST', `/api/v3/projects/${plantillaId}/copy/form`, { name: nombre }, true)) as {
        _embedded?: { payload?: { identifier?: unknown; _meta?: Record<string, unknown> }; validationErrors?: Record<string, { message?: unknown }> };
      } | null;
      const error = Object.values(formulario?._embedded?.validationErrors ?? {})[0];
      if (error !== undefined) throw new ErrorOp('validacion', typeof error.message === 'string' ? error.message : MENSAJE_POR_TIPO.validacion, 422);
      const payload = formulario?._embedded?.payload;
      const meta = Object.fromEntries(Object.keys(payload?._meta ?? {}).map((clave) => [clave, clave !== 'sendNotifications']));
      const cuerpo: Record<string, unknown> = { name: nombre, _meta: { ...meta, sendNotifications: false } };
      if (typeof payload?.identifier === 'string') cuerpo.identifier = payload.identifier;
      return postearCopia(`/api/v3/projects/${plantillaId}/copy`, cuerpo);
    },

    async estadoCopia(jobId) {
      if (!/^[\w-]+$/.test(jobId)) throw new ErrorOp('validacion', 'El trabajo de copia no es válido');
      const job = (await pedir('GET', `/api/v3/job_statuses/${jobId}`)) as {
        status?: unknown; message?: unknown; payload?: { errors?: unknown; _links?: { project?: { href?: string | null } } };
      } | null;
      const estado = job?.status;
      if (estado === 'in_queue' || estado === 'in_process') return { estado: 'en-curso', proyectoId: null, errores: [] };
      const crudos: unknown[] = Array.isArray(job?.payload?.errors) ? job.payload.errors : [];
      const errores = crudos
        .map((e) => (typeof e === 'string' ? e : (e as { message?: unknown } | null)?.message))
        .filter((e): e is string => typeof e === 'string' && e !== '');
      if (estado === 'success') return { estado: 'listo', proyectoId: idDeHref(job?.payload?._links?.project?.href), errores };
      // Solo `failure` y `cancelled` son fallo; un estado que no se conoce sigue como en curso.
      if (estado !== 'failure' && estado !== 'cancelled') return { estado: 'en-curso', proyectoId: null, errores: [] };
      const mensaje = typeof job?.message === 'string' && job.message !== '' ? [job.message] : [];
      return { estado: 'fallo', proyectoId: idDeHref(job?.payload?._links?.project?.href), errores: errores.length > 0 ? errores : mensaje };
    },

    async unionesEntre(proyectoA, proyectoB) {
      const [deA, deB] = await Promise.all([idsDeTareas(proyectoA), idsDeTareas(proyectoB)]);
      if (deA.size === 0 || deB.size === 0) return [];
      const filtros = JSON.stringify([{ involved: { operator: '=', values: [...deB].map(String) } }]);
      const uniones = (await todos('/api/v3/relations', { filters: filtros })).map(aDependencia).filter((d): d is Dependencia => d !== null);
      return uniones.filter((d) => (deA.has(d.sucesoraId) && deB.has(d.predecesoraId)) || (deB.has(d.sucesoraId) && deA.has(d.predecesoraId)));
    },
  };
}
