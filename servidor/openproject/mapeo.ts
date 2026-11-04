import { z } from 'zod';
import { nivelDePrioridad } from '../../compartido/prioridades.js';
import type {
  Actividad, Adjunto, Dependencia, Estado, EstadoVersion, Miembro, Notificacion, Persona, Prioridad, Proyecto, Rol, Tarea, TipoTarea, Version,
} from '../../compartido/tipos.js';

const enlace = z.object({ href: z.string().nullish(), title: z.string().nullish() }).nullish();
type Enlace = z.infer<typeof enlace>;

/** Id numérico final de un href como `/api/v3/statuses/7`. */
export function idDeHref(href: string | null | undefined): number | null {
  const m = /\/(\d+)\/?$/.exec(href ?? '');
  return m ? Number(m[1]) : null;
}

const idOpcional = (e: Enlace): number | null => idDeHref(e?.href);

function idRequerido(e: Enlace, nombre: string): number {
  const id = idDeHref(e?.href);
  if (id === null) throw new Error(`Falta el enlace «${nombre}» en la respuesta de OpenProject`);
  return id;
}

/**
 * Duración ISO 8601 (`PT1H30M`, `P1DT2H`, `P1W`) a horas decimales; un día cuenta 24 h y una semana 168 h.
 * Años y meses no tienen largo fijo, y lo que no se reconoce tampoco debe abortar una lista: devuelven `null`.
 */
export function horasDeDuracion(iso: string | null): number | null {
  if (iso === null || iso === '') return null;
  const m = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return null;
  const [anios, meses, semanas = 0, dias = 0, h = 0, min = 0, s = 0] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  if (anios || meses) return null;
  return semanas * 168 + dias * 24 + h + min / 60 + s / 3600;
}

/** Horas decimales a duración ISO 8601 (2 → `PT2H`, 1.5 → `PT1H30M`). */
export function duracionDeHoras(horas: number): string {
  const minutosTotales = Math.round(horas * 60);
  const h = Math.floor(minutosTotales / 60);
  const min = minutosTotales % 60;
  if (h === 0 && min === 0) return 'PT0H';
  return `PT${h > 0 ? `${h}H` : ''}${min > 0 ? `${min}M` : ''}`;
}

const esquemaTarea = z.object({
  id: z.number(),
  lockVersion: z.number(),
  subject: z.string(),
  description: z.object({ raw: z.string().nullish() }).nullish(),
  startDate: z.string().nullish(),
  dueDate: z.string().nullish(),
  date: z.string().nullish(),   // los hitos traen una sola fecha en lugar de inicio y fin
  estimatedTime: z.string().nullish(),
  remainingTime: z.string().nullish(),
  spentTime: z.string().nullish(),
  percentageDone: z.number().nullish(),
  scheduleManually: z.boolean().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
  _links: z.object({
    project: enlace, type: enlace, status: enlace, priority: enlace,
    assignee: enlace, author: enlace, parent: enlace, version: enlace,
  }),
});

/** Lectura de un elemento de OpenProject que no rompe: el valor, o los campos que no tenían la forma esperada. */
export type Lectura<T> = { ok: true; valor: T } | { ok: false; campos: string[] };

const camposDe = (error: z.ZodError): string[] => [...new Set(error.issues.map((i) => i.path.join('.') || '(todo)'))];

function sinRomper<T>(hal: unknown, esquema: z.ZodType<T>): Lectura<T> {
  const r = esquema.safeParse(hal);
  return r.success ? { ok: true, valor: r.data } : { ok: false, campos: camposDe(r.error) };
}

const exigir = <T>(lectura: Lectura<T>, que: string): T => {
  if (!lectura.ok) throw new Error(`OpenProject devolvió ${que} con forma inesperada (${lectura.campos.join(', ')})`);
  return lectura.valor;
};

const ENLACES_DE_TAREA = ['project', 'type', 'status', 'priority'] as const;

export function leerTarea(hal: unknown): Lectura<Tarea> {
  const lectura = sinRomper(hal, esquemaTarea);
  if (!lectura.ok) return lectura;
  const faltan = ENLACES_DE_TAREA.filter((clave) => idDeHref(lectura.valor._links[clave]?.href) === null);
  if (faltan.length > 0) return { ok: false, campos: faltan.map((clave) => `_links.${clave}`) };
  return { ok: true, valor: armarTarea(lectura.valor) };
}

export const aTarea = (hal: unknown): Tarea => exigir(leerTarea(hal), 'un paquete de trabajo');

function armarTarea(t: z.infer<typeof esquemaTarea>): Tarea {
  const l = t._links;
  return {
    id: t.id,
    lockVersion: t.lockVersion,
    titulo: t.subject,
    descripcion: t.description?.raw ?? '',
    proyectoId: idRequerido(l.project, 'project'),
    tipoId: idRequerido(l.type, 'type'),
    estadoId: idRequerido(l.status, 'status'),
    prioridadId: idRequerido(l.priority, 'priority'),
    responsableId: idOpcional(l.assignee),
    autorId: idOpcional(l.author),
    inicio: t.startDate ?? t.date ?? null,
    fin: t.dueDate ?? t.date ?? null,
    estimacionHoras: horasDeDuracion(t.estimatedTime ?? null),
    horasReales: horasDeDuracion(t.spentTime ?? null),
    restanteHoras: horasDeDuracion(t.remainingTime ?? null),
    porcentaje: t.percentageDone ?? null,
    madreId: idOpcional(l.parent),
    versionId: idOpcional(l.version),
    programacionManual: t.scheduleManually ?? false,
    creada: t.createdAt,
    actualizada: t.updatedAt,
    cerradaEl: null,
    comentarios: null,
  };
}

const esquemaEstado = z.object({ id: z.number(), name: z.string(), isClosed: z.boolean(), color: z.string().nullish() });
export function aEstado(hal: unknown): Estado {
  const e = esquemaEstado.parse(hal);
  return { id: e.id, nombre: e.name, cerrado: e.isClosed, color: e.color ?? '#808080' };
}

const esquemaDiaSemana = z.object({ day: z.number().int().min(1).max(7), working: z.boolean() });
/** `day` de OpenProject: 1 = lunes … 7 = domingo; acá 0 = domingo … 6 = sábado. */
export function aDiaSemana(hal: unknown): { dia: number; laborable: boolean } {
  const d = esquemaDiaSemana.parse(hal);
  return { dia: d.day % 7, laborable: d.working };
}

const esquemaDiaNoLaborable = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export function aDiaNoLaborable(hal: unknown): string {
  return esquemaDiaNoLaborable.parse(hal).date;
}

const esquemaTipo = z.object({ id: z.number(), name: z.string(), isMilestone: z.boolean(), color: z.string().nullish() });
export function aTipo(hal: unknown): TipoTarea {
  const t = esquemaTipo.parse(hal);
  return { id: t.id, nombre: t.name, esHito: t.isMilestone, color: t.color ?? '#808080' };
}

const esquemaPrioridad = z.object({ id: z.number(), name: z.string() });
export function aPrioridad(hal: unknown): Prioridad {
  const p = esquemaPrioridad.parse(hal);
  const nivel = nivelDePrioridad(p.name);
  return { id: p.id, nombre: p.name, alta: nivel === 'alta' || nivel === 'inmediata', nivel };
}

const esquemaProyecto = z.object({
  id: z.number(),
  name: z.string(),
  identifier: z.string(),
  active: z.boolean().nullish(),
  description: z.object({ raw: z.string().nullish() }).nullish(),
  _links: z.object({ status: enlace }).nullish(),
});
export function aProyecto(hal: unknown): Proyecto {
  const p = esquemaProyecto.parse(hal);
  return {
    id: p.id,
    nombre: p.name,
    identificador: p.identifier,
    activo: p.active ?? true,
    estadoOp: p._links?.status?.title ?? null,
    estadoOpClave: p._links?.status?.href?.split('/').pop() || null,
    descripcion: p.description?.raw ?? '',
  };
}

const esquemaVersion = z.object({
  id: z.number(),
  name: z.string(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  effectiveDate: z.string().nullish(),   // OpenProject anterior a 16.6 mandaba el fin acá
  status: z.string().nullish(),
  _links: z.object({ definingProject: enlace }).nullish(),
});
const ESTADO_DE_VERSION: Record<string, EstadoVersion> = { open: 'abierta', locked: 'bloqueada', closed: 'cerrada' };
export const ESTADO_OP_DE_VERSION: Record<EstadoVersion, string> = { abierta: 'open', bloqueada: 'locked', cerrada: 'closed' };
export function aVersion(hal: unknown, proyectoIdPorDefecto?: number): Version {
  const v = esquemaVersion.parse(hal);
  const proyectoId = idOpcional(v._links?.definingProject) ?? proyectoIdPorDefecto;
  if (proyectoId === undefined) throw new Error('Falta el proyecto de la versión en la respuesta de OpenProject');
  return {
    id: v.id, nombre: v.name, proyectoId,
    estado: ESTADO_DE_VERSION[v.status ?? ''] ?? 'abierta',
    inicio: v.startDate ?? null,
    fin: v.endDate ?? v.effectiveDate ?? null,
  };
}

const esquemaRol = z.object({ id: z.number(), name: z.string() });
export function aRol(hal: unknown): Rol {
  const r = esquemaRol.parse(hal);
  return { id: r.id, nombre: r.name };
}

const esquemaMiembro = z.object({
  id: z.number(),
  _links: z.object({ principal: enlace, roles: z.array(enlace).nullish() }),
});
/** Un miembro que es persona; los grupos de OpenProject se descartan (`null`). */
export function aMiembro(hal: unknown): Miembro | null {
  const m = esquemaMiembro.parse(hal);
  const href = m._links.principal?.href ?? '';
  if (!/\/users\/\d+\/?$/.test(href)) return null;
  const roles: Rol[] = [];
  for (const r of m._links.roles ?? []) {
    const id = idOpcional(r);
    if (id !== null) roles.push({ id, nombre: r?.title ?? '' });
  }
  return { id: m.id, personaId: idRequerido(m._links.principal, 'principal'), roles };
}

const esquemaPersona = z.object({
  _type: z.string().nullish(),
  id: z.number(),
  name: z.string(),
  login: z.string().nullish(),
  email: z.string().nullish(),
  avatar: z.string().nullish(),
});
/** Devuelve `null` para grupos y otros principales que no son personas. */
export function aPersona(hal: unknown): Persona | null {
  const p = esquemaPersona.parse(hal);
  if (p._type != null && p._type !== 'User') return null;
  return { id: p.id, nombre: p.name, login: p.login ?? null, email: p.email ?? null, avatarUrl: p.avatar ?? null };
}

const esquemaActividad = z.object({
  id: z.number(),
  createdAt: z.string(),
  comment: z.object({ raw: z.string().nullish() }).nullish(),
  details: z.array(z.object({ raw: z.string().nullish() })).nullish(),
  _links: z.object({ user: enlace }).nullish(),
});
export function leerActividad(hal: unknown): Lectura<Actividad> {
  const lectura = sinRomper(hal, esquemaActividad);
  if (!lectura.ok) return lectura;
  const a = lectura.valor;
  return {
    ok: true,
    valor: {
      id: a.id,
      creada: a.createdAt,
      autorId: idOpcional(a._links?.user),
      comentario: a.comment?.raw ?? '',
      detalles: (a.details ?? []).map((d) => d.raw ?? '').filter((d) => d !== ''),
    },
  };
}

export const aActividad = (hal: unknown): Actividad => exigir(leerActividad(hal), 'una actividad');

const esquemaAdjunto = z.object({
  id: z.number(),
  fileName: z.string(),
  fileSize: z.number().nullish(),
  contentType: z.string().nullish(),
  createdAt: z.string(),
  _links: z.object({ author: enlace, delete: enlace }).nullish(),
});
export function aAdjunto(hal: unknown): Adjunto {
  const a = esquemaAdjunto.parse(hal);
  return {
    id: a.id,
    nombre: a.fileName,
    bytes: a.fileSize ?? 0,
    tipo: a.contentType ?? 'application/octet-stream',
    autorId: idOpcional(a._links?.author),
    creado: a.createdAt,
    puedeBorrar: a._links?.delete != null,
  };
}

const esquemaRelacion = z.object({
  id: z.number(),
  type: z.string(),
  lag: z.number().nullish(),
  _links: z.object({ from: enlace, to: enlace }),
});
/** `follows` y `precedes` expresan orden; cualquier otro tipo se ignora (`null`). */
export function aDependencia(hal: unknown): Dependencia | null {
  const r = esquemaRelacion.parse(hal);
  if (r.type !== 'follows' && r.type !== 'precedes') return null;
  const desde = idRequerido(r._links.from, 'from');
  const hasta = idRequerido(r._links.to, 'to');
  const lag = r.lag ?? 0;
  return r.type === 'follows'
    ? { id: r.id, sucesoraId: desde, predecesoraId: hasta, lag }
    : { id: r.id, sucesoraId: hasta, predecesoraId: desde, lag };
}

const esquemaRelacionCreada = z.object({ id: z.number(), lag: z.number().nullish() });
/** La relación recién creada: el orden sale de los ids pedidos, no de lo que devuelva OpenProject. */
export function aDependenciaCreada(hal: unknown, sucesoraId: number, predecesoraId: number): Dependencia {
  const r = esquemaRelacionCreada.parse(hal);
  return { id: r.id, sucesoraId, predecesoraId, lag: r.lag ?? 0 };
}

const esquemaNotificacion = z.object({
  id: z.number(),
  readIAN: z.boolean().nullish(),
  reason: z.string().nullish(),
  createdAt: z.string(),
  _links: z.object({ resource: enlace, actor: enlace }).nullish(),
});
export function aNotificacion(hal: unknown): Notificacion {
  const n = esquemaNotificacion.parse(hal);
  const recurso = n._links?.resource;
  const esTarea = (recurso?.href ?? '').includes('/work_packages/');
  return {
    id: n.id,
    leida: n.readIAN ?? false,
    motivo: n.reason ?? '',
    tareaId: esTarea ? idDeHref(recurso?.href) : null,
    titulo: recurso?.title ?? '',
    creada: n.createdAt,
    actorId: idOpcional(n._links?.actor),
  };
}

const esquemaColeccion = z.object({
  total: z.number(),
  _embedded: z.object({ elements: z.array(z.unknown()) }),
});
export function leerColeccion(hal: unknown): { total: number; elementos: unknown[] } {
  const c = esquemaColeccion.parse(hal);
  return { total: c.total, elementos: c._embedded.elements };
}
