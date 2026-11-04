import type {
  Actividad, Adjunto, Capacidades, CambiosTarea, CatalogoOp, Dependencia, EstadoVersion, Miembro, NuevaTarea, Notificacion, Persona, Proyecto, Rol, Tarea, TrabajoCopia, Version,
} from '../../compartido/tipos.js';
import { hoyArgentina } from '../../compartido/fechas.js';
import { REGISTRO_MUDO, type Registro } from '../registro.js';
import { crearAdjuntosOp } from './adjuntos.js';
import {
  atributosDelCuerpo, ESPERA_MAXIMA_MS, href, hrefONulo, idNumericoDe, leerAcotado, MAXIMO_AVATAR_BYTES, MAXIMO_REDIRECCIONES, mensajeDelCuerpo,
  MENSAJE_POR_TIPO, personasDe, TAMANO_PAGINA, tieneEnlace, type ContextoOp,
} from './base.js';
import { ErrorOp, tipoDeEstadoHttp } from './errores.js';
import { crearMiembrosOp } from './miembros.js';
import { crearProyectosOp } from './proyectos.js';
import { crearVersionesOp } from './versiones.js';
import {
  aDependencia, aDependenciaCreada, aDiaNoLaborable, aDiaSemana, aEstado, aNotificacion, aPersona, aPrioridad, aProyecto, aTarea, aTipo, aVersion,
  duracionDeHoras, leerActividad, leerColeccion, leerTarea, type Lectura,
} from './mapeo.js';

export interface LoteTareas { tareas: Tarea[]; salteadas: number[] }

export interface ClienteOp {
  yo(): Promise<Persona & { login: string }>;
  catalogo(): Promise<CatalogoOp>;
  proyectos(): Promise<Proyecto[]>;
  /** `salteadas`: ids de los elementos descartados por forma rara, para que la caché no los dé por borrados. */
  tareas(opciones?: { actualizadasDesde?: string }): Promise<LoteTareas>;
  /** Tareas abiertas de ese proyecto (sin las de sus subproyectos) de las que la persona es responsable, leídas de OpenProject. */
  tareasAbiertasDe(proyectoId: number, personaId: number): Promise<Tarea[]>;
  /** ¿Puede esta persona leer las tareas del proyecto? (verlo en la lista de proyectos no alcanza). */
  puedeLeerTareas(proyectoId: number): Promise<boolean>;
  /** Personas a quienes OpenProject deja asignar tareas del proyecto; vacío si no se puede consultar (403 o 404). */
  /** Quién puede ser responsable en el proyecto; null si el token no puede saberlo (403/404). */
  asignables(proyectoId: number): Promise<Persona[] | null>;
  tarea(id: number): Promise<Tarea>;
  actualizarTarea(id: number, lockVersion: number, cambios: CambiosTarea): Promise<Tarea>;
  crearTarea(datos: NuevaTarea): Promise<Tarea>;
  actividades(id: number): Promise<Actividad[]>;
  comentar(id: number, texto: string): Promise<void>;
  dependencias(): Promise<Dependencia[]>;
  crearDependencia(sucesoraId: number, predecesoraId: number, lag?: number): Promise<Dependencia>;
  borrarDependencia(id: number): Promise<void>;
  notificaciones(): Promise<Notificacion[]>;
  marcarLeida(id: number): Promise<void>;
  /** Marca varias de una vez (un solo pedido). Devuelve los ids que no se pudieron marcar. */
  marcarLeidas(ids: number[]): Promise<number[]>;
  /** Alta de tiempo invertido (el usuario es el del token). Un corte sin respuesta es `incierto`. */
  crearEntradaTiempo(datos: { tareaId: number; dia: string; horasIso: string; comentario: string }): Promise<{ id: number }>;
  editarEntradaTiempo(id: number, horasIso: string): Promise<void>;
  borrarEntradaTiempo(id: number): Promise<void>;
  /** Las entradas del usuario del token en esa tarea y ese día. */
  entradasDeTiempo(filtro: { tareaId?: number; dia: string }): Promise<{ id: number; comentario: string }[]>;
  /** Imagen del avatar de un usuario; `null` si no tiene o si OpenProject lo manda a otro origen. */
  avatar(usuarioId: number): Promise<{ tipo: string; datos: Buffer } | null>;
  adjuntos(tareaId: number): Promise<Adjunto[]>;
  /** Los datos de un adjunto (nombre, tipo, tamaño). */
  adjunto(id: number): Promise<Adjunto>;
  /** Mira `_links.addAttachment` de la tarea. */
  puedeAdjuntar(tareaId: number): Promise<boolean>;
  subirAdjunto(tareaId: number, nombre: string, tipo: string, datos: Buffer): Promise<Adjunto>;
  /** Baja el contenido con tope de tamaño; si lo pasa, `validacion`. */
  bajarAdjunto(id: number, maxBytes: number): Promise<{ tipo: string; bytes: Buffer }>;
  borrarAdjunto(id: number): Promise<void>;
  /** `maximumAttachmentFileSize` de la configuración; 5 MB si no se puede leer. */
  maximoAdjunto(): Promise<number>;
  /** Mira `_links.delete` de la tarea. */
  puedeBorrarTarea(tareaId: number): Promise<boolean>;
  borrarTarea(tareaId: number): Promise<void>;
  /** Qué puede hacer la persona en el proyecto, según `/api/v3/capabilities`. */
  capacidades(usuarioId: number, proyectoId: number): Promise<Capacidades>;
  /** ¿Puede crear proyectos vacíos? (contexto global de las capacidades). */
  puedeCrearProyectos(usuarioId: number): Promise<boolean>;
  /** Solo personas: los grupos de OpenProject quedan afuera. */
  miembros(proyectoId: number): Promise<Miembro[]>;
  rolesDeProyecto(): Promise<Rol[]>;
  /** Personas activas que todavía no son miembros del proyecto. */
  candidatos(proyectoId: number): Promise<Persona[]>;
  agregarMiembro(proyectoId: number, personaId: number, rolId: number): Promise<Miembro>;
  cambiarRol(miembroId: number, rolId: number): Promise<Miembro>;
  quitarMiembro(miembroId: number): Promise<void>;
  /** Una membresía con el proyecto al que pertenece. */
  membresia(miembroId: number): Promise<Miembro & { proyectoId: number }>;
  versiones(proyectoId: number): Promise<(Version & { puedeCambiar: boolean; puedeBorrar: boolean })[]>;
  /** El proyecto tiene que figurar en `versions/available_projects`; un 403 es que no. */
  puedeCrearVersion(proyectoId: number): Promise<boolean>;
  crearVersion(proyectoId: number, datos: { nombre: string; inicio: string | null; fin: string | null }): Promise<Version>;
  cambiarVersion(id: number, cambios: Partial<{ nombre: string; inicio: string | null; fin: string | null; estado: EstadoVersion }>, proyectoId?: number): Promise<Version>;
  borrarVersion(id: number): Promise<void>;
  crearProyecto(nombre: string): Promise<Proyecto>;
  /** Copia con todas las opciones del formulario en verdadero y sin avisos; devuelve el id del job. */
  copiarProyecto(plantillaId: number, nombre: string): Promise<string>;
  estadoCopia(jobId: string): Promise<TrabajoCopia>;
  /** Uniones entre una tarea de un proyecto y una del otro (la copia a veces deja alguna). */
  unionesEntre(proyectoA: number, proyectoB: number): Promise<Dependencia[]>;
}

const idDeElemento = (hal: unknown): string => String(idNumericoDe(hal) ?? 'sin id');

/**
 * Mapea una lista sin que un elemento raro la tumbe: ese se saltea con una línea en el log (solo el id
 * y los campos que no cerraban; nunca el token ni el contenido).
 */
function salteandoRaros<T>(registro: Registro, elementos: unknown[], leer: (hal: unknown) => Lectura<T>, que: (id: string) => string): { validos: T[]; salteados: number[] } {
  const validos: T[] = [];
  const salteados: number[] = [];
  for (const hal of elementos) {
    const lectura = leer(hal);
    if (lectura.ok) validos.push(lectura.valor);
    else {
      const id = idNumericoDe(hal);
      if (id !== null) salteados.push(id);
      registro.warn({ motivo: 'forma-inesperada', campos: lectura.campos }, `[op] ${que(idDeElemento(hal))} salteado: forma inesperada en ${lectura.campos.join(', ')}`);
    }
  }
  return { validos, salteados };
}

function cuerpoDeCambios(cambios: CambiosTarea): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {};
  const enlaces: Record<string, unknown> = {};
  if (cambios.titulo !== undefined) cuerpo.subject = cambios.titulo;
  if (cambios.descripcion !== undefined) cuerpo.description = { raw: cambios.descripcion };
  if (cambios.inicio !== undefined) cuerpo.startDate = cambios.inicio;
  if (cambios.fin !== undefined) cuerpo.dueDate = cambios.fin;
  if (cambios.fecha !== undefined) cuerpo.date = cambios.fecha;   // los hitos tienen una sola fecha
  if (cambios.estimacionHoras !== undefined) {
    cuerpo.estimatedTime = cambios.estimacionHoras === null ? null : duracionDeHoras(cambios.estimacionHoras);
  }
  if (cambios.restanteHoras !== undefined) cuerpo.remainingTime = cambios.restanteHoras === null ? null : duracionDeHoras(cambios.restanteHoras);
  if (cambios.programacionManual !== undefined) cuerpo.scheduleManually = cambios.programacionManual;
  if (cambios.duracionDias !== undefined) cuerpo.duration = `P${cambios.duracionDias}D`;
  if (cambios.estadoId !== undefined) enlaces.status = href('statuses', cambios.estadoId);
  if (cambios.prioridadId !== undefined) enlaces.priority = href('priorities', cambios.prioridadId);
  if (cambios.responsableId !== undefined) enlaces.assignee = hrefONulo('users', cambios.responsableId);
  if (cambios.madreId !== undefined) enlaces.parent = hrefONulo('work_packages', cambios.madreId);
  if (cambios.versionId !== undefined) enlaces.version = hrefONulo('versions', cambios.versionId);
  if (cambios.proyectoId !== undefined) enlaces.project = href('projects', cambios.proyectoId);
  if (Object.keys(enlaces).length > 0) cuerpo._links = enlaces;
  return cuerpo;
}

function cuerpoDeNueva(datos: NuevaTarea): Record<string, unknown> {
  const enlaces: Record<string, unknown> = { project: href('projects', datos.proyectoId) };
  if (datos.tipoId !== undefined) enlaces.type = href('types', datos.tipoId);
  if (datos.estadoId !== undefined) enlaces.status = href('statuses', datos.estadoId);
  if (datos.responsableId != null) enlaces.assignee = href('users', datos.responsableId);
  if (datos.versionId != null) enlaces.version = href('versions', datos.versionId);
  if (datos.madreId != null) enlaces.parent = href('work_packages', datos.madreId);
  const cuerpo: Record<string, unknown> = { subject: datos.titulo, _links: enlaces };
  if (datos.inicio != null) cuerpo.startDate = datos.inicio;
  if (datos.fin != null) cuerpo.dueDate = datos.fin;
  if (datos.programacionManual !== undefined) cuerpo.scheduleManually = datos.programacionManual;
  return cuerpo;
}

export function crearClienteOp(op: { baseUrl: string; token: string; fetch?: typeof fetch; registro?: Registro }): ClienteOp {
  const registro = op.registro ?? REGISTRO_MUDO;
  const base = op.baseUrl.replace(/\/+$/, '');
  const llamar = op.fetch ?? globalThis.fetch;
  const autorizacion = `Basic ${Buffer.from(`apikey:${op.token}`).toString('base64')}`;

  /** `idempotente`: un POST que se puede repetir sin efecto (marcar leída); si no llega es `red`, no `incierto`. */
  async function pedir(metodo: string, ruta: string, cuerpo?: unknown, idempotente = false): Promise<unknown> {
    const esAlta = metodo === 'POST' && !idempotente;
    const cabeceras: Record<string, string> = { Authorization: autorizacion, Accept: 'application/json' };
    const init: RequestInit = { method: metodo, headers: cabeceras, signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) };
    // OpenProject responde 406 a un POST sin Content-Type aunque no lleve cuerpo (read_ian).
    // Un formulario lleva su propio Content-Type (con el boundary), que pone fetch.
    const esFormulario = cuerpo instanceof FormData;
    if (!esFormulario && (cuerpo !== undefined || metodo === 'POST')) cabeceras['Content-Type'] = 'application/json';
    if (cuerpo !== undefined) init.body = esFormulario ? cuerpo : JSON.stringify(cuerpo);
    let res: Response;
    let texto: string;
    try {
      res = await llamar(`${base}${ruta}`, init);
      texto = await res.text();
    } catch (causa) {
      throw new ErrorOp(esAlta ? 'incierto' : 'red', MENSAJE_POR_TIPO[esAlta ? 'incierto' : 'red'], null, { cause: causa });
    }
    if (!res.ok) {
      const tipo = tipoDeEstadoHttp(res.status, esAlta ? metodo : 'GET');
      const delCuerpo = tipo === 'validacion' ? mensajeDelCuerpo(texto) : null;
      const atributos = tipo === 'validacion' ? atributosDelCuerpo(texto) : [];
      throw new ErrorOp(tipo, delCuerpo ?? MENSAJE_POR_TIPO[tipo], res.status, { atributos });
    }
    if (texto === '') return undefined;
    try {
      return JSON.parse(texto);
    } catch (causa) {
      throw new ErrorOp(esAlta ? 'incierto' : 'red', 'OpenProject devolvió una respuesta que no es JSON', res.status, { cause: causa });
    }
  }

  /** Recorre todas las páginas de una colección (offset 1, 2, …). */
  async function todos(ruta: string, extra: Record<string, string> = {}): Promise<unknown[]> {
    const acumulado: unknown[] = [];
    for (let pagina = 1; ; pagina++) {
      const params = new URLSearchParams({ pageSize: String(TAMANO_PAGINA), offset: String(pagina), ...extra });
      const { total, elementos } = leerColeccion(await pedir('GET', `${ruta}?${params}`));
      acumulado.push(...elementos);
      if (elementos.length === 0 || acumulado.length >= total) return acumulado;
    }
  }

  /** Semana laboral y feriados de OpenProject; si no se pueden leer (cualquier falla) quedan sábado y domingo. */
  async function diasNoLaborablesOp(): Promise<{ semanaNoLaborable: number[]; diasNoLaborables: string[] }> {
    const anio = Number(hoyArgentina(new Date()).slice(0, 4));
    const filtro = JSON.stringify([{ date: { operator: '<>d', values: [`${anio}-01-01`, `${anio + 1}-12-31`] } }]);
    try {
      const [semana, feriados] = await Promise.all([
        todos('/api/v3/days/week'),
        todos('/api/v3/days/non_working', { filters: filtro }),
      ]);
      return {
        semanaNoLaborable: semana.map(aDiaSemana).filter((d) => !d.laborable).map((d) => d.dia).sort((a, b) => a - b),
        diasNoLaborables: [...new Set(feriados.map(aDiaNoLaborable))].sort(),
      };
    } catch (error) {
      // Cualquier falla (403/404, 5xx, red o forma inesperada) deja la semana por defecto: la app no queda sin catálogo.
      const motivo = error instanceof ErrorOp ? error.tipo : 'forma-inesperada';
      registro.warn({ motivo }, `[op] días no laborables omitidos (${motivo})`);
      return { semanaNoLaborable: [0, 6], diasNoLaborables: [] };
    }
  }

  /** Ids de los proyectos plantilla; un OpenProject que no entiende el filtro (u otra falla) deja la lista vacía. */
  async function plantillasOp(): Promise<number[]> {
    try {
      const filtro = JSON.stringify([{ templated: { operator: '=', values: ['t'] } }]);
      return (await todos('/api/v3/projects', { filters: filtro })).map(aProyecto).map((p) => p.id);
    } catch (error) {
      const motivo = error instanceof ErrorOp ? error.tipo : 'forma-inesperada';
      registro.warn({ motivo }, `[op] proyectos plantilla omitidos (${motivo})`);
      return [];
    }
  }

  const proyectos = async (): Promise<Proyecto[]> => (await todos('/api/v3/projects')).map(aProyecto);

  const contexto: ContextoOp = { base, llamar, autorizacion, registro, pedir, todos };

  return {
    ...crearAdjuntosOp(contexto),
    ...crearMiembrosOp(contexto),
    ...crearVersionesOp(contexto),
    ...crearProyectosOp(contexto),
    async yo() {
      const persona = aPersona(await pedir('GET', '/api/v3/users/me'));
      if (persona === null || persona.login === null) throw new Error('OpenProject no devolvió el login del usuario');
      return { ...persona, login: persona.login };
    },

    proyectos,

    async catalogo() {
      const [estados, tipos, prioridades, listaProyectos, principales] = await Promise.all([
        todos('/api/v3/statuses'),
        todos('/api/v3/types'),
        todos('/api/v3/priorities'),
        proyectos(),
        todos('/api/v3/principals'),
      ]);
      // Un proyecto archivado (o en borrado) se lista pero sus versiones dan 403: se omiten sin romper el catálogo.
      const versionesPorProyecto = await Promise.all(
        listaProyectos.filter((p) => p.activo).map(async (p) => {
          try {
            return (await todos(`/api/v3/projects/${p.id}/versions`)).map((v) => aVersion(v, p.id));
          } catch (error) {
            if (error instanceof ErrorOp && (error.tipo === 'prohibido' || error.tipo === 'no-encontrado')) {
              registro.warn({ motivo: error.tipo, proyectoId: p.id }, `[op] versiones del proyecto ${p.id} omitidas (${error.tipo})`);
              return [];
            }
            throw error;
          }
        }),
      );
      const versiones = new Map<number, Version>();
      for (const v of versionesPorProyecto.flat()) versiones.set(v.id, v);
      const [{ semanaNoLaborable, diasNoLaborables }, plantillas] = await Promise.all([diasNoLaborablesOp(), plantillasOp()]);
      return {
        estados: estados.map(aEstado),
        tipos: tipos.map(aTipo),
        prioridades: prioridades.map(aPrioridad),
        proyectos: listaProyectos,
        versiones: [...versiones.values()],
        personas: personasDe(principales),
        asignables: {},
        semanaNoLaborable,
        diasNoLaborables,
        plantillasOp: plantillas,
      };
    },

    async tareas(opciones) {
      const filtros = opciones?.actualizadasDesde
        ? [{ updatedAt: { operator: '<>d', values: [opciones.actualizadasDesde, ''] } }]
        : [];
      const elementos = await todos('/api/v3/work_packages', { filters: JSON.stringify(filtros) });
      const { validos, salteados } = salteandoRaros(registro, elementos, leerTarea, (id) => `paquete de trabajo ${id}`);
      return { tareas: validos, salteadas: salteados };
    },

    async tareasAbiertasDe(proyectoId, personaId) {
      const filtros = [{ assignee: { operator: '=', values: [String(personaId)] } }, { status: { operator: 'o', values: null } }];
      const elementos = await todos(`/api/v3/projects/${proyectoId}/work_packages`, { filters: JSON.stringify(filtros) });
      const { validos } = salteandoRaros(registro, elementos, leerTarea, (id) => `paquete de trabajo ${id}`);
      return validos.filter((t) => t.proyectoId === proyectoId);
    },

    async puedeLeerTareas(proyectoId) {
      try {
        await pedir('GET', `/api/v3/projects/${proyectoId}/work_packages?${new URLSearchParams({ pageSize: '1', filters: '[]' })}`);
        return true;
      } catch (error) {
        if (error instanceof ErrorOp && (error.tipo === 'prohibido' || error.tipo === 'no-encontrado')) return false;
        throw error;
      }
    },

    async asignables(proyectoId) {
      try {
        return personasDe(await todos(`/api/v3/projects/${proyectoId}/available_assignees`));
      } catch (error) {
        if (error instanceof ErrorOp && (error.tipo === 'prohibido' || error.tipo === 'no-encontrado')) return null;
        throw error;
      }
    },

    async tarea(id) {
      return aTarea(await pedir('GET', `/api/v3/work_packages/${id}`));
    },

    async actualizarTarea(id, lockVersion, cambios) {
      return aTarea(await pedir('PATCH', `/api/v3/work_packages/${id}`, { lockVersion, ...cuerpoDeCambios(cambios) }));
    },

    async crearTarea(datos) {
      return aTarea(await pedir('POST', '/api/v3/work_packages', cuerpoDeNueva(datos)));
    },

    async actividades(id) {
      const elementos = await todos(`/api/v3/work_packages/${id}/activities`);
      return salteandoRaros(registro, elementos, leerActividad, (actividad) => `actividad ${actividad} de la tarea ${id}`).validos;
    },

    async comentar(id, texto) {
      await pedir('POST', `/api/v3/work_packages/${id}/activities`, { comment: { raw: texto } });
    },

    async dependencias() {
      return (await todos('/api/v3/relations')).map(aDependencia).filter((d): d is Dependencia => d !== null);
    },

    async crearDependencia(sucesoraId, predecesoraId, lag = 0) {
      const cuerpo = { type: 'follows', ...(lag !== 0 ? { lag } : {}), _links: { to: href('work_packages', predecesoraId) } };
      // Tras un 2xx la relación ya existe: se arma con los ids pedidos y nunca se lanza (un reintento duplicaría).
      return aDependenciaCreada(await pedir('POST', `/api/v3/work_packages/${sucesoraId}/relations`, cuerpo), sucesoraId, predecesoraId);
    },

    async borrarDependencia(id) {
      await pedir('DELETE', `/api/v3/relations/${id}`);
    },

    async notificaciones() {
      return (await todos('/api/v3/notifications')).map(aNotificacion);
    },

    async marcarLeida(id) {
      await pedir('POST', `/api/v3/notifications/${id}/read_ian`, undefined, true);
    },

    async marcarLeidas(ids) {
      if (ids.length === 0) return [];
      const filtros = JSON.stringify([{ id: { operator: '=', values: ids.map(String) } }]);
      await pedir('POST', `/api/v3/notifications/read_ian?filters=${encodeURIComponent(filtros)}`, undefined, true);
      return [];
    },

    async crearEntradaTiempo({ tareaId, dia, horasIso, comentario }) {
      const cuerpo = {
        hours: horasIso, spentOn: dia, comment: { raw: comentario },
        _links: { entity: href('work_packages', tareaId) },
      };
      const creada = await pedir('POST', '/api/v3/time_entries', cuerpo);
      const id = (creada as { id?: unknown } | null)?.id;
      // Tras un 2xx la entrada ya existe: sin id legible no se puede adoptar, y reintentar la duplicaría.
      if (typeof id !== 'number') throw new ErrorOp('incierto', 'OpenProject creó la carga pero no devolvió su id');
      return { id };
    },

    async editarEntradaTiempo(id, horasIso) {
      await pedir('PATCH', `/api/v3/time_entries/${id}`, { hours: horasIso });
    },

    async borrarEntradaTiempo(id) {
      await pedir('DELETE', `/api/v3/time_entries/${id}`);
    },

    async entradasDeTiempo({ tareaId, dia }) {
      // Sin tarea se piden todas las entradas propias del día.
      const filtros = JSON.stringify([
        ...(tareaId === undefined ? [] : [
          { entityType: { operator: '=', values: ['WorkPackage'] } },
          { entityId: { operator: '=', values: [String(tareaId)] } },
        ]),
        { spentOn: { operator: '=d', values: [dia] } },
        { user: { operator: '=', values: ['me'] } },
      ]);
      return (await todos('/api/v3/time_entries', { filters: filtros })).flatMap((e) => {
        const { id, comment } = (e ?? {}) as { id?: unknown; comment?: { raw?: unknown } | null };
        if (typeof id !== 'number') return [];
        return [{ id, comentario: typeof comment?.raw === 'string' ? comment.raw : '' }];
      });
    },

    avatar: pedirAvatar,

    async puedeBorrarTarea(tareaId) {
      return tieneEnlace(await pedir('GET', `/api/v3/work_packages/${tareaId}`), 'delete');
    },

    async borrarTarea(tareaId) {
      await pedir('DELETE', `/api/v3/work_packages/${tareaId}`);
    },

  };

  // La URL se arma acá con el id (nunca viene de afuera) y solo se siguen redirecciones dentro de
  // OpenProject: el token no viaja a otro sitio (p. ej. Gravatar).
  async function pedirAvatar(usuarioId: number): Promise<{ tipo: string; datos: Buffer } | null> {
    const origen = new URL(base).origin;
    let url = `${base}/api/v3/users/${usuarioId}/avatar`;
    for (let salto = 0; salto <= MAXIMO_REDIRECCIONES; salto++) {
      let res: Response;
      try {
        res = await llamar(url, {
          headers: { Authorization: autorizacion, Accept: 'image/*' },
          redirect: 'manual',
          signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
        });
      } catch (causa) {
        throw new ErrorOp('red', MENSAJE_POR_TIPO.red, null, { cause: causa });
      }
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const destino = res.headers.get('location');
        if (destino === null) return null;
        const siguiente = new URL(destino, url);
        if (siguiente.origin !== origen) return null;
        url = siguiente.href;
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) {
        const tipo = tipoDeEstadoHttp(res.status);
        throw new ErrorOp(tipo, MENSAJE_POR_TIPO[tipo], res.status);
      }
      // Si declara un largo mayor al tope no se lee el cuerpo; si no lo declara, se lee por partes y se corta al pasarse.
      const declarado = Number(res.headers.get('content-length'));
      if (Number.isFinite(declarado) && declarado > MAXIMO_AVATAR_BYTES) {
        await res.body?.cancel();
        return null;
      }
      let datos: Buffer;
      try {
        const leido = await leerAcotado(res, MAXIMO_AVATAR_BYTES);
        if (leido === null) return null;
        datos = leido;
      } catch (causa) {
        throw new ErrorOp('red', MENSAJE_POR_TIPO.red, res.status, { cause: causa });
      }
      const tipo = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      return { tipo, datos };
    }
    return null;
  }
}

