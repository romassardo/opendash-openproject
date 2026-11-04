import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { unir } from './clases.js';
import './avisos.css';

/** Cuánto dura un aviso flotante antes de irse solo. */
export const MS_AVISO = 7000;

export interface AccionAviso {
  etiqueta: string;
  alHacer: () => void | Promise<void>;
}

export interface AvisoNuevo {
  texto: string;
  error?: boolean;
  /** Segunda línea con ⚠ (vacaciones). */
  detalle?: string | null;
  accion?: AccionAviso;
}

export interface Avisos {
  avisar(aviso: AvisoNuevo): void;
  cerrar(): void;
}

export interface AvisoActual extends AvisoNuevo {
  id: number;
}

const SIN_AVISOS: Avisos = { avisar: () => undefined, cerrar: () => undefined };
const ContextoAvisos = createContext<Avisos>(SIN_AVISOS);
const ContextoActual = createContext<AvisoActual | null>(null);

/** Avisar y cerrar el aviso flotante. Fuera del proveedor no hacen nada. */
export function useAvisos(): Avisos {
  return useContext(ContextoAvisos);
}

/** El aviso que se está mostrando (para pruebas y para quien necesite leerlo). */
export function useAvisoActual(): AvisoActual | null {
  return useContext(ContextoActual);
}

/** Atributo de la capa de avisos: `bloquearFondo` la saltea para que el «Deshacer» siga usable con un modal abierto. */
export const ATRIBUTO_CAPA_AVISOS = 'data-capa-avisos';

const esCampoDeTexto = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** Un único aviso flotante abajo a la derecha, con una acción opcional; uno nuevo reemplaza al anterior. */
export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<AvisoActual | null>(null);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contador = useRef(0);
  const actual = useRef<AvisoActual | null>(null);
  actual.current = aviso;

  const apagar = useCallback(() => {
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = null;
  }, []);

  useEffect(() => apagar, [apagar]);

  /** Arma el reloj que apaga el aviso `id` a los 7 s (si sigue siendo el que se ve). */
  const armar = useCallback((id: number) => {
    apagar();
    reloj.current = setTimeout(() => {
      reloj.current = null;
      setAviso((a) => (a !== null && a.id === id ? null : a));
    }, MS_AVISO);
  }, [apagar]);

  const cerrar = useCallback(() => {
    apagar();
    setAviso(null);
  }, [apagar]);

  const avisar = useCallback((nuevo: AvisoNuevo) => {
    apagar();
    contador.current += 1;
    const id = contador.current;
    setAviso({ ...nuevo, id });
    // Un error sin acción se queda hasta cerrarlo; lo demás se apaga solo.
    if (!nuevo.error || nuevo.accion) armar(id);
  }, [apagar, armar]);

  const hacer = useCallback(async (accion: AccionAviso) => {
    const id = actual.current?.id;
    apagar();
    // Sin la acción el botón desaparece: un segundo toque no repite lo que ya está en camino.
    setAviso((a) => (a !== null && a.id === id ? { ...a, accion: undefined } : a));
    try {
      await accion.alHacer();
    } catch (error) {
      avisar({ texto: `No se pudo completar: ${error instanceof Error ? error.message : 'probá de nuevo'}.`, error: true });
      return;
    }
    // Si la acción no publicó otro aviso, este no puede quedar fijo: vuelve a su reloj.
    if (id !== undefined && contador.current === id) armar(id);
  }, [apagar, armar, avisar]);

  // Sin el mouse ni el foco encima el aviso corre su tiempo; con ellos, espera (WCAG 2.2.1).
  const pausar = useCallback(() => apagar(), [apagar]);
  const seguir = useCallback(() => {
    const a = actual.current;
    if (a !== null && (!a.error || a.accion)) armar(a.id);
  }, [armar]);

  // Ctrl+Z (⌘+Z) mientras haya un «Deshacer» a la vista, salvo escribiendo en un campo.
  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent): void => {
      const accion = actual.current?.accion;
      if (accion?.etiqueta !== 'Deshacer' || evento.key.toLowerCase() !== 'z' || evento.shiftKey || !(evento.ctrlKey || evento.metaKey)) return;
      if (esCampoDeTexto(evento.target)) return;
      evento.preventDefault();
      void hacer(accion);
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [hacer]);

  const avisos = useMemo<Avisos>(() => ({ avisar, cerrar }), [avisar, cerrar]);

  return (
    <ContextoAvisos.Provider value={avisos}>
      <ContextoActual.Provider value={aviso}>
        {children}
        {/* Fuera de #root: un modal vuelve inerte todo lo que rodea a su capa, y el «Deshacer» tiene que seguir usable. */}
        {createPortal(
          <div role="status" {...{ [ATRIBUTO_CAPA_AVISOS]: '' }}>
            {aviso && <AvisoFlotante aviso={aviso} alHacer={(a) => void hacer(a)} alCerrar={cerrar} alPausar={pausar} alSeguir={seguir} />}
          </div>,
          document.body,
        )}
      </ContextoActual.Provider>
    </ContextoAvisos.Provider>
  );
}

interface PropsAviso { aviso: AvisoActual; alHacer(accion: AccionAviso): void; alCerrar(): void; alPausar(): void; alSeguir(): void }

function AvisoFlotante({ aviso, alHacer, alCerrar, alPausar, alSeguir }: PropsAviso) {
  const { accion, detalle } = aviso;
  return (
    <div
      className={unir('aviso-flotante', aviso.error && 'aviso-flotante--error')}
      data-aviso={aviso.id}
      onPointerEnter={alPausar}
      onPointerLeave={alSeguir}
      onFocus={alPausar}
      onBlur={alSeguir}
    >
      <div className="aviso-flotante__fila">
        <p className="aviso-flotante__texto">{aviso.texto}</p>
        {accion && <button type="button" className="chip" onClick={() => alHacer(accion)}>{accion.etiqueta}</button>}
        <button type="button" className="aviso-flotante__cerrar" aria-label="Cerrar aviso" onClick={alCerrar}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {detalle != null && <p className="aviso-flotante__detalle">⚠ {detalle}</p>}
    </div>
  );
}
