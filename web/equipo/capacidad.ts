import type { MiembroEquipo } from '../../compartido/tipos.js';
import { aUtc, rangoDias } from '../fechas.js';
import type { IntervaloCarga } from './carga.js';

// Capacidad de una persona en un período, ajustada por feriados, vacaciones y reuniones (spec §6). Lógica pura.

export interface AjusteCapacidad {
  capacidad: number;
  /** Los feriados de lunes a viernes del período. */
  feriados: string[];
  /** Las vacaciones que tocan el período. */
  vacaciones: { desde: string; hasta: string }[];
  /** Horas de reunión restadas; `null` con la opción apagada. */
  horasReunion: number | null;
  sinCalendario: boolean;
}

const DIAS_LABORABLES_SEMANA = 5;

const esHabil = (fecha: string): boolean => {
  const dia = aUtc(fecha).getUTCDay();
  return dia !== 0 && dia !== 6;
};

const redondear = (valor: number): number => Math.round(valor * 100) / 100;

/** Los feriados que caen de lunes a viernes dentro del intervalo, en orden. */
export function feriadosDelPeriodo(feriados: ReadonlySet<string>, intervalo: IntervaloCarga): string[] {
  return rangoDias(intervalo.desde, intervalo.hasta).filter((dia) => esHabil(dia) && feriados.has(dia));
}

/** Los días de lunes a viernes del intervalo que caen en una vacación y no son feriado. */
export function diasDeVacaciones(ajuste: AjusteCapacidad, intervalo: IntervaloCarga): number {
  return rangoDias(intervalo.desde, intervalo.hasta)
    .filter((dia) => esHabil(dia) && !ajuste.feriados.includes(dia) && ajuste.vacaciones.some((v) => v.desde <= dia && dia <= v.hasta))
    .length;
}

/** Los lunes de las semanas del intervalo. */
function lunesDelIntervalo({ desde, hasta }: IntervaloCarga): string[] {
  return rangoDias(desde, hasta).filter((dia) => aUtc(dia).getUTCDay() === 1);
}

export function capacidadDelPeriodo(
  capacidadSemanal: number, intervalo: IntervaloCarga, feriados: ReadonlySet<string>,
  miembro: Pick<MiembroEquipo, 'vacaciones' | 'reunionesPorSemana'> | undefined,
): AjusteCapacidad {
  const delPeriodo = feriadosDelPeriodo(feriados, intervalo);
  const vacaciones = (miembro?.vacaciones ?? []).filter((v) => v.desde <= intervalo.hasta && v.hasta >= intervalo.desde);
  const deVacaciones = (dia: string): boolean => vacaciones.some((v) => v.desde <= dia && dia <= v.hasta);
  const libres = rangoDias(intervalo.desde, intervalo.hasta)
    .filter((dia) => esHabil(dia) && !feriados.has(dia) && !deVacaciones(dia)).length;
  const bruta = redondear((libres * capacidadSemanal) / DIAS_LABORABLES_SEMANA);

  const reuniones = miembro?.reunionesPorSemana ?? null;
  const pedidas = reuniones !== null && typeof reuniones === 'object'
    ? lunesDelIntervalo(intervalo).reduce((total, lunes) => total + (reuniones[lunes] ?? 0), 0)
    : null;
  const horasReunion = pedidas === null ? null : Math.min(pedidas, bruta);

  return {
    capacidad: redondear(bruta - (horasReunion ?? 0)),
    feriados: delPeriodo,
    vacaciones,
    horasReunion,
    sinCalendario: reuniones === 'sin-calendario',
  };
}
