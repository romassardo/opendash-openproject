import type { Feriado, MiembroEquipo, Persona } from '../../compartido/tipos.js';
import { aUtc, semanaDe, sumarDias } from '../fechas.js';

// Quién no está de lunes a viernes de esta semana: vacaciones y feriados que se cargan en OpenDash.
// Nada sale del calendario de Outlook.

/** Un tramo seguido de días hábiles. null = empezó antes de esta semana / sigue después de esta semana (los dos null = «toda la semana»). */
export interface TramoAusencia {
  desde: string | null;
  hasta: string | null;
}

export type Ausencia =
  | { tipo: 'feriado'; fecha: string; nombre: string }
  | { tipo: 'vacaciones'; personaId: number; nombre: string; esYo: boolean; tramos: TramoAusencia[] };

const DIAS_HABILES = 5;
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Los cinco días hábiles que se muestran: la semana de `hoy`, o la siguiente si hoy es sábado o domingo. */
function diasDeLaSemana(hoy: string): string[] {
  const dia = aUtc(hoy).getUTCDay();
  const lunes = dia === 0 || dia === 6 ? sumarDias(semanaDe(hoy).lunes, 7) : semanaDe(hoy).lunes;
  return Array.from({ length: DIAS_HABILES }, (_, i) => sumarDias(lunes, i));
}

const diaCorto = (fecha: string): string => {
  const [, mes, dia] = fecha.split('-');
  return `${DIAS[aUtc(fecha).getUTCDay()]} ${Number(dia)}/${Number(mes)}`;
};

/** Tramos de días consecutivos (por posición en la semana) entre los días cubiertos. */
function corridas(dias: string[], cubiertos: ReadonlySet<string>): string[][] {
  const salida: string[][] = [];
  let actual: string[] = [];
  for (const dia of dias) {
    if (cubiertos.has(dia)) actual = [...actual, dia];
    else if (actual.length > 0) {
      salida.push(actual);
      actual = [];
    }
  }
  return actual.length > 0 ? [...salida, actual] : salida;
}

export function quienFalta(hoy: string, miembros: MiembroEquipo[], personas: Persona[], feriados: Feriado[], yoId: number): Ausencia[] {
  const dias = diasDeLaSemana(hoy);
  const primero = dias[0] ?? hoy;
  const ultimo = dias[DIAS_HABILES - 1] ?? hoy;
  const nombres = new Map(personas.map((p) => [p.id, p.nombre]));

  const vacaciones = miembros.flatMap((m): Ausencia[] => {
    const nombre = nombres.get(m.personaId);
    if (nombre === undefined) return [];
    // Se arman tramos propios sobre los cinco días hábiles de la semana (no se reusa finDeVacaciones de equipo.ts, que
    // sigue una vacación entera): los tramos seguidos, o con solo un fin de semana en el medio, se unen solos.
    const cubiertos = new Set(dias.filter((d) => m.vacaciones.some((v) => v.desde <= d && d <= v.hasta)));
    const tramos = corridas(dias, cubiertos).map((corrida): TramoAusencia => {
      const desde = corrida[0] ?? primero;
      const hasta = corrida[corrida.length - 1] ?? ultimo;
      return { desde: desde === primero ? null : desde, hasta: hasta === ultimo ? null : hasta };
    });
    // Una sola fila por persona, aunque falte en tramos separados.
    return tramos.length === 0 ? [] : [{ tipo: 'vacaciones', personaId: m.personaId, nombre, esYo: m.personaId === yoId, tramos }];
  });

  const dePrimerDia = (a: Ausencia): string =>
    a.tipo === 'feriado' ? a.fecha : (a.tramos[0]?.desde ?? primero);
  const deFeriado = feriados
    .filter((f) => dias.includes(f.fecha))
    .map((f): Ausencia => ({ tipo: 'feriado', fecha: f.fecha, nombre: f.nombre }));

  return [...vacaciones, ...deFeriado].sort((a, b) =>
    dePrimerDia(a).localeCompare(dePrimerDia(b)) || a.nombre.localeCompare(b.nombre, 'es-AR'),
  );
}

function textoTramo(t: TramoAusencia): string {
  if (t.desde === null) return t.hasta === null ? 'toda la semana' : `de vacaciones hasta el ${diaCorto(t.hasta)}`;
  if (t.hasta === null) return `desde el ${diaCorto(t.desde)}`;
  return t.desde === t.hasta ? `el ${diaCorto(t.desde)}` : `desde el ${diaCorto(t.desde)} hasta el ${diaCorto(t.hasta)}`;
}

export function textoAusencia(a: Ausencia): string {
  if (a.tipo === 'feriado') return `${diaCorto(a.fecha)} · feriado`;
  return `${a.esYo ? 'Vos' : a.nombre} · ${a.tramos.map(textoTramo).join(' y ')}`;
}
