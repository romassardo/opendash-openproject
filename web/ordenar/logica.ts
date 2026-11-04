import type { PausasPorTarea } from '../../compartido/pausas.js';
import type { AjustesMetricas, Catalogo, Dependencia, MiembroEquipo, Tarea } from '../../compartido/tipos.js';
import { armarEquipo } from '../equipo/equipo.js';
import { PERIODOS_CARGA, type PeriodoCarga } from '../equipo/carga.js';
import { anteriorEnConflicto, conflictos } from '../linea/cadena.js';
import { primeraQueSeMueve } from '../linea/cascada.js';
import { columnaDeTarea, esHitoDe, vencida } from '../tareas/logica.js';

// Lógica pura de «Para ordenar» (spec tanda 2, punto 2). `hoy` es 'YYYY-MM-DD' en hora argentina.

export type SeccionTareas = 'pisan' | 'vencidas' | 'sinFechas' | 'sinAsignar';
export interface FilaTarea {
  seccion: SeccionTareas; tarea: Tarea; motivo: string;
  /** 'pisan': la anterior que manda. */ anteriorId: number | null;
  /** Sucesora automática: la tarea cuyas fechas hay que cambiar (primeraQueSeMueve); si no, null. */ moverId: number | null;
}
export interface FilaSobrecarga { personaId: number; periodo: PeriodoCarga; horas: number; capacidad: number }
export interface ParaOrdenar { pisan: FilaTarea[]; vencidas: FilaTarea[]; sinFechas: FilaTarea[]; sinAsignar: FilaTarea[]; sobrecarga: FilaSobrecarga[] }
export interface FiltroOrdenar { persona: 'mias' | 'todas' | number; proyectoId: number | null }
export interface EntradaOrdenar {
  tareas: Tarea[]; dependencias: Dependencia[]; catalogo: Catalogo; miembros: MiembroEquipo[];
  metricas: AjustesMetricas; feriados: ReadonlySet<string>; yoId: number; hoy: string;
  /** Pausas de las tareas: sus días no cuentan como carga. */
  pausas?: PausasPorTarea;
}

const diaMes = (fecha: string): string => `${Number(fecha.slice(8, 10))}/${Number(fecha.slice(5, 7))}`;
const fechaDe = (t: Tarea): string => t.inicio ?? t.fin ?? '';
const porTexto = (a: string, b: string): number => a.localeCompare(b, 'es-AR');

function dueño(filtro: FiltroOrdenar, yoId: number): number | null {
  if (filtro.persona === 'mias') return yoId;
  return filtro.persona === 'todas' ? null : filtro.persona;
}

/** Tareas candidatas: abiertas, de proyectos activos que no son plantilla, y del proyecto elegido. */
function candidatas(e: Pick<EntradaOrdenar, 'tareas' | 'catalogo'>, proyectoId: number | null): Tarea[] {
  const fuera = new Set([...e.catalogo.plantillas, ...e.catalogo.proyectos.filter((p) => !p.activo).map((p) => p.id)]);
  return e.tareas.filter((t) =>
    columnaDeTarea(t, e.catalogo) !== 'cerrado' && !fuera.has(t.proyectoId) && (proyectoId === null || t.proyectoId === proyectoId));
}

/**
 * Abiertas candidatas que no tienen hijas abiertas (de una madre cuenta lo de sus hijas). Las madres se calculan sobre las
 * abiertas sin el filtro de proyecto: una madre con una hija abierta en otro proyecto sigue siendo madre.
 */
function sinMadresDe(e: Pick<EntradaOrdenar, 'tareas' | 'catalogo'>, proyectoId: number | null): Tarea[] {
  const madres = new Set(candidatas(e, null).map((t) => t.madreId).filter((id): id is number => id !== null));
  return candidatas(e, proyectoId).filter((t) => !madres.has(t.id));
}

/**
 * La regla única de «Vencidas»: abiertas, de proyectos activos que no son plantilla, sin hijas abiertas, con `vencida()`
 * (fin, o inicio si no hay fin). Sirve a «Para ordenar» y al número de Inicio. `personaId` null = de todas.
 */
export function tareasVencidas(
  e: Pick<EntradaOrdenar, 'tareas' | 'catalogo' | 'hoy'>, personaId: number | null, proyectoId: number | null = null,
): Tarea[] {
  return sinMadresDe(e, proyectoId).filter((t) => (personaId === null || t.responsableId === personaId) && vencida(t, e.hoy, e.catalogo));
}

function fila(seccion: SeccionTareas, tarea: Tarea, motivo: string, anteriorId: number | null, moverId: number | null): FilaTarea {
  return { seccion, tarea, motivo, anteriorId, moverId };
}

export function armarParaOrdenar(e: EntradaOrdenar, filtro: FiltroOrdenar): ParaOrdenar {
  const abiertas = candidatas(e, filtro.proyectoId);
  const esHito = esHitoDe(e.catalogo);
  const persona = dueño(filtro, e.yoId);
  const mia = (t: Tarea): boolean => persona === null || t.responsableId === persona;
  const conPred = new Set(e.dependencias.map((d) => d.sucesoraId));
  const moverDe = (t: Tarea): number | null => {
    if (t.programacionManual || !conPred.has(t.id)) return null;
    const id = primeraQueSeMueve(t.id, e.tareas, e.dependencias);
    return id === t.id ? null : id;
  };
  const motivoMover = (t: Tarea, moverId: number | null, normal: string): string => {
    const titulo = moverId === null ? undefined : e.tareas.find((x) => x.id === moverId)?.titulo;
    return titulo === undefined ? normal : `se corre sola: mové «${titulo}»`;
  };

  const malas = conflictos(e.tareas, e.dependencias, e.catalogo);
  const sucesorasPisadas = new Set(e.dependencias.filter((d) => malas.has(d.id)).map((d) => d.sucesoraId));
  const pisan = abiertas
    .filter((t) => sucesorasPisadas.has(t.id) && mia(t))
    .flatMap((t) => {
      const anterior = anteriorEnConflicto(t.id, e.tareas, e.dependencias, e.catalogo);
      return anterior === null ? [] : [fila('pisan', t, `empieza antes de que termine «${anterior.titulo}»`, anterior.id, moverDe(t))];
    })
    .sort((a, b) => porTexto(fechaDe(a.tarea), fechaDe(b.tarea)) || a.tarea.id - b.tarea.id);

  const sinMadres = sinMadresDe(e, filtro.proyectoId);
  const vencidas = tareasVencidas(e, persona, filtro.proyectoId)
    .map((t) => { const m = moverDe(t); return fila('vencidas', t, motivoMover(t, m, `venció el ${diaMes(t.fin ?? t.inicio ?? '')}`), null, m); })
    .sort((a, b) => porTexto(a.tarea.fin ?? a.tarea.inicio ?? '', b.tarea.fin ?? b.tarea.inicio ?? '') || a.tarea.id - b.tarea.id);
  const sinFechas = sinMadres
    .filter((t) => mia(t) && t.inicio === null && t.fin === null)
    .map((t) => { const m = moverDe(t); return fila('sinFechas', t, motivoMover(t, m, 'no tiene fechas'), null, m); })
    .sort((a, b) => a.tarea.id - b.tarea.id);
  const nombreProyecto = (id: number): string => e.catalogo.proyectos.find((p) => p.id === id)?.nombre ?? '';
  const sinAsignar = sinMadres
    .filter((t) => t.responsableId === null && !esHito(t))
    .map((t) => fila('sinAsignar', t, 'sin responsable', null, null))
    .sort((a, b) => porTexto(nombreProyecto(a.tarea.proyectoId), nombreProyecto(b.tarea.proyectoId)) || porTexto(a.tarea.titulo, b.tarea.titulo));

  return { pisan, vencidas, sinFechas, sinAsignar, sobrecarga: sobrecargaDe(e, filtro, persona) };
}

/**
 * «Más trabajo del que entra» usa exactamente los números de Equipo (`armarEquipo(...).carga`): las tareas van tal cual, sin
 * sacar las de proyectos archivados ni plantillas, a propósito, para que las dos pantallas muestren las mismas horas.
 */
function sobrecargaDe(e: EntradaOrdenar, filtro: FiltroOrdenar, persona: number | null): FilaSobrecarga[] {
  const porPeriodo = PERIODOS_CARGA.map((periodo) => ({
    periodo,
    equipo: armarEquipo(e.catalogo, e.tareas, e.miembros, e.metricas, e.yoId, e.hoy, filtro.proyectoId, periodo, e.feriados, e.pausas),
  }));
  const personas = porPeriodo[0]?.equipo.map((i) => i.persona) ?? [];
  return personas
    .filter((p) => persona === null || p.id === persona)
    .flatMap((p) => {
      for (const { periodo, equipo } of porPeriodo) {
        const carga = equipo.find((i) => i.persona.id === p.id)?.carga;
        if (carga?.excedida) return [{ personaId: p.id, periodo, horas: carga.horas, capacidad: carga.capacidad, nombre: p.nombre }];
      }
      return [];
    })
    .sort((a, b) => (a.personaId === e.yoId) === (b.personaId === e.yoId) ? porTexto(a.nombre, b.nombre) : a.personaId === e.yoId ? -1 : 1)
    .map(({ nombre: _nombre, ...fila }) => fila);
}

/** Para el número del menú: tareas distintas tuyas en pisan, vencidas y sin fechas, más 1 si tenés sobrecarga. */
export function cuentaMia(entrada: EntradaOrdenar): number {
  const r = armarParaOrdenar(entrada, { persona: 'mias', proyectoId: null });
  const tareas = new Set([...r.pisan, ...r.vencidas, ...r.sinFechas].map((f) => f.tarea.id));
  return tareas.size + (r.sobrecarga.length > 0 ? 1 : 0);
}
