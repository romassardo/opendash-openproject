import { useSyncExternalStore } from 'react';
import { hoyArgentina } from '../fechas.js';

// Reloj compartido de «hoy»: un solo intervalo mientras haya pantallas suscriptas, más el regreso a la pestaña.

const REVISION_MS = 60_000;

const suscriptores = new Set<() => void>();
let intervalo: ReturnType<typeof setInterval> | null = null;

const avisar = (): void => suscriptores.forEach((aviso) => aviso());
const alVolver = (): void => {
  if (document.visibilityState !== 'hidden') avisar();
};

function suscribir(aviso: () => void): () => void {
  suscriptores.add(aviso);
  if (suscriptores.size === 1) {
    intervalo = setInterval(avisar, REVISION_MS);
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', avisar);
  }
  return () => {
    suscriptores.delete(aviso);
    if (suscriptores.size === 0) {
      if (intervalo !== null) clearInterval(intervalo);
      intervalo = null;
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', avisar);
    }
  };
}

const instantanea = (): string => hoyArgentina(new Date());

/** El día argentino de hoy ('YYYY-MM-DD'); se actualiza solo al pasar la medianoche o al volver a la pestaña. */
export function useHoy(): string {
  return useSyncExternalStore(suscribir, instantanea, instantanea);
}
