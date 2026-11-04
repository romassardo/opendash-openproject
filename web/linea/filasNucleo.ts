import type { EstiloProyecto, Tono } from '../../compartido/estilos.js';
import { claveContenedor, type OrdenLinea } from '../../compartido/linea.js';
import type { Catalogo, Columna, Dependencia, Tarea } from '../../compartido/tipos.js';
import { diasEntre } from '../fechas.js';
import { columnaDeTarea, type Avance } from '../tareas/logica.js';
import { finEfectivo, inicioEfectivo, tieneFechas, type Vista, type Ventana } from './modelo.js';
import { aplicarOrden } from './ordenLista.js';

// Piezas comunes para armar las filas de la línea de tiempo: tipos, contexto, barras y el árbol de una franja. Todo puro.

export interface BarraFila {
  x: number; ancho: number; esHito: boolean; columna: Columna; empiezaAntes: boolean;
  sigueHasta: string | null; sinInicio: boolean; sinFin: boolean; conflicto: boolean;
  /**
   * Una terminada que cae entera fuera de la ventana: en vez de barra va una marca en ese borde con su fecha
   * (el fin si terminó antes, el inicio si empieza después). `null` si se dibuja la barra.
   */
  fuera: { lado: 'antes' | 'despues'; fecha: string } | null;
}

export type Fila =
  | { tipo: 'encabezado'; clave: string; titulo: string; tono: Tono | null; personaId: number | null; proyectoId: number | null; esYo: boolean; resumen: string }
  | { tipo: 'proyecto'; clave: string; proyectoId: number; titulo: string; tono: Tono }
  | { tipo: 'grupo'; clave: string; tarea: Tarea; nivel: number; abierto: boolean; avance: Avance; barra: BarraFila | null; contenedor: string | null; indice: number; ajena: boolean }
  | { tipo: 'tarea'; clave: string; tarea: Tarea; nivel: number; barra: BarraFila; contenedor: string | null; indice: number }
  /** `cantidad`: las cerradas con fechas de la franja, caigan o no en la ventana. */
  | { tipo: 'terminadas'; clave: string; franja: string; cantidad: number; visibles: boolean };

export interface OpcionesFilas {
  vista: Vista; soloConDependencias: boolean; proyectoId: number | null; personaId: number | null;
  plegados: ReadonlySet<number>; orden: OrdenLinea;
  /** Id de OpenProject de quien mira: su franja va primera y lleva «vos». */
  yoId: number | null;
  /** Claves de franja (`persona-9`, `proyecto-3`, `todas`, `sin-asignar`) con las terminadas a la vista. */
  terminadasVisibles: ReadonlySet<string>;
  /** Tareas recién creadas desde la línea: se ven aunque los filtros de arriba las escondan. */
  siempreVisibles?: ReadonlySet<number>;
}

export interface Contexto {
  tareas: Tarea[]; dependencias: Dependencia[]; catalogo: Catalogo; v: Ventana; o: OpcionesFilas;
  estilos: Record<number, EstiloProyecto>;
  conDependencias: Set<number>; enConflicto: Set<number>; avances: Map<number, Avance>;
  hijasDe: Map<number, Tarea[]>; madreDe: Map<number, number | null>; esHito: (t: Tarea) => boolean;
}

/** Cómo se recorre el árbol dentro de una franja. */
export interface Alcance {
  franja: string;
  /** Prefijo de las claves de tarea y grupo: vacío en Por proyecto y Todas, `<franja>:` en Por persona. */
  prefijo: string;
  /** Si las filas llevan el contenedor del orden compartido (⠿). */
  conContenedor: boolean;
  /** Persona de la franja (`null` en «Sin asignar»); solo importa en Por persona. */
  personaId: number | null;
  porPersona: boolean;
  /** ¿La tarea es de la franja? Las demás solo aparecen como madres de contexto. */
  propia: (t: Tarea) => boolean;
  verTerminadas: boolean;
}

export const SIN_AVANCE: Avance = { hechas: 0, total: 0 };

export const esCerrada = (t: Tarea, c: Contexto): boolean => columnaDeTarea(t, c.catalogo) === 'cerrado';

export function pasaFiltros(t: Tarea, c: Contexto): boolean {
  if (c.o.siempreVisibles?.has(t.id)) return true;
  return (c.o.proyectoId === null || t.proyectoId === c.o.proyectoId)
    && (c.o.personaId === null || t.responsableId === c.o.personaId)
    && (!c.o.soloConDependencias || c.conDependencias.has(t.id));
}

const enVentana = (t: Tarea, c: Contexto): boolean => tieneFechas(t) && finEfectivo(t) >= c.v.desde && inicioEfectivo(t) <= c.v.hasta;

/** Con fechas dentro de la ventana y pasando los filtros de arriba (cerrada o no). */
export const esDibujable = (t: Tarea, c: Contexto): boolean => enVentana(t, c) && pasaFiltros(t, c);

/** Cerrada con fechas que pasa los filtros de arriba, caiga o no en la ventana. */
export const esTerminadaConFechas = (t: Tarea, c: Contexto): boolean => esCerrada(t, c) && tieneFechas(t) && pasaFiltros(t, c);

/**
 * ¿Se dibuja esta tarea en la franja? Las abiertas, si caen en la ventana. Las cerradas, solo si la franja las
 * muestra, y entonces todas: las de fuera de la ventana van con una marca en el borde.
 */
function dibujaEnFranja(t: Tarea, c: Contexto, a: Alcance): boolean {
  if (!a.propia(t)) return false;
  return esCerrada(t, c) ? a.verTerminadas && esTerminadaConFechas(t, c) : esDibujable(t, c);
}

export function barraDe(t: Tarea, c: Contexto): BarraFila {
  const { v } = c;
  const inicio = inicioEfectivo(t);
  const fin = finEfectivo(t);
  const desdeVisible = inicio < v.desde ? v.desde : inicio;
  const hastaVisible = fin > v.hasta ? v.hasta : fin;
  const fuera = fin < v.desde ? { lado: 'antes' as const, fecha: fin } : inicio > v.hasta ? { lado: 'despues' as const, fecha: inicio } : null;
  return {
    x: diasEntre(v.desde, desdeVisible) * v.pxPorDia,
    ancho: (diasEntre(desdeVisible, hastaVisible) + 1) * v.pxPorDia,
    esHito: c.esHito(t),
    columna: columnaDeTarea(t, c.catalogo),
    empiezaAntes: inicio < v.desde,
    sigueHasta: fin > v.hasta ? fin : null,
    sinInicio: t.inicio === null,
    sinFin: t.fin === null,
    conflicto: c.enConflicto.has(t.id),
    fuera,
  };
}

export function resumenDe(abiertas: number, sinFechas: number): string {
  const base = `${abiertas} ${abiertas === 1 ? 'abierta' : 'abiertas'}`;
  return sinFechas > 0 ? `${base} · ${sinFechas} sin fechas` : base;
}

export const nombreProyecto = (id: number, c: Contexto): string => c.catalogo.proyectos.find((p) => p.id === id)?.nombre ?? `Proyecto ${id}`;
export const nombrePersona = (id: number, c: Contexto): string => c.catalogo.personas.find((p) => p.id === id)?.nombre ?? `Persona ${id}`;

/** ¿Se dibuja la tarea o alguna descendiente suya en la franja? Si es así, hay fila. */
function hayFila(t: Tarea, c: Contexto, a: Alcance, memo: Map<number, boolean>): boolean {
  const guardado = memo.get(t.id);
  if (guardado !== undefined) return guardado;
  memo.set(t.id, false); // corta ciclos de madres
  const resultado = dibujaEnFranja(t, c, a) || (c.hijasDe.get(t.id) ?? []).some((h) => hayFila(h, c, a, memo));
  memo.set(t.id, resultado);
  return resultado;
}

function barraDeGrupo(t: Tarea, c: Contexto, ajena: boolean): BarraFila | null {
  // La madre ajena es contexto: su barra sale de sus fechas y la ventana, sin los filtros de arriba.
  const dibuja = ajena ? enVentana(t, c) : esDibujable(t, c);
  return dibuja ? barraDe(t, c) : null;
}

function filasDeTarea(t: Tarea, nivel: number, contenedor: string, indice: number, c: Contexto, a: Alcance, memo: Map<number, boolean>): Fila[] {
  const hijas = c.hijasDe.get(t.id) ?? [];
  const clave = `${a.prefijo}t${t.id}`;
  const contenedorFila = a.conContenedor ? contenedor : null;
  if (hijas.length === 0) {
    return dibujaEnFranja(t, c, a)
      ? [{ tipo: 'tarea', clave, tarea: t, nivel, barra: barraDe(t, c), contenedor: contenedorFila, indice }]
      : [];
  }
  const abierto = !c.o.plegados.has(t.id);
  const ajena = a.porPersona && t.responsableId !== a.personaId;
  const grupo: Fila = {
    tipo: 'grupo', clave, tarea: t, nivel, abierto, avance: c.avances.get(t.id) ?? SIN_AVANCE,
    barra: barraDeGrupo(t, c, ajena), contenedor: contenedorFila, indice, ajena,
  };
  return [grupo, ...(abierto ? filasDeContenedor(hijas, t.proyectoId, t.id, nivel + 1, c, a, memo) : [])];
}

/** Las filas de un contenedor (las raíces de un proyecto o las hijas de una madre), en el orden compartido. */
export function filasDeContenedor(tareas: Tarea[], proyectoId: number, madreId: number | null, nivel: number, c: Contexto, a: Alcance, memo: Map<number, boolean>): Fila[] {
  const clave = claveContenedor(proyectoId, madreId);
  const visibles = aplicarOrden(tareas, c.o.orden[clave], c.dependencias).filter((t) => hayFila(t, c, a, memo));
  return visibles.flatMap((t, indice) => filasDeTarea(t, nivel, clave, indice, c, a, memo));
}

/** Renglón «✓ N terminadas» al final de una franja: cuenta las cerradas con fechas, caigan o no en la ventana. */
export function filaTerminadas(f: Franja, c: Contexto): Fila[] {
  const cantidad = f.terminadas.length;
  return cantidad === 0 ? [] : [{ tipo: 'terminadas', clave: `terminadas:${f.clave}`, franja: f.clave, cantidad, visibles: c.o.terminadasVisibles.has(f.clave) }];
}

/**
 * La madre que cuenta para dibujar: solo si está en la lista y es del mismo proyecto
 * (si no, la tarea es raíz de su proyecto). Las tareas dentro de un ciclo de madres quedan como raíces.
 */
export function madresEfectivas(tareas: Tarea[]): Map<number, number | null> {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const directa = (t: Tarea): number | null => {
    const m = t.madreId === null ? undefined : porId.get(t.madreId);
    return m !== undefined && m.proyectoId === t.proyectoId ? m.id : null;
  };
  const resultado = new Map<number, number | null>();
  for (const t of tareas) {
    const visto = new Set<number>([t.id]);
    let actual = directa(t);
    let enCiclo = false;
    while (actual !== null) {
      if (actual === t.id) { enCiclo = true; break; }
      if (visto.has(actual)) break;
      visto.add(actual);
      actual = directa(porId.get(actual)!);
    }
    resultado.set(t.id, enCiclo ? null : directa(t));
  }
  return resultado;
}

/** Las tareas raíz de un proyecto (sin madre efectiva). */
export function raicesDe(proyectoId: number, c: Contexto): Tarea[] {
  return c.tareas.filter((t) => t.proyectoId === proyectoId && c.madreDe.get(t.id) === null);
}

/** Una franja: lo que se ve de una persona, un proyecto o todo, y sus conteos. */
export interface Franja {
  clave: string; titulo: string; tono: Tono | null; personaId: number | null; proyectoId: number | null;
  /** Con fechas en la ventana y pasando los filtros, cerradas o no. */
  dibujadas: Tarea[]; abiertas: number; sinFechas: number;
  /** Cerradas con fechas que pasan los filtros, dentro o fuera de la ventana. */
  terminadas: Tarea[];
}
