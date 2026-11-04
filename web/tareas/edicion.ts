import type { Actividad, Catalogo, Dependencia, Tarea } from '../../compartido/tipos.js';
import { normalizar } from './logica.js';

// Lógica pura del panel de detalle: validaciones, textos y búsquedas.

export const MSG_CONFLICTO_DETALLE = 'Alguien cambió esta tarea recién. Ya ves la versión nueva; volvé a aplicar tu cambio.';
export const MSG_CONFLICTO_SUBTAREA = 'Alguien cambió esa subtarea recién. Ya ves la versión nueva.';
export const MSG_SIN_GUARDAR = 'Tenés cambios sin guardar';
export const MSG_FECHAS = 'La fecha de fin no puede ser anterior a la de inicio.';
export const MSG_HORAS = 'Escribí las horas como un número, por ejemplo 2 o 1,5.';
export const MSG_TITULO_VACIO = 'El título no puede quedar vacío.';

const ZONA = 'America/Argentina/Buenos_Aires';
const formatoCompleto = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short', timeZone: ZONA });

/** Fecha y hora completas en Buenos Aires, para el título emergente de una fecha relativa. */
export function fechaCompleta(instante: string): string {
  const fecha = new Date(instante);
  return Number.isNaN(fecha.getTime()) ? '' : formatoCompleto.format(fecha);
}

export interface Horas { valida: boolean; horas: number | null }

/** Horas escritas por la persona: vacío es «sin estimación»; acepta coma o punto decimal. */
export function leerHoras(texto: string): Horas {
  const limpio = texto.trim();
  if (limpio === '') return { valida: true, horas: null };
  if (!/^\d+(?:[.,]\d+)?$/.test(limpio)) return { valida: false, horas: null };
  return { valida: true, horas: Number(limpio.replace(',', '.')) };
}

export function mostrarHoras(horas: number | null): string {
  return horas === null ? '' : String(horas).replace('.', ',');
}

/** El fin no puede ser anterior al inicio; si falta alguna de las dos, no hay nada que comparar. */
export function fechasValidas(inicio: string | null, fin: string | null): boolean {
  return inicio === null || fin === null || fin >= inicio;
}

export interface Cambio { clave: string; texto: string; creada: string; autorId: number | null }

const porFecha = (a: Actividad, b: Actividad): number => a.creada.localeCompare(b.creada) || a.id - b.id;

/** Los últimos `cantidad` renglones de cambios, del más viejo al más nuevo. */
export function ultimosCambios(actividades: Actividad[], cantidad = 5): Cambio[] {
  const cambios = [...actividades].sort(porFecha).flatMap((a) =>
    a.detalles.map((texto, i) => ({ clave: `${a.id}-${i}`, texto, creada: a.creada, autorId: a.autorId })));
  return cambios.slice(-cantidad);
}

/** Actividades con comentario, del más viejo al más nuevo. */
export function comentariosDe(actividades: Actividad[]): Actividad[] {
  return actividades.filter((a) => a.comentario.trim() !== '').sort(porFecha);
}

/** Tareas cuyo título tiene todas las palabras (sin tildes) o cuyo número es `#id`. */
export function buscarTareas(tareas: Tarea[], texto: string, maximo = 8): Tarea[] {
  const limpio = texto.trim();
  if (limpio === '') return [];
  const numero = /^#?(\d+)$/.exec(limpio);
  const palabras = normalizar(limpio).split(/\s+/);
  const coinciden = tareas.filter((t) => {
    if (numero && t.id === Number(numero[1])) return true;
    const titulo = normalizar(t.titulo);
    return palabras.every((p) => titulo.includes(p));
  });
  return coinciden.slice(0, maximo);
}

/** Ids de la madre, la abuela… de `id`, hasta la raíz. */
export function ancestros(id: number, tareas: Tarea[]): Set<number> {
  const madres = new Map(tareas.map((t) => [t.id, t.madreId]));
  const vistas = new Set<number>();
  for (let actual = madres.get(id) ?? null; actual !== null && actual !== id && !vistas.has(actual); actual = madres.get(actual) ?? null) {
    vistas.add(actual);
  }
  return vistas;
}

/** Ids de las tareas que esperan a `id`, directa o indirectamente (agregarlas como predecesoras haría un ciclo). */
export function sucesorasDe(id: number, dependencias: Dependencia[]): Set<number> {
  const siguientes = new Map<number, number[]>();
  for (const d of dependencias) siguientes.set(d.predecesoraId, [...(siguientes.get(d.predecesoraId) ?? []), d.sucesoraId]);
  const vistas = new Set<number>();
  const pendientes = [...(siguientes.get(id) ?? [])];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    if (vistas.has(actual) || actual === id) continue;
    vistas.add(actual);
    pendientes.push(...(siguientes.get(actual) ?? []));
  }
  return vistas;
}

/** Ids de todas las tareas que cuelgan de `id` (hijas, nietas…). */
export function descendientes(id: number, tareas: Tarea[]): Set<number> {
  const hijas = new Map<number, number[]>();
  for (const t of tareas) {
    if (t.madreId === null) continue;
    hijas.set(t.madreId, [...(hijas.get(t.madreId) ?? []), t.id]);
  }
  const vistas = new Set<number>();
  const pendientes = [...(hijas.get(id) ?? [])];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    if (vistas.has(actual) || actual === id) continue;
    vistas.add(actual);
    pendientes.push(...(hijas.get(actual) ?? []));
  }
  return vistas;
}

const porNombre = (a: { texto: string }, b: { texto: string }) => a.texto.localeCompare(b.texto, 'es-AR');

/** Opciones del campo Responsable: «Sin asignar» y a quienes OpenProject deja asignar en el proyecto (todas las personas si no hay lista), más el responsable actual. */
export function opcionesResponsable(tarea: Tarea, catalogo: Catalogo): { valor: string; texto: string }[] {
  const permitidos = catalogo.asignables?.[tarea.proyectoId];
  const candidatas = permitidos === undefined ? catalogo.personas : catalogo.personas.filter((p) => permitidos.includes(p.id));
  const opciones = candidatas.map((p) => ({ valor: String(p.id), texto: p.nombre }));
  const actual = tarea.responsableId;
  if (actual !== null && !opciones.some((o) => o.valor === String(actual))) {
    opciones.push({ valor: String(actual), texto: catalogo.personas.find((p) => p.id === actual)?.nombre ?? 'Persona sin datos' });
  }
  return [{ valor: '', texto: 'Sin asignar' }, ...opciones.sort(porNombre)];
}
