import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Info } from 'lucide-react';
import { mensajeDeError } from '../ingreso/Campo.js';
import { Aviso } from '../ui/Aviso.js';

const VISIBLE_GUARDADO_MS = 2000;

export interface EstadoGuardado {
  /** `true` durante 2 s después de guardar. */
  guardado: boolean;
  error: string | null;
  /** Corre el guardado; devuelve `true` si salió bien. Un error de la API queda en `error`. */
  guardar(tarea: () => Promise<unknown>, generico?: string): Promise<boolean>;
  /** Muestra un error de validación propio (sin llamar al servidor). */
  rechazar(mensaje: string): void;
  limpiar(): void;
}

/** Estado de «Guardado» (2 s) o del error de un campo que se guarda al confirmar. */
export function useGuardado(): EstadoGuardado {
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  const limpiar = useCallback(() => {
    clearTimeout(temporizador.current);
    setGuardado(false);
    setError(null);
  }, []);

  const guardar = useCallback(async (tarea: () => Promise<unknown>, generico = 'No se pudo guardar. Probá de nuevo.') => {
    limpiar();
    try {
      await tarea();
    } catch (falla) {
      setError(mensajeDeError(falla, generico));
      return false;
    }
    setGuardado(true);
    temporizador.current = setTimeout(() => setGuardado(false), VISIBLE_GUARDADO_MS);
    return true;
  }, [limpiar]);

  const rechazar = useCallback((mensaje: string) => {
    limpiar();
    setError(mensaje);
  }, [limpiar]);

  return { guardado, error, guardar, rechazar, limpiar };
}

/** «Guardado» (anunciado) o el error, debajo del campo. */
export function ResultadoGuardado({ estado }: { estado: EstadoGuardado }) {
  return (
    <>
      {estado.guardado && (
        <span role="status" className="guardado">
          <Check size={14} aria-hidden="true" />
          Guardado
        </span>
      )}
      {estado.error !== null && <Aviso tipo="error">{estado.error}</Aviso>}
    </>
  );
}

/** Nota fija de las secciones que valen para todo el equipo (no es un aviso en vivo). */
export function NotaEquipo({ children }: { children: ReactNode }) {
  return (
    <p className="configuracion__nota">
      <Info size={16} aria-hidden="true" />
      {children}
    </p>
  );
}
