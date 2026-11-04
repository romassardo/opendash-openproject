import { useSyncExternalStore } from 'react';

interface EventoDeInstalacion extends Event {
  prompt(): Promise<void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// El navegador lanza `beforeinstallprompt` una sola vez y puede ser antes de que el menú exista:
// se guarda a nivel de módulo y los componentes se suscriben.
let pendiente: EventoDeInstalacion | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((oyente) => oyente());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    pendiente = evento as EventoDeInstalacion;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    pendiente = null;
    avisar();
  });
}

const suscribir = (oyente: () => void) => {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
};

const enModoApp = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;

const hayPendiente = (): boolean => pendiente !== null && !enModoApp();

export function useInstalar(): { disponible: boolean; instalar(): Promise<void> } {
  const disponible = useSyncExternalStore(suscribir, hayPendiente, () => false);
  const instalar = async (): Promise<void> => {
    const evento = pendiente;
    if (!evento) return;
    try {
      await evento.prompt();
      const eleccion = await evento.userChoice;
      // Solo se descarta si la persona aceptó: si cerró el diálogo, «Instalar OpenDash» sigue disponible.
      if (eleccion?.outcome === 'accepted') {
        pendiente = null;
        avisar();
      }
    } catch {
      // El navegador no deja usar el mismo evento dos veces: sin otro evento nuevo no hay cómo instalar desde acá.
      pendiente = null;
      avisar();
    }
  };
  return { disponible, instalar };
}
