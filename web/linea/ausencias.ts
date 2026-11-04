import type { ListaFeriados, MiembroEquipo, Tarea } from '../../compartido/tipos.js';

export interface Tramo { desde: string; hasta: string }

/** Feriados (puentes incluidos) dentro de la ventana, por fecha. */
export function feriadosEnVentana(lista: ListaFeriados | undefined, desde: string, hasta: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const f of lista?.feriados ?? []) if (f.fecha >= desde && f.fecha <= hasta) mapa.set(f.fecha, f.nombre);
  return mapa;
}

export function vacacionesPorPersona(equipo: readonly MiembroEquipo[] | undefined): Map<number, Tramo[]> {
  const mapa = new Map<number, Tramo[]>();
  for (const m of equipo ?? []) {
    if (m.vacaciones.length > 0) mapa.set(m.personaId, m.vacaciones.map((v) => ({ desde: v.desde, hasta: v.hasta })));
  }
  return mapa;
}

/** El primer tramo que se cruza con las fechas de la tarea (una sola fecha vale para las dos), bordes incluidos. */
export function tramoQuePisa(tarea: Pick<Tarea, 'inicio' | 'fin'>, tramos: readonly Tramo[] | undefined): Tramo | null {
  const inicio = tarea.inicio ?? tarea.fin;
  const fin = tarea.fin ?? tarea.inicio;
  if (!inicio || !fin || !tramos) return null;
  return tramos.find((t) => t.desde <= fin && t.hasta >= inicio) ?? null;
}

const dm = (f: string): string => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;

export function textoVacaciones(nombreCompleto: string, tramo: Tramo): string {
  const primero = nombreCompleto.trim().split(/\s+/)[0] ?? nombreCompleto;
  return `${primero} está de vacaciones del ${dm(tramo.desde)} al ${dm(tramo.hasta)}`;
}
