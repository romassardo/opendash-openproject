import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Un diálogo que aparece solo: al montar lleva el foco a `inicial` (por defecto, su primer botón), `Escape` equivale
 * a la salida segura y al desmontar el foco vuelve a donde estaba.
 */
export function useDialogo(ref: RefObject<HTMLElement | null>, alEscape: () => void, inicial?: RefObject<HTMLElement | null>): void {
  // Antes de pintar: el elemento que tenía el foco se toma antes de moverlo (y antes de que un autoFocus lo pise).
  useLayoutEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (inicial?.current ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    return () => {
      if (previo !== null && previo.isConnected) previo.focus();
    };
    // `inicial` es un ref estable.
  }, [ref, inicial]);

  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') alEscape();
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [alEscape]);
}
