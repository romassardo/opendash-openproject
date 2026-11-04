import { useCallback, useSyncExternalStore } from 'react';

const CLAVE_PERMISO = 'opendash.reuniones.permiso';

export type EstadoPermisoAvisos = 'granted' | 'denied' | 'default' | 'no-disponible';

/** El `Notification` del navegador, solo en una página segura y en los navegadores que lo traen. */
export function avisosDelNavegador(): boolean {
  return typeof Notification !== 'undefined' && !(typeof window !== 'undefined' && window.isSecureContext === false);
}

const leerEstado = (): EstadoPermisoAvisos => (avisosDelNavegador() ? Notification.permission : 'no-disponible');

const leerAhoraNo = (): boolean => {
  try {
    return localStorage.getItem(CLAVE_PERMISO) === 'ahora-no';
  } catch {
    return false;
  }
};

// El permiso y «Ahora no» los comparten el vigilante y Configuración: lo que cambia uno lo ve el otro.
const oyentes = new Set<() => void>();
const avisar = (): void => oyentes.forEach((oyente) => oyente());
const suscribir = (oyente: () => void): (() => void) => {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
};

export interface PermisoAvisos {
  estado: EstadoPermisoAvisos;
  /** Pide el permiso al navegador (debe llamarse desde un clic) y borra el «Ahora no» anterior. */
  pedir(): Promise<void>;
  /** «Ahora no»: no se vuelve a ofrecer. */
  ahoraNo(): void;
  /** Hay un «Ahora no» guardado. */
  rechazado: boolean;
  /** Hay que explicar y pedir el permiso: se puede y todavía no se decidió nada. */
  preguntar: boolean;
}

export function usePermisoAvisos(): PermisoAvisos {
  const estado = useSyncExternalStore(suscribir, leerEstado, () => 'no-disponible' as const);
  const rechazado = useSyncExternalStore(suscribir, leerAhoraNo, () => false);

  const pedir = useCallback(async (): Promise<void> => {
    try {
      localStorage.removeItem(CLAVE_PERMISO);
    } catch {
      // Sin almacenamiento no había nada guardado.
    }
    if (avisosDelNavegador()) {
      try {
        await Notification.requestPermission();
      } catch {
        // Sin permiso queda el aviso dentro de OpenDash.
      }
    }
    avisar();
  }, []);

  const ahoraNo = useCallback((): void => {
    try {
      localStorage.setItem(CLAVE_PERMISO, 'ahora-no');
    } catch {
      // Sin almacenamiento, vuelve a preguntar la próxima vez: no pasa nada.
    }
    avisar();
  }, []);

  return { estado, pedir, ahoraNo, rechazado, preguntar: estado === 'default' && !rechazado };
}
