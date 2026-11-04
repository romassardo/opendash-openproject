import { cuentaComoReunion } from '../../compartido/calendario.js';
import type { Reunion } from '../../compartido/tipos.js';
import { fechaArgentina, hoyArgentina } from '../fechas.js';

// Lógica pura del aviso antes de una reunión. `ahora` entra como parámetro.

const MS_MINUTO = 60_000;
/** Cuánto sigue a la vista el aviso de una reunión que ya empezó. */
const MINUTOS_DESPUES_DE_EMPEZAR = 5;

export interface AvisoPendiente { reunion: Reunion; avisarEn: Date; empieza: Date }

/** Las reuniones de hoy que cuentan como reunión y todavía no empezaron, con el momento de avisar (inicio − minutos), por inicio. */
export function avisosPendientes(reuniones: Reunion[], ahora: Date, minutos: number): AvisoPendiente[] {
  const hoy = hoyArgentina(ahora);
  const pendientes: AvisoPendiente[] = [];
  for (const reunion of reuniones) {
    if (!cuentaComoReunion(reunion) || fechaArgentina(reunion.inicio) !== hoy) continue;
    const empieza = new Date(reunion.inicio);
    if (Number.isNaN(empieza.getTime()) || empieza.getTime() <= ahora.getTime()) continue;
    pendientes.push({ reunion, empieza, avisarEn: new Date(empieza.getTime() - minutos * MS_MINUTO) });
  }
  return pendientes.sort((a, b) => a.empieza.getTime() - b.empieza.getTime());
}

/** «En 5 min», «En 1 min», «Empezó»; null si ya pasaron 5 minutos del inicio. */
export function textoFaltan(empieza: Date, ahora: Date): string | null {
  const falta = empieza.getTime() - ahora.getTime();
  if (falta > 0) return `En ${Math.ceil(falta / MS_MINUTO)} min`;
  return -falta <= MINUTOS_DESPUES_DE_EMPEZAR * MS_MINUTO ? 'Empezó' : null;
}

/** Identifica una reunión en un horario: si se mueve en Outlook, es otra. Sirve de `tag` del aviso del navegador. */
export const etiquetaAviso = (r: Reunion): string => `${r.id}@${r.inicio}`;
