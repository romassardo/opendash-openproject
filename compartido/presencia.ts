import type { Presencia } from './tipos.js';

/** La web pide datos cada 30 s con la pestaña visible, así que una pestaña abierta se mantiene conectada. */
export const VENTANA_CONECTADO_MS = 2 * 60_000;

/**
 * `trabajando`: hay un tramo en marcha y no pausado. Orden: trabajando > vacaciones > reunión > conectado > ausente
 * (una Daily que no se canceló no tapa las vacaciones). `extra` lo calcula el servidor con el calendario y las vacaciones.
 */
export function presenciaDe(
  ultimaActividad: string | null, trabajando: boolean, ahora: Date,
  extra: { enReunion: boolean; deVacaciones: boolean } = { enReunion: false, deVacaciones: false },
): Exclude<Presencia, 'sin-opendash'> {
  if (trabajando) return 'trabajando';
  if (extra.deVacaciones) return 'vacaciones';
  if (extra.enReunion) return 'reunion';
  if (ultimaActividad !== null && ahora.getTime() - Date.parse(ultimaActividad) < VENTANA_CONECTADO_MS) return 'conectado';
  return 'ausente';
}
