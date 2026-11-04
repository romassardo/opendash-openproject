import type { CalendarioOp } from '../../compartido/calendarioOp.js';
import type { Tarea } from '../../compartido/tipos.js';
import { diaMesCorto, rangoDias, semanaDe, sumarDias } from '../fechas.js';

// Modelo de la línea de tiempo: ventana de días visibles y fechas de cada tarea. Todo puro y determinista.

export type Zoom = 'semana' | 'mes' | 'trimestre';
export type Vista = 'proyecto' | 'persona' | 'todas';

export const PX_POR_DIA: Record<Zoom, number> = { semana: 48, mes: 16, trimestre: 5 };

export interface Ventana { desde: string; hasta: string; pxPorDia: number; dias: number }

function ventanaDe(desde: string, dias: number, pxPorDia: number): Ventana {
  return { desde, hasta: sumarDias(desde, dias - 1), pxPorDia, dias };
}

/** Ventana que arranca en `desde` y llena `anchoPx`. */
export function ventanaDesde(desde: string, zoom: Zoom, anchoPx: number): Ventana {
  const pxPorDia = PX_POR_DIA[zoom];
  return ventanaDe(desde, Math.max(1, Math.floor(anchoPx / pxPorDia)), pxPorDia);
}

/**
 * La ventana llena `anchoPx` con `hoy` hacia la mitad y arranca un lunes: a más tardar el de la semana anterior,
 * así siempre se ven la semana anterior y la actual (si con eso hoy entra).
 */
export function ventanaInicial(zoom: Zoom, anchoPx: number, hoy: string): Ventana {
  const v = ventanaDesde(hoy, zoom, anchoPx);
  const centrado = desdeParaVer(hoy, v);
  const anterior = sumarDias(semanaDe(hoy).lunes, -7);
  const desde = anterior < centrado && sumarDias(anterior, v.dias - 1) >= hoy ? anterior : centrado;
  return ventanaDesde(desde, zoom, anchoPx);
}

/** Corre la ventana media ventana hacia atrás (-1) o hacia adelante (1). */
export function moverVentana(v: Ventana, sentido: -1 | 1): Ventana {
  return ventanaDe(sumarDias(v.desde, sentido * Math.floor(v.dias / 2)), v.dias, v.pxPorDia);
}

/** Primer día de la ventana tras arrastrar el fondo `dx` px, de a un día: hacia la derecha trae los días anteriores. */
export function desdeTrasArrastre(desde: string, dx: number, pxPorDia: number): string {
  return sumarDias(desde, -Math.round(dx / pxPorDia) || 0);
}

/**
 * Desde dónde arrancar una ventana del mismo ancho para que `fecha` quede a la vista, hacia la mitad: el lunes más
 * cercano a media ventana antes; si con eso no entra (ventana de menos de una semana), la misma fecha.
 */
export function desdeParaVer(fecha: string, v: Ventana): string {
  const lunes = semanaDe(sumarDias(fecha, 3 - Math.floor(v.dias / 2))).lunes;
  return lunes <= fecha && sumarDias(lunes, v.dias - 1) >= fecha ? lunes : fecha;
}

/**
 * Días no hábiles de la ventana según OpenProject (fines de semana y días que cargó), sin los feriados, que tienen
 * su propio sombreado. En Trimestre no hay: con 5 px por día quedaría un rayado que tapa las barras.
 */
export function noLaborablesEnVentana(v: Ventana, zoom: Zoom, cal: CalendarioOp, feriados: ReadonlyMap<string, string>): string[] {
  if (zoom === 'trimestre') return [];
  return rangoDias(v.desde, v.hasta).filter((fecha) => !cal.esHabil(fecha) && !feriados.has(fecha));
}

export interface Marca { fecha: string; texto: string }

const formatoDiaSemana = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' });
const formatoMesAnio = new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const sinPuntos = (texto: string): string => texto.replace(/\./g, '').trim();
const aFecha = (fecha: string): Date => new Date(`${fecha}T00:00:00Z`);

/** Marcas del encabezado: cada día («lun 19»), cada lunes («19 oct») o cada 1.º de mes («oct 2026»). */
export function marcasDe(v: Ventana, zoom: Zoom): Marca[] {
  const dias = rangoDias(v.desde, v.hasta);
  if (zoom === 'semana') {
    return dias.map((fecha) => ({ fecha, texto: `${sinPuntos(formatoDiaSemana.format(aFecha(fecha)))} ${Number(fecha.slice(8))}` }));
  }
  if (zoom === 'mes') {
    return dias.filter((f) => aFecha(f).getUTCDay() === 1).map((fecha) => ({ fecha, texto: diaMesCorto(fecha) }));
  }
  return dias.filter((f) => f.endsWith('-01')).map((fecha) => ({ fecha, texto: sinPuntos(formatoMesAnio.format(aFecha(fecha))).replace(' de ', ' ') }));
}

export const inicioEfectivo = (t: Tarea): string => (t.inicio ?? t.fin)!;
export const finEfectivo = (t: Tarea): string => {
  const fin = (t.fin ?? t.inicio)!;
  return fin < inicioEfectivo(t) ? inicioEfectivo(t) : fin;
};

export function porInicio(a: Tarea, b: Tarea): number {
  const dif = inicioEfectivo(a).localeCompare(inicioEfectivo(b)) || finEfectivo(a).localeCompare(finEfectivo(b));
  return dif !== 0 ? dif : a.id - b.id;
}

export const tieneFechas = (t: Tarea): boolean => t.inicio !== null || t.fin !== null;
