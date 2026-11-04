import { SEMANAS_CARGA_MAXIMAS } from '../../compartido/calendario.js';
import type { Tramo } from '../../compartido/pausas.js';
import type { Catalogo, Tarea } from '../../compartido/tipos.js';
import { diasEntre, diasLaborables, semanaDe, sumarDias } from '../fechas.js';
import { columnaDeTarea } from '../tareas/logica.js';

// Carga de una persona en la semana, la quincena o el mes (spec §7.7). Lógica pura: `hoy` entra como parámetro.

export type PeriodoCarga = 'semana' | 'quincena' | 'mes';
export const PERIODOS_CARGA: PeriodoCarga[] = ['semana', 'quincena', 'mes'];
/** La quincena es esta semana y la siguiente; el mes, cuatro semanas desde el lunes actual. */
const SEMANAS_DEL_PERIODO: Record<PeriodoCarga, number> = { semana: 1, quincena: 2, mes: SEMANAS_CARGA_MAXIMAS };

export interface IntervaloCarga { desde: string; hasta: string }
export interface ParametrosCarga { horasPorDefecto: number; horasSemanaLargas: number }
export interface TareaLarga {
  tareaId: number; titulo: string; inicio: string; fin: string;
  semanaActual: number; semanasTotales: number; horasSemana: number;
}
export interface CargaPersona { personaId: number; horas: number; capacidad: number; excedida: boolean; abiertas: number; largas: TareaLarga[] }

const DIAS_TAREA_LARGA = 31;
const DIAS_LABORABLES_SEMANA = 5;

/** Una tarea es larga si tiene inicio y fin y dura más de 31 días corridos. */
export function esLarga(tarea: Tarea): boolean {
  return tarea.inicio !== null && tarea.fin !== null && diasEntre(tarea.inicio, tarea.fin) > DIAS_TAREA_LARGA;
}

const acotar = (valor: number, minimo: number, maximo: number): number => Math.min(maximo, Math.max(minimo, valor));

/** Los tramos de trabajo de una tarea con pausas (los días de pausa no son carga); `null` si no tiene pausas. */
export type TrabajoDe = (tarea: Tarea) => readonly Tramo[] | null;

/** Días laborables trabajados en los tramos hasta `hoy` (todos, si `hoy` es posterior). */
const laborablesHasta = (tramos: readonly Tramo[], hoy: string): number =>
  tramos.filter((t) => t.desde <= hoy).reduce((suma, t) => suma + diasLaborables(t.desde, t.hasta < hoy ? t.hasta : hoy), 0);

/** Del lunes de la semana de `hoy` al domingo de la última semana del período. */
export function intervaloCarga(hoy: string, periodo: PeriodoCarga): IntervaloCarga {
  const { lunes, domingo } = semanaDe(hoy);
  return { desde: lunes, hasta: sumarDias(domingo, 7 * (SEMANAS_DEL_PERIODO[periodo] - 1)) };
}

/** `true` si la tarea está en curso o su trabajo (sin las pausas) se cruza con el período. */
function cuentaEnPeriodo(tarea: Tarea, enCurso: boolean, intervalo: IntervaloCarga, trabajo: readonly Tramo[] | null): boolean {
  if (enCurso) return true;
  if (trabajo !== null) return trabajo.some((t) => t.desde <= intervalo.hasta && t.hasta >= intervalo.desde);
  const inicio = tarea.inicio ?? tarea.fin;
  const fin = tarea.fin ?? tarea.inicio;
  if (inicio === null || fin === null) return false;
  return inicio <= intervalo.hasta && fin >= intervalo.desde;
}

/** Semanas del período (de lunes a domingo) que se cruzan con algún tramo de trabajo de la tarea. */
function semanasQueToca(tramos: readonly Tramo[], intervalo: IntervaloCarga, semanas: number): number {
  return Array.from({ length: semanas }, (_, i) => sumarDias(intervalo.desde, 7 * i))
    .filter((lunes) => tramos.some((t) => t.desde <= sumarDias(lunes, 6) && t.hasta >= lunes)).length;
}

/** Una tarea larga reparte sus horas por las semanas en las que se trabaja (las de pausa no cuentan). */
function tareaLarga(tarea: Tarea & { inicio: string; fin: string }, tramos: readonly Tramo[], parametros: ParametrosCarga, hoy: string): TareaLarga {
  const semanasTotales = Math.max(1, Math.ceil(laborablesHasta(tramos, tarea.fin) / DIAS_LABORABLES_SEMANA));
  const horasSemana = tarea.estimacionHoras !== null ? tarea.estimacionHoras / semanasTotales : parametros.horasSemanaLargas;
  const semanaActual = acotar(Math.floor((laborablesHasta(tramos, hoy) - 1) / DIAS_LABORABLES_SEMANA) + 1, 1, semanasTotales);
  return { tareaId: tarea.id, titulo: tarea.titulo, inicio: tarea.inicio, fin: tarea.fin, semanaActual, semanasTotales, horasSemana };
}

/**
 * Horas de la persona en el período contra su capacidad semanal multiplicada por las semanas del período
 * (o contra `capacidadPeriodo`, ya ajustada por feriados, vacaciones y reuniones).
 * Una tarea común suma una vez; una larga suma sus horas por semana en cada semana del período en la que cae,
 * y una larga en curso que no cae en ninguna suma una semana, como en la vista semanal.
 * Con `trabajoDe`, los días de pausa de cada tarea no cuentan.
 */
export function cargaDePersona(
  personaId: number, tareas: Tarea[], catalogo: Catalogo, capacidadSemanal: number, parametros: ParametrosCarga, hoy: string,
  periodo: PeriodoCarga = 'semana', capacidadPeriodo?: number, trabajoDe: TrabajoDe = () => null,
): CargaPersona {
  const hitos = new Set(catalogo.tipos.filter((t) => t.esHito).map((t) => t.id));
  const abiertasTodas = tareas.filter((t) => !hitos.has(t.tipoId) && columnaDeTarea(t, catalogo) !== 'cerrado');
  const conHijasAbiertas = new Set(abiertasTodas.map((t) => t.madreId).filter((id): id is number => id !== null));
  const mias = abiertasTodas.filter((t) => t.responsableId === personaId);
  const semanas = SEMANAS_DEL_PERIODO[periodo];
  const intervalo = intervaloCarga(hoy, periodo);
  const capacidad = capacidadPeriodo ?? capacidadSemanal * semanas;

  let horas = 0;
  const largas: TareaLarga[] = [];
  for (const tarea of mias) {
    const trabajo = trabajoDe(tarea);
    const sumaHoras = !conHijasAbiertas.has(tarea.id) && cuentaEnPeriodo(tarea, columnaDeTarea(tarea, catalogo) === 'curso', intervalo, trabajo);
    if (tarea.inicio !== null && tarea.fin !== null && esLarga(tarea)) {
      const tramos = trabajo ?? [{ desde: tarea.inicio, hasta: tarea.fin }];
      const larga = tareaLarga({ ...tarea, inicio: tarea.inicio, fin: tarea.fin }, tramos, parametros, hoy);
      largas.push(larga);
      if (sumaHoras) horas += larga.horasSemana * Math.max(1, semanasQueToca(tramos, intervalo, semanas));
    } else if (sumaHoras) {
      horas += tarea.estimacionHoras ?? parametros.horasPorDefecto;
    }
  }
  return { personaId, horas, capacidad, excedida: horas > capacidad, abiertas: mias.length, largas };
}

export interface TotalesCarga { horas: number; capacidad: number; libres: number }

/** Totales del equipo. Las libres son lo que le queda a cada uno: quien se pasa no descuenta de los demás. */
export function totalesCarga(cargas: CargaPersona[]): TotalesCarga {
  return cargas.reduce(
    (total, c) => ({
      horas: total.horas + c.horas,
      capacidad: total.capacidad + c.capacidad,
      libres: total.libres + Math.max(0, c.capacidad - c.horas),
    }),
    { horas: 0, capacidad: 0, libres: 0 },
  );
}
