import type { Catalogo, Dependencia, Tarea } from '../../compartido/tipos.js';
import { columnaDeTarea } from '../tareas/logica.js';
import { calendarioDe, habilesEntre, siguienteHabil, sumarHabiles, type CalendarioOp } from '../../compartido/calendarioOp.js';

// Cascada de sucesoras manuales: qué tareas hay que correr para que ninguna quede pisada por su predecesora.

export interface Corrimiento {
  tareaId: number;
  titulo: string;
  antes: { inicio: string | null; fin: string | null };
  despues: { inicio: string; fin: string };
}

type Fechas = { inicio: string | null; fin: string | null };

/** Cuándo termina una tarea a efectos de las dependencias: su fin, o su única fecha. */
const finDe = (f: Fechas): string | null => f.fin ?? f.inicio;

/** Primer día hábil en que puede empezar una sucesora si su predecesora termina en `fin`, con un desfase de `lag` días hábiles. */
export const minimoPorDependencia = (fin: string, lag: number, cal: CalendarioOp): string => siguienteHabil(sumarHabiles(fin, Math.max(0, lag), cal), cal);

/** Mínimo según las predecesoras de `id`, mirando las fechas que da `fechasDe`; `null` si ninguna aporta. */
function minimoSegun(id: number, dependencias: Dependencia[], cal: CalendarioOp, fechasDe: (id: number) => Fechas | undefined, cerradas: ReadonlySet<number>): string | null {
  const minimos = dependencias
    .filter((d) => d.sucesoraId === id && !cerradas.has(d.predecesoraId))
    .flatMap((d) => {
      const fin = finDe(fechasDe(d.predecesoraId) ?? { inicio: null, fin: null });
      return fin ? [minimoPorDependencia(fin, d.lag, cal)] : [];
    });
  return minimos.length === 0 ? null : minimos.reduce((mayor, f) => (f > mayor ? f : mayor));
}

/** Primer día en que puede empezar `id` sin pisar a sus predecesoras abiertas con alguna fecha; `null` si no hay ninguna. */
export function inicioMinimo(
  id: number, tareas: Tarea[], dependencias: Dependencia[], cal: CalendarioOp, cerradas: ReadonlySet<number> = new Set(),
): string | null {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  return minimoSegun(id, dependencias, cal, (x) => porId.get(x), cerradas);
}

const idsCerradas = (tareas: Tarea[], catalogo: Catalogo): Set<number> =>
  new Set(tareas.filter((t) => columnaDeTarea(t, catalogo) === 'cerrado').map((t) => t.id));

/** Fechas de `id` corridas detrás de la anterior, con la misma duración hábil; `null` si no está pisada o está cerrada. */
export function fechasDetras(id: number, tareas: Tarea[], dependencias: Dependencia[], catalogo: Catalogo): { inicio: string; fin: string } | null {
  const tarea = tareas.find((t) => t.id === id);
  if (!tarea || columnaDeTarea(tarea, catalogo) === 'cerrado') return null;
  const inicio = tarea.inicio ?? tarea.fin;
  if (!inicio) return null;
  const cal = calendarioDe(catalogo);
  const minimo = inicioMinimo(id, tareas, dependencias, cal, idsCerradas(tareas, catalogo));
  if (minimo === null || inicio >= minimo) return null;
  if (catalogo.tipos.some((t) => t.esHito && t.id === tarea.tipoId)) return { inicio: minimo, fin: minimo };
  const duracion = Math.max(1, habilesEntre(inicio, tarea.fin ?? inicio, cal));
  return { inicio: minimo, fin: sumarHabiles(minimo, duracion - 1, cal) };
}

/** Sube por las predecesoras que terminan más tarde mientras la tarea sea automática; devuelve la primera manual o sin predecesoras. */
export function primeraQueSeMueve(id: number, tareas: Tarea[], dependencias: Dependencia[]): number {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const visitadas = new Set<number>();
  let actual = id;
  while (!visitadas.has(actual)) {
    visitadas.add(actual);
    if (porId.get(actual)?.programacionManual !== false) return actual;
    const preds = dependencias.filter((d) => d.sucesoraId === actual).map((d) => d.predecesoraId);
    if (preds.length === 0) return actual;
    const finDePred = (x: number): string => { const t = porId.get(x); return t ? (finDe(t) ?? '') : ''; };
    actual = preds.reduce((mejor, x) => (finDePred(x) > finDePred(mejor) ? x : mejor));
  }
  return actual;
}

/** Sucesoras alcanzables desde `desdeId`, en orden de descubrimiento (incluye a `desdeId`). */
function alcanzables(desdeId: number, ids: Set<number>, dependencias: Dependencia[]): number[] {
  const orden = [desdeId];
  const vistas = new Set<number>(orden);
  for (let i = 0; i < orden.length; i++) {
    for (const d of dependencias) {
      if (d.predecesoraId !== orden[i] || vistas.has(d.sucesoraId) || !ids.has(d.sucesoraId)) continue;
      vistas.add(d.sucesoraId);
      orden.push(d.sucesoraId);
    }
  }
  return orden;
}

/** Orden topológico del subgrafo; con un ciclo corta tomando la primera pendiente. */
function ordenTopologico(desdeId: number, alcance: number[], dependencias: Dependencia[]): number[] {
  const dentro = new Set(alcance);
  const aristas = dependencias.filter((d) => dentro.has(d.predecesoraId) && dentro.has(d.sucesoraId) && d.sucesoraId !== desdeId);
  const grado = new Map<number, number>(alcance.map((id) => [id, 0]));
  for (const a of aristas) grado.set(a.sucesoraId, (grado.get(a.sucesoraId) ?? 0) + 1);
  const hechas = new Set<number>();
  const orden: number[] = [];
  while (orden.length < alcance.length) {
    const id = alcance.find((x) => !hechas.has(x) && grado.get(x) === 0) ?? alcance.find((x) => !hechas.has(x))!;
    hechas.add(id);
    orden.push(id);
    for (const a of aristas) if (a.predecesoraId === id) grado.set(a.sucesoraId, (grado.get(a.sucesoraId) ?? 1) - 1);
  }
  return orden;
}

export function planCascada(
  desdeId: number,
  tareas: Tarea[],
  dependencias: Dependencia[],
  catalogo: Catalogo,
  cal: CalendarioOp,
): Corrimiento[] {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  if (!porId.has(desdeId)) return [];
  const hitos = new Set(catalogo.tipos.filter((t) => t.esHito).map((t) => t.id));
  // Fechas vigentes en el plan: las de la lista, salvo lo que ya se corrió.
  const fechas = new Map<number, Fechas>(tareas.map((t) => [t.id, { inicio: t.inicio, fin: t.fin }]));
  const corrimientos: Corrimiento[] = [];

  const orden = ordenTopologico(desdeId, alcanzables(desdeId, new Set(porId.keys()), dependencias), dependencias);
  for (const id of orden) {
    if (id === desdeId) continue;
    const tarea = porId.get(id)!;
    if (columnaDeTarea(tarea, catalogo) === 'cerrado' || !tarea.programacionManual) continue;
    const actual = fechas.get(id)!;
    if (!actual.inicio && !actual.fin) continue;
    const minimo = minimoSegun(id, dependencias, cal, (x) => fechas.get(x), new Set());
    if (minimo === null) continue;
    const inicio = actual.inicio ?? actual.fin!;
    if (inicio >= minimo) continue;
    const fin = actual.fin ?? inicio;
    const despues = hitos.has(tarea.tipoId)
      ? { inicio: minimo, fin: minimo }
      : { inicio: minimo, fin: sumarHabiles(minimo, Math.max(1, habilesEntre(inicio, fin, cal)) - 1, cal) };
    fechas.set(id, despues);
    corrimientos.push({ tareaId: id, titulo: tarea.titulo, antes: { inicio: tarea.inicio, fin: tarea.fin }, despues });
  }
  return corrimientos;
}
