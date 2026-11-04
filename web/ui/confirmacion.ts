import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

export interface Confirmacion {
  confirmando: boolean;
  /** Va en el botón que abre la confirmación: al cancelar el foco vuelve a él. */
  boton: RefObject<HTMLButtonElement | null>;
  abrir(): void;
  cerrar(): void;
}

/** Estado de una confirmación en línea que reemplaza al botón que la abrió; al cerrarla devuelve el foco a ese botón. */
export function useConfirmacion(): Confirmacion {
  const [confirmando, setConfirmando] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);
  useEffect(() => {
    if (confirmando || !devolverFoco.current) return;
    devolverFoco.current = false;
    boton.current?.focus();
  }, [confirmando]);
  return {
    confirmando,
    boton,
    abrir: () => setConfirmando(true),
    cerrar: () => { devolverFoco.current = true; setConfirmando(false); },
  };
}

/**
 * Caja de una confirmación en línea: al montar enfoca «Cancelar» (`data-accion="cancelar"`) y `Escape` cancela sin
 * llegar al panel que la contiene. Con `bloqueada` (guardando) `Escape` no hace nada.
 */
export function useCajaConfirmacion(alCancelar: () => void, bloqueada = false) {
  const caja = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    caja.current?.querySelector<HTMLButtonElement>('[data-accion="cancelar"]')?.focus();
  }, []);
  const alTeclear = (evento: KeyboardEvent<HTMLElement>): void => {
    if (evento.key !== 'Escape') return;
    evento.preventDefault();
    evento.stopPropagation();
    if (!bloqueada) alCancelar();
  };
  return { ref: caja, onKeyDown: alTeclear };
}
