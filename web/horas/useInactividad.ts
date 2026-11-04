import { useCallback, useEffect, useState } from 'react';

/** Minutos sin teclado ni mouse antes de preguntar. */
export const UMBRAL_INACTIVIDAD_MS = 15 * 60_000;
const CLAVE_PERMISO = 'opendash.inactividad.permiso';

interface DetectorInactividad extends EventTarget {
  userState: 'active' | 'idle' | null;
  screenState: 'locked' | 'unlocked' | null;
  start(opciones: { threshold: number; signal: AbortSignal }): Promise<void>;
}
interface ConstructorDetector {
  new (): DetectorInactividad;
  requestPermission(): Promise<'granted' | 'denied'>;
}

/** La API de detección de inactividad, solo en una página segura y en los navegadores que la traen. */
function detectorDisponible(): ConstructorDetector | null {
  if (typeof window === 'undefined' || !window.isSecureContext) return null;
  const clase = (window as unknown as { IdleDetector?: ConstructorDetector }).IdleDetector;
  return clase ?? null;
}

type Guardado = 'granted' | 'denied' | 'ahora-no';

const leerGuardado = (): Guardado | null => {
  try {
    const valor = localStorage.getItem(CLAVE_PERMISO);
    return valor === 'granted' || valor === 'denied' || valor === 'ahora-no' ? valor : null;
  } catch {
    return null;
  }
};
const guardar = (valor: Guardado | null): void => {
  try {
    if (valor === null) localStorage.removeItem(CLAVE_PERMISO);
    else localStorage.setItem(CLAVE_PERMISO, valor);
  } catch {
    // Sin almacenamiento, el navegador vuelve a preguntar la próxima vez: no pasa nada.
  }
};

export interface Inactividad {
  /** Desde cuándo estuvo sin actividad la PC, una vez que la persona volvió; `null` si no hay nada que preguntar. */
  desde: Date | null;
  /** Hay que explicarle a la persona para qué es el permiso antes de pedirlo: la API existe y todavía no se decidió nada. */
  necesitaExplicar: boolean;
  /** Pide el permiso (debe llamarse desde un clic). Sin la API, no hace nada. */
  pedirPermiso(): Promise<void>;
  /** «Ahora no»: no se vuelve a ofrecer. */
  noPedir(): void;
  /** Olvida la pregunta pendiente. */
  limpiar(): void;
}

/**
 * Detecta cuándo la PC queda sin uso mientras `activo`. No corta nada: anota la hora en que empezó la inactividad y,
 * al volver la persona, la deja en `desde` para que se le pregunte.
 */
export function useInactividad(activo: boolean): Inactividad {
  const [guardado, setGuardado] = useState<Guardado | null>(() => (detectorDisponible() !== null ? leerGuardado() : null));
  const [desde, setDesde] = useState<Date | null>(null);
  const disponible = detectorDisponible() !== null;
  const permiso = disponible && guardado === 'granted';

  // El navegador es quien sabe si el permiso sigue vigente: lo guardado puede haber quedado viejo.
  useEffect(() => {
    if (detectorDisponible() === null || typeof navigator === 'undefined' || !navigator.permissions) return;
    let vigente = true;
    navigator.permissions.query({ name: 'idle-detection' as PermissionName }).then((estado) => {
      if (!vigente) return;
      if (estado.state === 'granted') {
        guardar('granted');
        setGuardado('granted');
      } else if (estado.state === 'denied') {
        guardar('denied');
        setGuardado('denied');
      } else {
        setGuardado((actual) => {
          if (actual !== 'granted') return actual;
          guardar(null);
          return null;
        });
      }
    }).catch(() => undefined);
    return () => { vigente = false; };
  }, []);

  const pedirPermiso = useCallback(async (): Promise<void> => {
    const Detector = detectorDisponible();
    if (Detector === null) return;
    try {
      const respuesta = await Detector.requestPermission();
      guardar(respuesta);
      setGuardado(respuesta);
    } catch {
      // Sin permiso todo anda igual, sin la pregunta.
    }
  }, []);

  const noPedir = useCallback((): void => {
    guardar('ahora-no');
    setGuardado('ahora-no');
  }, []);

  useEffect(() => {
    const Detector = detectorDisponible();
    if (!activo || !permiso || Detector === null) return;
    const control = new AbortController();
    let inicio: Date | null = null;
    const detector = new Detector();
    detector.addEventListener('change', () => {
      const quieto = detector.userState === 'idle' || detector.screenState === 'locked';
      if (quieto) {
        inicio ??= new Date(Date.now() - (detector.userState === 'idle' ? UMBRAL_INACTIVIDAD_MS : 0));
      } else if (inicio !== null) {
        setDesde(inicio);
        inicio = null;
      }
    });
    detector.start({ threshold: UMBRAL_INACTIVIDAD_MS, signal: control.signal }).catch(() => {
      if (control.signal.aborted) return;
      // Por ejemplo, el permiso se revocó: no se sigue creyendo que está concedido.
      guardar(null);
      setGuardado(null);
    });
    return () => control.abort();
  }, [activo, permiso]);

  const limpiar = useCallback(() => setDesde(null), []);
  const necesitaExplicar = disponible && guardado === null;
  return { desde, necesitaExplicar, pedirPermiso, noPedir, limpiar };
}
