import { cuentaComoReunion, enCurso } from '../../compartido/calendario.js';
import type { Catalogo, EstadoHoras, Reunion, Tarea } from '../../compartido/tipos.js';
import { fechaArgentina, instanteArgentino, rangoDias, semanaDe, sumarDias } from '../fechas.js';
import { tareasVencidas } from '../ordenar/logica.js';
import { columnaDeTarea, esHitoDe } from '../tareas/logica.js';
import { plural } from '../ui/plural.js';

// Lógica pura de la pantalla Inicio. `hoy` es 'YYYY-MM-DD' en hora argentina y entra como parámetro.

const SEG_HORA = 3600;
const HORA_MANANA = 5;
const HORA_TARDE = 12;
const HORA_NOCHE = 20;

const formatoHora = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hourCycle: 'h23' });
const formatoDia = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** «Buen día, Ramiro»: según la hora argentina y el primer nombre. */
export function saludo(nombre: string, ahora: Date): string {
  const hora = Number(formatoHora.format(ahora));
  const parte = hora >= HORA_MANANA && hora < HORA_TARDE ? 'Buen día' : hora >= HORA_TARDE && hora < HORA_NOCHE ? 'Buenas tardes' : 'Buenas noches';
  const primerNombre = nombre.trim().split(/\s+/)[0] ?? '';
  return primerNombre ? `${parte}, ${primerNombre}` : parte;
}

const diaDeCierre = (tarea: Tarea): string => (tarea.cerradaEl === null ? '' : fechaArgentina(tarea.cerradaEl));

function porFinYId(a: Tarea, b: Tarea): number {
  const finA = a.fin ?? '';
  const finB = b.fin ?? '';
  if (finA !== finB) return finA < finB ? -1 : 1;
  return a.id - b.id;
}

export function resumenHoy(
  tareas: Tarea[], catalogo: Catalogo, usuarioId: number, hoy: string,
): { hechas: number; paraHoy: number; vencidas: number; mias: Tarea[] } {
  const esHito = esHitoDe(catalogo);
  const cerrada = (t: Tarea): boolean => columnaDeTarea(t, catalogo) === 'cerrado';
  const propias = tareas.filter((t) => t.responsableId === usuarioId && !esHito(t));
  const hechas = propias.filter((t) => cerrada(t) && diaDeCierre(t) === hoy).length;
  const mias = propias.filter((t) => !cerrada(t) && t.fin !== null && t.fin <= hoy).sort(porFinYId);
  // El número enlaza a «Para ordenar»: cuenta con su misma regla, no con la lista de «para hoy».
  const vencidas = tareasVencidas({ tareas, catalogo, hoy }, usuarioId, null).length;
  return { hechas, paraHoy: hechas + mias.length, vencidas, mias };
}

/**
 * «lunes 19 de octubre · 3 reuniones y 5 tareas para hoy». `reunionesHoy` es null si no hay calendario conectado;
 * sin reuniones el subtítulo es el de siempre.
 */
export function subtituloInicio(hoy: string, paraHoy: number, reunionesHoy: number | null = null): string {
  const dia = formatoDia.format(new Date(`${hoy}T00:00:00Z`)).replace(',', '');
  const reuniones = reunionesHoy ?? 0;
  if (reuniones === 0) {
    return `${dia} · ${paraHoy === 0 ? 'nada pendiente para hoy' : `${plural(paraHoy, 'tarea', 'tareas')} para hoy`}`;
  }
  const cuantas = paraHoy === 0
    ? plural(reuniones, 'reunión', 'reuniones')
    : `${plural(reuniones, 'reunión', 'reuniones')} y ${plural(paraHoy, 'tarea', 'tareas')}`;
  return `${dia} · ${cuantas} para hoy`;
}

export interface AgendaHoy {
  /** Las que cuentan y empiezan hoy, por hora de inicio. */
  reuniones: Reunion[];
  /** Cuántas ya terminaron. */
  pasadas: number;
  actual: Reunion | null;
  siguiente: Reunion | null;
}

/** La agenda de hoy: solo reuniones que cuentan (con horario y no «libre») que se superponen con el día argentino, aunque vengan de ayer. */
export function agendaDeHoy(reuniones: Reunion[], hoy: string, ahora: Date): AgendaHoy {
  const momento = ahora.getTime();
  const inicioDia = instanteArgentino(hoy).getTime();
  const finDia = instanteArgentino(sumarDias(hoy, 1)).getTime();
  const deHoy = reuniones
    .filter((r) => cuentaComoReunion(r) && Date.parse(r.inicio) < finDia && Date.parse(r.fin) > inicioDia)
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio) || a.id.localeCompare(b.id));
  const activas = deHoy.filter((r) => enCurso(r, ahora));
  return {
    reuniones: deHoy,
    pasadas: deHoy.filter((r) => Date.parse(r.fin) <= momento).length,
    actual: activas.at(-1) ?? null,
    siguiente: deHoy.find((r) => Date.parse(r.inicio) > momento) ?? null,
  };
}

export function semanaEquipo(
  tareas: Tarea[], catalogo: Catalogo, hoy: string,
): { dias: { fecha: string; cantidad: number }[]; total: number; anterior: number; variacion: number | null } {
  const esHito = esHitoDe(catalogo);
  const porDia = new Map<string, number>();
  for (const t of tareas) {
    if (esHito(t) || columnaDeTarea(t, catalogo) !== 'cerrado') continue;
    const dia = diaDeCierre(t);
    if (dia) porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }
  const { lunes, domingo } = semanaDe(hoy);
  const suma = (desde: string, hasta: string): number => rangoDias(desde, hasta).reduce((acc, d) => acc + (porDia.get(d) ?? 0), 0);
  const dias = rangoDias(lunes, domingo).map((fecha) => ({ fecha, cantidad: porDia.get(fecha) ?? 0 }));
  const total = suma(lunes, hoy);
  const anterior = suma(sumarDias(lunes, -7), sumarDias(hoy, -7));
  return { dias, total, anterior, variacion: anterior > 0 ? Math.round(((total - anterior) / anterior) * 100) : null };
}

/** Horas trabajadas hoy contra la jornada del día (las dos en horas), para el contador y el anillo. */
export function horasDeHoy(estado: EstadoHoras): { horas: number; meta: number } {
  return { horas: estado.totalHoySegundos / SEG_HORA, meta: estado.jornadaSegundos / SEG_HORA };
}

const formatoHoras = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

/** Horas con un decimal y coma: «1,1 h», «2 h». */
export function horasTexto(horas: number): string {
  return `${formatoHoras.format(horas)} h`;
}

/** Tareas abiertas de la persona (sin hitos) por título: lo que puede elegir para enfocarse. */
export function abiertasPropias(tareas: Tarea[], catalogo: Catalogo, usuarioId: number): Tarea[] {
  const esHito = esHitoDe(catalogo);
  return tareas
    .filter((t) => t.responsableId === usuarioId && !esHito(t) && columnaDeTarea(t, catalogo) !== 'cerrado')
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es-AR') || a.id - b.id);
}
