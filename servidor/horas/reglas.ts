import type { Database } from 'better-sqlite3';
import { finDelDia, msDeReloj, msPropios } from '../../compartido/horas.js';
import type { Pedazo, Tramo } from '../../compartido/tipos.js';
import { abiertosDeTodos, cerrarTramoEn, conHorasExtra, contadosDelDia, pedazosDelDia, tramo } from './repositorio.js';

type Motivo = 'tope' | 'medianoche' | null;

/** Los pedazos tal como estaban en el instante `t`: lo posterior se descarta y lo que seguía corriendo termina en `t`. */
function recortar(pedazos: readonly Pedazo[], t: Date): Pedazo[] {
  const iso = t.toISOString();
  return pedazos
    .filter((p) => p.desde < iso)
    .map((p) => (p.hasta === null || p.hasta > iso ? { ...p, hasta: iso } : p));
}

/** Las horas de reloj del día de una persona en el instante `en`: con varias a la vez, cada momento cuenta una vez. */
export function totalDelDiaMs(db: Database, usuarioId: number, dia: string, en: Date): number {
  return msDeReloj(recortar(pedazosDelDia(db, usuarioId, dia), en), contadosDelDia(db, usuarioId, dia), en);
}

/** Cuánto cuenta `id` (abierto) en el instante `en`, en milisegundos: su tiempo entero, corra solo o con otros. */
export function msVivosDe(db: Database, t: Tramo, en: Date): number {
  return msPropios(recortar(pedazosDelDia(db, t.usuarioId, t.dia), en), en).get(t.id) ?? 0;
}

/**
 * Cierra `ids` (abiertos, de un mismo día) en `fin`. Cada uno cuenta su tiempo entero, sin pasar la jornada (salvo
 * un día con horas extra, que no tiene tope).
 */
export function cerrarTramos(db: Database, usuarioId: number, dia: string, ids: readonly number[], fin: Date, motivo: Motivo, jornadaMs: number): Tramo[] {
  return db.transaction(() => {
    const propios = msPropios(recortar(pedazosDelDia(db, usuarioId, dia), fin), fin);
    const tope = conHorasExtra(db, usuarioId, dia) ? Number.POSITIVE_INFINITY : jornadaMs;
    for (const id of ids) cerrarTramoEn(db, id, fin, Math.round(Math.min(propios.get(id) ?? 0, tope) / 1000), motivo);
    return ids.map((id) => tramo(db, id) as Tramo);
  })();
}

/** El primer instante en que el día llega a la jornada, entre `desde` y `hasta` (el total no baja nunca). */
function instanteDelTopeDelDia(db: Database, usuarioId: number, dia: string, desde: Date, hasta: Date, jornadaMs: number): Date {
  let [bajo, alto] = [desde.getTime(), hasta.getTime()];
  while (alto - bajo > 1) {
    const medio = Math.floor((bajo + alto) / 2);
    if (totalDelDiaMs(db, usuarioId, dia, new Date(medio)) >= jornadaMs) alto = medio;
    else bajo = medio;
  }
  return new Date(alto);
}

/**
 * Cierra en el instante justo lo que pasó el tope del día (`'tope'`) o la medianoche (`'medianoche'`). Un día con
 * horas extra no tiene tope: solo lo corta la medianoche. Devuelve los tramos que cerró, para cargarlos.
 */
export function aplicarFrenos(db: Database, ahora: Date, _feriados: ReadonlySet<string>, jornadaMs: number): Tramo[] {
  const grupos = new Map<string, Tramo[]>();
  for (const t of abiertosDeTodos(db)) {
    const clave = `${t.usuarioId}|${t.dia}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), t]);
  }
  const cerrados: Tramo[] = [];
  for (const abiertos of grupos.values()) {
    const { usuarioId, dia } = abiertos[0] as Tramo;
    const ids = abiertos.map((t) => t.id);
    const medianoche = finDelDia(dia);
    const limite = new Date(Math.min(ahora.getTime(), medianoche.getTime()));
    if (!conHorasExtra(db, usuarioId, dia) && totalDelDiaMs(db, usuarioId, dia, limite) >= jornadaMs) {
      const primero = new Date(Math.min(...abiertos.map((t) => Date.parse(t.inicio))));
      cerrados.push(...cerrarTramos(db, usuarioId, dia, ids, instanteDelTopeDelDia(db, usuarioId, dia, primero, limite, jornadaMs), 'tope', jornadaMs));
    } else if (ahora.getTime() >= medianoche.getTime()) {
      cerrados.push(...cerrarTramos(db, usuarioId, dia, ids, medianoche, 'medianoche', jornadaMs));
    }
  }
  return cerrados;
}
