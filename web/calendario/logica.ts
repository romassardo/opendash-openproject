import { cuentaComoReunion } from '../../compartido/calendario.js';
import type { Catalogo, Plataforma, Reunion, Tarea, VentanaFechas } from '../../compartido/tipos.js';
import { fechaArgentina, hoyArgentina, mesDe, rangoDias, semanaDe, sumarDias } from '../fechas.js';
import { columnaDeTarea, esHitoDe } from '../tareas/logica.js';

// Lógica pura de la pantalla Calendario. Fechas 'YYYY-MM-DD' en hora argentina; `hoy` entra como parámetro.

export type VistaCalendario = 'mes' | 'semana';
export interface DiaGrilla { fecha: string; delMes: boolean; esHoy: boolean }

const SEMANAS_DEL_MES = 6;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MS_MINUTO = 60_000;
const conMayuscula = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1);
const diaDeSemana = (fecha: string): string => DIAS[new Date(`${fecha}T00:00:00Z`).getUTCDay()] ?? '';

/** Siempre 6 semanas de lunes a domingo; las de otros meses van con `delMes: false`. */
export function semanasDelMes(fecha: string, hoy: string): DiaGrilla[][] {
  const primero = `${mesDe(fecha)}-01`;
  const lunes = semanaDe(primero).lunes;
  return Array.from({ length: SEMANAS_DEL_MES }, (_, s) =>
    Array.from({ length: 7 }, (_, d) => {
      const dia = sumarDias(lunes, s * 7 + d);
      return { fecha: dia, delMes: mesDe(dia) === mesDe(fecha), esHoy: dia === hoy };
    }));
}

/** Días que se ven, ambos incluidos: la grilla de 42 días o la semana. */
export function rangoVisible(vista: VistaCalendario, fecha: string): { desde: string; hasta: string } {
  if (vista === 'semana') {
    const { lunes, domingo } = semanaDe(fecha);
    return { desde: lunes, hasta: domingo };
  }
  const desde = semanaDe(`${mesDe(fecha)}-01`).lunes;
  return { desde, hasta: sumarDias(desde, SEMANAS_DEL_MES * 7 - 1) };
}

/** Mes: el mismo día del mes anterior o siguiente, acotado a su largo; semana: ±7 días. */
export function moverFecha(vista: VistaCalendario, fecha: string, sentido: -1 | 1): string {
  if (vista === 'semana') return sumarDias(fecha, sentido * 7);
  const [anio, mes, dia] = fecha.split('-').map(Number) as [number, number, number];
  const destino = new Date(Date.UTC(anio, mes - 1 + sentido, 1));
  const largo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth(), Math.min(dia, largo))).toISOString().slice(0, 10);
}

/** Último día que toca: un fin justo a medianoche (día entero, fin exclusivo) no cuenta como ese día. */
function ultimoDia(r: Reunion): string {
  const inicio = fechaArgentina(r.inicio);
  const fin = Date.parse(r.fin);
  if (Number.isNaN(fin) || fin <= Date.parse(r.inicio)) return inicio;
  const ultimo = fechaArgentina(new Date(fin - 1).toISOString());
  return ultimo < inicio ? inicio : ultimo;
}

/** Reuniones por día argentino: las de varios días van en cada día que tocan; en cada día, por inicio. */
export function reunionesPorDia(reuniones: Reunion[]): Map<string, Reunion[]> {
  const mapa = new Map<string, Reunion[]>();
  for (const r of reuniones) {
    const primero = fechaArgentina(r.inicio);
    if (primero === '') continue;
    for (const dia of rangoDias(primero, ultimoDia(r))) mapa.set(dia, [...(mapa.get(dia) ?? []), r]);
  }
  for (const [dia, lista] of mapa) {
    mapa.set(dia, [...lista].sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio) || a.id.localeCompare(b.id)));
  }
  return mapa;
}

/** Las reuniones que cuentan y tocan la semana (lunes a domingo) de `hoy`. */
export function reunionesDeLaSemana(reuniones: Reunion[], hoy: string): number {
  const { lunes, domingo } = semanaDe(hoy);
  return reuniones.filter((r) => {
    if (!cuentaComoReunion(r)) return false;
    const primero = fechaArgentina(r.inicio);
    return primero !== '' && primero <= domingo && ultimoDia(r) >= lunes;
  }).length;
}

/** Lo que vence cada día: las tareas propias abiertas por su fin, y los hitos abiertos por fin ?? inicio. */
export function vencimientosPorDia(tareas: Tarea[], catalogo: Catalogo, yoId: number): Map<string, Tarea[]> {
  const esHito = esHitoDe(catalogo);
  const mapa = new Map<string, Tarea[]>();
  for (const t of tareas) {
    if (columnaDeTarea(t, catalogo) === 'cerrado') continue;
    const dia = esHito(t) ? (t.fin ?? t.inicio) : t.responsableId === yoId ? t.fin : null;
    if (dia) mapa.set(dia, [...(mapa.get(dia) ?? []), t]);
  }
  return mapa;
}

/** «Octubre 2026». */
export function tituloMes(fecha: string): string {
  const [anio, mes] = fecha.split('-') as [string, string];
  return `${conMayuscula(MESES[Number(mes) - 1] ?? '')} ${anio}`;
}

/** «miércoles 21 de octubre». */
export function diaLargo(fecha: string): string {
  const [, mes, dia] = fecha.split('-') as [string, string, string];
  return `${diaDeSemana(fecha)} ${Number(dia)} de ${MESES[Number(mes) - 1] ?? ''}`;
}

/** «Mié» para el encabezado de la grilla, a partir del lunes (0) al domingo (6). */
export const NOMBRES_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

const formatoHora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });

/** Solo se arman enlaces http(s): lo que viene de afuera no puede traer `javascript:` ni otros esquemas. */
export const enlaceSeguro = (enlace: string | null): string | null => (enlace !== null && /^https?:\/\//i.test(enlace) ? enlace : null);

/** «9:30», en hora argentina; '' si no es una fecha. */
export function horaTexto(instante: string): string {
  const momento = new Date(instante);
  return Number.isNaN(momento.getTime()) ? '' : formatoHora.format(momento).replace(/^0(\d)/, '$1');
}

/** «9:15» si es de hoy, «ayer 9:15» si es de ayer, «el 20/10 9:15» si es de antes (días y hora argentinos); '' si no es una fecha. */
export function desdeCuando(instante: string, ahora: Date): string {
  const dia = fechaArgentina(instante);
  if (!dia) return '';
  const hoy = hoyArgentina(ahora);
  const hora = horaTexto(instante);
  if (dia === hoy) return hora;
  if (dia === sumarDias(hoy, -1)) return `ayer ${hora}`;
  const [, mes, numero] = dia.split('-');
  return `el ${Number(numero)}/${Number(mes)} ${hora}`;
}

/** Si lo que se mira (días 'YYYY-MM-DD', ambos incluidos) se sale de lo que el servidor guarda. */
export function fueraDeVentana(desde: string, hasta: string, ventana: VentanaFechas): boolean {
  return desde < ventana.desde || hasta > ventana.hasta;
}

const diaCorto = (fecha: string): string => {
  const [anio, mes, dia] = fecha.split('-');
  return `${Number(dia)}/${Number(mes)}/${anio}`;
};

/** El aviso de qué fechas guarda el servidor. */
export function textoVentana(ventana: VentanaFechas): string {
  return `Las reuniones se guardan del ${diaCorto(ventana.desde)} al ${diaCorto(ventana.hasta)}; fuera de esas fechas no se ven.`;
}

/** «15 min», «1 h», «1,5 h»; «Todo el día» si dura el día entero. */
export function duracionTexto(r: Reunion): string {
  if (r.diaEntero) return 'Todo el día';
  const minutos = Math.max(0, Math.round((Date.parse(r.fin) - Date.parse(r.inicio)) / MS_MINUTO));
  if (minutos < 60) return `${minutos} min`;
  return `${String(Math.round((minutos / 60) * 10) / 10).replace('.', ',')} h`;
}

/** Color de la barra de cada plataforma. */
export function colorPlataforma(plataforma: Plataforma | null): string {
  switch (plataforma) {
    case 'teams': return 'var(--tono-indigo)';
    case 'meet': return 'var(--tono-verde)';
    case 'zoom': return 'var(--tono-azul)';
    default: return 'var(--tono-naranja)';
  }
}

/** Título del panel: «Hoy» o «Miércoles 21 oct». */
export function tituloDia(fecha: string, hoy: string, corto: (f: string) => string): string {
  return fecha === hoy ? 'Hoy' : `${conMayuscula(diaDeSemana(fecha))} ${corto(fecha)}`;
}
