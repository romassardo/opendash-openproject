import { columnaDeEstado } from '../../compartido/columnas.js';
import type { Catalogo, Columna, Tarea } from '../../compartido/tipos.js';
import { aUtc, diasEntre, fechaArgentina, semanaDe, sumarDias } from '../fechas.js';

export { fechaArgentina, hoyArgentina, semanaDe } from '../fechas.js';

// Lógica pura de la pantalla Tareas. Las fechas van como 'YYYY-MM-DD' en hora argentina;
// `hoy` entra como parámetro para que todo sea determinista.

export interface FiltroTareas {
  proyectoId: number | null;
  persona: 'todas' | 'mias' | number;
  soloAltas: boolean;
  texto: string;
}

export interface Contadores {
  abiertas: number;
  vencenSemana: number;
  vencidas: number;
  cerradasSemana: number;
}

export interface Avance {
  hechas: number;
  total: number;
}

const DIAS_CERRADO = 30;
const DIAS_CERCANOS = 6;

const formatoDiaSemana = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' });
const formatoDiaMes = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const sinPunto = (texto: string): string => texto.replace(/\./g, '').trim();
const conMayuscula = (texto: string): string => texto.charAt(0).toLocaleUpperCase('es-AR') + texto.slice(1);

/** 'Hoy', 'Mañana', 'Ayer', el día de la semana si está a menos de una semana, o '10 nov'. */
export function fechaAmigable(fecha: string, hoy: string): string {
  const dias = diasEntre(hoy, fecha);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  if (dias === -1) return 'Ayer';
  const dia = aUtc(fecha);
  if (Math.abs(dias) <= DIAS_CERCANOS) return conMayuscula(sinPunto(formatoDiaSemana.format(dia)));
  const diaMes = sinPunto(formatoDiaMes.format(dia));
  return fecha.slice(0, 4) === hoy.slice(0, 4) ? diaMes : `${diaMes} ${fecha.slice(0, 4)}`;
}

/** Ids de estados cerrados y de tipos hito, para consultar rápido. */
function indices(catalogo: Catalogo) {
  return {
    cerrados: new Set(catalogo.estados.filter((e) => e.cerrado).map((e) => e.id)),
    hitos: new Set(catalogo.tipos.filter((t) => t.esHito).map((t) => t.id)),
  };
}

/** Dice si una tarea es de un tipo marcado como hito; única definición para Inicio, Proyectos y Métricas. */
export function esHitoDe(catalogo: Catalogo): (tarea: Tarea) => boolean {
  const hitos = new Set(catalogo.tipos.filter((t) => t.esHito).map((t) => t.id));
  return (tarea) => hitos.has(tarea.tipoId);
}

/** Columna del tablero de una tarea; un estado desconocido va a «Nuevo». */
export function columnaDeTarea(tarea: Tarea, catalogo: Catalogo): Columna {
  const estado = catalogo.estados.find((e) => e.id === tarea.estadoId);
  return estado ? columnaDeEstado(estado, catalogo.tablero) : 'nuevo';
}

/** Abierta (los hitos cuentan) y con su fin —o su única fecha— ya pasado. */
export function vencida(tarea: Tarea, hoy: string, catalogo: Catalogo): boolean {
  if (columnaDeTarea(tarea, catalogo) === 'cerrado') return false;
  const limite = tarea.fin ?? tarea.inicio;
  return limite !== null && limite < hoy;
}

const fechaDeCierre = (tarea: Tarea): string => fechaArgentina(tarea.cerradaEl ?? tarea.actualizada);

function porFin(a: Tarea, b: Tarea): number {
  if (a.fin !== b.fin) {
    if (a.fin === null) return 1;
    if (b.fin === null) return -1;
    return a.fin < b.fin ? -1 : 1;
  }
  return a.id - b.id;
}

// Instante de cierre en ms; uno inválido va al final.
const momentoDeCierre = (tarea: Tarea): number => {
  const ms = Date.parse(tarea.cerradaEl ?? tarea.actualizada);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

function porCierreReciente(a: Tarea, b: Tarea): number {
  const diferencia = momentoDeCierre(b) - momentoDeCierre(a);
  return diferencia !== 0 && !Number.isNaN(diferencia) ? diferencia : a.id - b.id;
}

/**
 * Tareas de una columna, sin hitos. Abiertas por fin ascendente (sin fin al final); «Cerrado», solo lo
 * cerrado en los últimos 30 días y lo más reciente primero.
 */
export function tareasDeColumna(tareas: Tarea[], columna: Columna, catalogo: Catalogo, hoy: string): Tarea[] {
  const { hitos } = indices(catalogo);
  const desde = sumarDias(hoy, -DIAS_CERRADO);
  const deColumna = tareas.filter((t) => !hitos.has(t.tipoId) && columnaDeTarea(t, catalogo) === columna);
  if (columna !== 'cerrado') return deColumna.sort(porFin);
  return deColumna.filter((t) => fechaDeCierre(t) >= desde).sort(porCierreReciente);
}

export function contadores(tareas: Tarea[], catalogo: Catalogo, hoy: string): Contadores {
  const { cerrados, hitos } = indices(catalogo);
  const { lunes, domingo } = semanaDe(hoy);
  const enSemana = (fecha: string) => fecha >= lunes && fecha <= domingo;
  const cuentan = tareas.filter((t) => !hitos.has(t.tipoId));
  const abiertas = cuentan.filter((t) => !cerrados.has(t.estadoId));
  return {
    abiertas: abiertas.length,
    vencenSemana: abiertas.filter((t) => t.fin !== null && enSemana(t.fin)).length,
    vencidas: abiertas.filter((t) => vencida(t, hoy, catalogo)).length,
    cerradasSemana: cuentan.filter((t) => cerrados.has(t.estadoId) && enSemana(fechaDeCierre(t))).length,
  };
}

/** Lo que se ve en lugar de «Sin tareas» mientras el servidor trae los datos de OpenProject por primera vez. */
export const MSG_TRAYENDO = 'Trayendo tus tareas de OpenProject…';

/** «72 abiertas en 9 proyectos», sin hitos. */
export function resumenAbiertas(tareas: Tarea[], catalogo: Catalogo): string {
  const { cerrados, hitos } = indices(catalogo);
  const abiertas = tareas.filter((t) => !hitos.has(t.tipoId) && !cerrados.has(t.estadoId));
  if (abiertas.length === 0) return 'Sin tareas abiertas';
  const proyectos = new Set(abiertas.map((t) => t.proyectoId)).size;
  const n = abiertas.length;
  return `${n} ${n === 1 ? 'abierta' : 'abiertas'} en ${proyectos} ${proyectos === 1 ? 'proyecto' : 'proyectos'}`;
}

/** Minúsculas y sin tildes, para comparar texto libre. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-AR');
}

/** Sin hitos; el texto busca en título, proyecto y responsable, y tienen que aparecer todas sus palabras. */
export function filtrarTareas(tareas: Tarea[], filtro: FiltroTareas, catalogo: Catalogo, usuarioId: number): Tarea[] {
  const { hitos } = indices(catalogo);
  const altas = new Set(catalogo.prioridades.filter((p) => p.alta).map((p) => p.id));
  const proyectos = new Map(catalogo.proyectos.map((p) => [p.id, p.nombre]));
  const personas = new Map(catalogo.personas.map((p) => [p.id, p.nombre]));
  const palabras = normalizar(filtro.texto).split(/\s+/).filter(Boolean);
  const persona = filtro.persona === 'mias' ? usuarioId : filtro.persona;

  return tareas.filter((t) => {
    if (hitos.has(t.tipoId)) return false;
    if (filtro.proyectoId !== null && t.proyectoId !== filtro.proyectoId) return false;
    if (persona !== 'todas' && t.responsableId !== persona) return false;
    if (filtro.soloAltas && !altas.has(t.prioridadId)) return false;
    if (palabras.length === 0) return true;
    const responsable = t.responsableId === null ? '' : (personas.get(t.responsableId) ?? '');
    const pajar = normalizar(`${t.titulo} ${proyectos.get(t.proyectoId) ?? ''} ${responsable}`);
    return palabras.every((p) => pajar.includes(p));
  });
}

/** Hijas cerradas sobre el total de hijas (sin hitos); `null` si no tiene hijas. */
export function avanceSubtareas(tarea: Tarea, todas: Tarea[], catalogo: Catalogo): Avance | null {
  const { cerrados, hitos } = indices(catalogo);
  const hijas = todas.filter((t) => t.madreId === tarea.id && !hitos.has(t.tipoId));
  if (hijas.length === 0) return null;
  return { hechas: hijas.filter((t) => cerrados.has(t.estadoId)).length, total: hijas.length };
}

/** Avance de todas las madres de una vez (para no recorrer la lista por cada tarjeta). */
export function avancesPorMadre(todas: Tarea[], catalogo: Catalogo): Map<number, Avance> {
  const { cerrados, hitos } = indices(catalogo);
  const avances = new Map<number, Avance>();
  for (const t of todas) {
    if (t.madreId === null || hitos.has(t.tipoId)) continue;
    const previo = avances.get(t.madreId) ?? { hechas: 0, total: 0 };
    avances.set(t.madreId, { hechas: previo.hechas + (cerrados.has(t.estadoId) ? 1 : 0), total: previo.total + 1 });
  }
  return avances;
}
