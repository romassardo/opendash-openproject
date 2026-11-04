import type { Catalogo, Columna, Dependencia, Tarea } from '../../compartido/tipos.js';
import { diaMesCorto } from '../fechas.js';
import { columnaDeTarea } from '../tareas/logica.js';
import { calendarioDe } from '../../compartido/calendarioOp.js';
import { minimoPorDependencia } from './cascada.js';

// Cadena de dependencias de una tarea: de quién depende y a quién frena.

const ETIQUETA_COLUMNA: Record<Columna, string> = { nuevo: 'nuevo', curso: 'en curso', pausa: 'en pausa', cerrado: 'cerrado' };

/** Recorre el grafo desde `id` por un solo sentido, sin repetir (termina aunque haya ciclos). */
function alcanzables(id: number, vecinos: Map<number, number[]>): Set<number> {
  const vistos = new Set<number>();
  const pendientes = [id];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    for (const vecino of vecinos.get(actual) ?? []) {
      if (vistos.has(vecino)) continue;
      vistos.add(vecino);
      pendientes.push(vecino);
    }
  }
  return vistos;
}

function indexar(dependencias: Dependencia[], clave: 'sucesoraId' | 'predecesoraId', valor: 'sucesoraId' | 'predecesoraId'): Map<number, number[]> {
  const indice = new Map<number, number[]>();
  for (const d of dependencias) indice.set(d[clave], [...(indice.get(d[clave]) ?? []), d[valor]]);
  return indice;
}

/** La tarea, todas sus predecesoras y todas sus sucesoras (transitivas, sin repetir). */
export function cadena(id: number, dependencias: Dependencia[]): Set<number> {
  const haciaAtras = alcanzables(id, indexar(dependencias, 'sucesoraId', 'predecesoraId'));
  const haciaAdelante = alcanzables(id, indexar(dependencias, 'predecesoraId', 'sucesoraId'));
  return new Set([id, ...haciaAtras, ...haciaAdelante]);
}

/** A quién espera la tarea (predecesoras directas) y a quién frena (sucesoras directas). */
export function esperaYFrena(id: number, dependencias: Dependencia[]): { espera: number[]; frena: number[] } {
  return {
    espera: dependencias.filter((d) => d.sucesoraId === id).map((d) => d.predecesoraId),
    frena: dependencias.filter((d) => d.predecesoraId === id).map((d) => d.sucesoraId),
  };
}

/**
 * Ids de las dependencias en conflicto: la sucesora (abierta) empieza antes del primer día hábil que deja la predecesora
 * (abierta, con alguna fecha) más el desfase. Usa el calendario de OpenProject.
 */
export function conflictos(tareas: Tarea[], dependencias: Dependencia[], catalogo: Catalogo): Set<number> {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const cal = calendarioDe(catalogo);
  const abierta = (t: Tarea): boolean => columnaDeTarea(t, catalogo) !== 'cerrado';
  const enConflicto = new Set<number>();
  for (const d of dependencias) {
    const pred = porId.get(d.predecesoraId);
    const suc = porId.get(d.sucesoraId);
    if (!pred || !suc || !abierta(pred) || !abierta(suc)) continue;
    const fin = pred.fin ?? pred.inicio;
    const inicio = suc.inicio ?? suc.fin;
    if (!fin || !inicio) continue;
    if (inicio < minimoPorDependencia(fin, d.lag, cal)) enConflicto.add(d.id);
  }
  return enConflicto;
}

const terminaEn = (t: Tarea): string => t.fin ?? t.inicio ?? '';

/** Para cada sucesora en conflicto, la predecesora en conflicto que termina más tarde (la que manda). Una sola pasada. */
export function anterioresEnConflicto(tareas: Tarea[], dependencias: Dependencia[], catalogo: Catalogo): Map<number, Tarea> {
  const malas = conflictos(tareas, dependencias, catalogo);
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const manda = new Map<number, Tarea>();
  for (const d of dependencias) {
    if (!malas.has(d.id)) continue;
    const pred = porId.get(d.predecesoraId);
    if (!pred) continue;
    const previa = manda.get(d.sucesoraId);
    if (previa === undefined || terminaEn(pred) > terminaEn(previa)) manda.set(d.sucesoraId, pred);
  }
  return manda;
}

/** La predecesora en conflicto de `sucesoraId` que termina más tarde (la que manda); `null` si no hay conflicto. */
export function anteriorEnConflicto(sucesoraId: number, tareas: Tarea[], dependencias: Dependencia[], catalogo: Catalogo): Tarea | null {
  return anterioresEnConflicto(tareas, dependencias, catalogo).get(sucesoraId) ?? null;
}

function detalleDePredecesora(pred: Tarea, hayConflicto: boolean, catalogo: Catalogo): string {
  const columna = columnaDeTarea(pred, catalogo);
  if (columna === 'cerrado') return `${pred.titulo} (✓ ya está cerrada)`;
  if (hayConflicto) return `${pred.titulo} (⚠ empieza antes de que termine)`;
  const termina = pred.fin ? `, termina ${diaMesCorto(pred.fin)}` : '';
  return `${pred.titulo} (${ETIQUETA_COLUMNA[columna]}${termina})`;
}

/** «Espera a: … · Frena a: …» para el detalle de una barra; «nada» si no tiene dependencias. */
export function textoCadena(id: number, tareas: Tarea[], dependencias: Dependencia[], catalogo: Catalogo): string {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const enConflicto = conflictos(tareas, dependencias, catalogo);
  const espera = dependencias
    .filter((d) => d.sucesoraId === id)
    .flatMap((d) => {
      const pred = porId.get(d.predecesoraId);
      return pred ? [detalleDePredecesora(pred, enConflicto.has(d.id), catalogo)] : [];
    });
  const frena = esperaYFrena(id, dependencias).frena.flatMap((sucesoraId) => porId.get(sucesoraId)?.titulo ?? []);
  const partes = [
    ...(espera.length > 0 ? [`Espera a: ${espera.join(', ')}`] : []),
    ...(frena.length > 0 ? [`Frena a: ${frena.join(', ')}`] : []),
  ];
  return partes.length > 0 ? partes.join(' · ') : 'nada';
}
