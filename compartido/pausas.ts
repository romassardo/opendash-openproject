import { habilesEntre, restarHabiles, sumarHabiles, type CalendarioOp } from './calendarioOp.js';
import { sumarDias } from './fechas.js';
import type { Tarea } from './tipos.js';

// Pausas de una tarea, como «Dividir tarea» de Project. OpenProject no las tiene: viven en OpenDash y son relativas a
// la tarea (si la tarea se mueve, se mueven con ella). En OpenProject el fin se corre los días hábiles que dura cada
// pausa, así lo que espera a la tarea se corre y el trabajo no cambia. Todo puro.

/** Después de `despues` días hábiles de trabajo, `dias` días hábiles sin trabajo. */
export interface Pausa { id: number; tareaId: number; despues: number; dias: number }
export type PausaNueva = Pick<Pausa, 'despues' | 'dias'>;
/** Las pausas de cada tarea, como las devuelve `GET /api/pausas`. */
export type PausasPorTarea = Record<number, Pausa[]>;

export interface Tramo { desde: string; hasta: string }
/** Una pausa ubicada en el calendario: del primer al último día hábil sin trabajo que caen dentro de la tarea. */
export interface TramoPausa extends Tramo { id: number; dias: number }
/** Cómo queda la tarea en el calendario: sus tramos de trabajo, sus pausas y cuántos días hábiles se trabajan. */
export interface Partes { trabajo: Tramo[]; pausas: TramoPausa[]; trabajados: number }

export const MAX_DIAS_PAUSA = 366;

/** Por qué no se puede pausar la tarea, o `null` si se puede. */
export function motivoSinPausa(tarea: Pick<Tarea, 'inicio' | 'fin' | 'programacionManual'>, esHito: boolean, tieneHijas: boolean): string | null {
  if (esHito) return 'Un hito no se puede pausar.';
  if (tarea.inicio === null || tarea.fin === null) return 'Para pausarla, la tarea tiene que tener inicio y fin.';
  if (tieneHijas && !tarea.programacionManual) return 'Sus fechas salen de sus subtareas: pausá las subtareas.';
  return null;
}

/**
 * Parte la tarea en tramos de trabajo y pausas. Los fines de semana y feriados quedan dentro del tramo en el que
 * caen; una pausa que pasa el fin de la tarea (alguien la acortó en OpenProject) se corta ahí, y una que ya no
 * entra no se dibuja.
 */
export function partesDe(inicio: string, fin: string, pausas: readonly (PausaNueva & { id?: number })[], cal: CalendarioOp): Partes {
  const orden = [...pausas].sort((a, b) => a.despues - b.despues || (a.id ?? 0) - (b.id ?? 0));
  const trabajo: Tramo[] = [];
  const enPausa: TramoPausa[] = [];
  let trabajados = 0;
  let siguiente = 0;
  let restantes = 0;
  let tramoTrabajo: Tramo | null = null;
  let tramoPausa: TramoPausa | null = null;
  for (let dia = inicio; dia <= fin; dia = sumarDias(dia, 1)) {
    if (!cal.esHabil(dia)) continue;
    if (restantes === 0 && trabajados > 0) {
      while (siguiente < orden.length && orden[siguiente]!.despues < trabajados) siguiente++;
      const pausa = orden[siguiente];
      if (pausa !== undefined && pausa.despues === trabajados) {
        siguiente++;
        restantes = pausa.dias;
        tramoPausa = { id: pausa.id ?? 0, desde: dia, hasta: dia, dias: 0 };
        enPausa.push(tramoPausa);
        tramoTrabajo = null;
      }
    }
    if (restantes > 0 && tramoPausa !== null) {
      tramoPausa.hasta = dia;
      tramoPausa.dias++;
      restantes--;
      continue;
    }
    if (tramoTrabajo === null) {
      tramoTrabajo = { desde: dia, hasta: dia };
      trabajo.push(tramoTrabajo);
    } else {
      tramoTrabajo.hasta = dia;
    }
    trabajados++;
  }
  return { trabajo, pausas: enPausa, trabajados };
}

/**
 * La pausa que se pide con fechas («del 5 al 9 de noviembre»), pasada a días de trabajo: o el texto de por qué no
 * se puede. Tiene que empezar después del primer día de trabajo, dejar trabajo para después y no cruzarse con otra.
 */
export function pausaDesdeFechas(
  inicio: string, fin: string, pausas: readonly Pausa[], desde: string, hasta: string, cal: CalendarioOp,
): PausaNueva | string {
  if (hasta < desde) return 'La pausa no puede terminar antes de empezar.';
  if (desde <= inicio) return 'La pausa tiene que empezar después del primer día de la tarea.';
  if (desde > fin) return 'La pausa tiene que empezar antes de que termine la tarea.';
  const dias = habilesEntre(desde, hasta, cal);
  if (dias === 0) return 'Entre esas fechas no hay días hábiles.';
  if (dias > MAX_DIAS_PAUSA) return `Una pausa puede durar hasta ${MAX_DIAS_PAUSA} días hábiles.`;
  const partes = partesDe(inicio, fin, pausas, cal);
  if (partes.pausas.some((p) => p.desde <= hasta && p.hasta >= desde)) return 'Se cruza con otra pausa de la tarea.';
  const anterior = sumarDias(desde, -1);
  const despues = partes.trabajo
    .filter((t) => t.desde <= anterior)
    .reduce((suma, t) => suma + habilesEntre(t.desde, t.hasta < anterior ? t.hasta : anterior, cal), 0);
  if (despues === 0) return 'La pausa tiene que empezar después del primer día de trabajo.';
  if (despues >= partes.trabajados) return 'Desde esa fecha ya no queda trabajo en la tarea.';
  return { despues, dias };
}

/** Por qué no entra una pausa ya pasada a días de trabajo (lo que valida el servidor), o `null` si entra. */
export function motivoPausaInvalida(inicio: string, fin: string, pausas: readonly Pausa[], nueva: PausaNueva, cal: CalendarioOp): string | null {
  if (nueva.despues >= partesDe(inicio, fin, pausas, cal).trabajados) return 'Desde ahí ya no queda trabajo en la tarea.';
  if (pausas.some((p) => p.despues === nueva.despues)) return 'Ya hay una pausa en ese lugar de la tarea.';
  return null;
}

/** El fin de la tarea con una pausa más: el trabajo no cambia, así que se corre los días hábiles de la pausa. */
export const finConPausa = (fin: string, dias: number, cal: CalendarioOp): string => sumarHabiles(fin, dias, cal);

/**
 * El fin de la tarea sin esa pausa: vuelve los días hábiles que la pausa ocupa dentro de la tarea.
 * `null` si la pausa ya no cae dentro de la tarea (no hay que tocar las fechas).
 */
export function finSinPausa(inicio: string, fin: string, pausas: readonly Pausa[], pausaId: number, cal: CalendarioOp): string | null {
  const dias = partesDe(inicio, fin, pausas, cal).pausas.filter((p) => p.id === pausaId).reduce((suma, p) => suma + p.dias, 0);
  return dias === 0 ? null : restarHabiles(fin, dias, cal);
}
