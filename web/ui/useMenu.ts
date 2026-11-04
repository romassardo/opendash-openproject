import { useEffect, useRef, useState, type KeyboardEvent as TeclaReact } from 'react';

const OPCIONES_MENU = '[role="menuitem"]:not(:disabled)';

/**
 * Un menú que se abre desde un botón: al abrir el foco va a la primera opción, las flechas recorren las opciones en
 * círculo, Escape cierra y devuelve el foco al botón, Tab cierra y sigue desde el botón, y tocar afuera de `caja`
 * lo cierra.
 */
export function useMenu() {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (abierto) menu.current?.querySelector<HTMLElement>(OPCIONES_MENU)?.focus();
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const alTocar = (evento: PointerEvent) => {
      if (!caja.current?.contains(evento.target as Node)) setAbierto(false);
    };
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', alTocar);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('pointerdown', alTocar);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);

  const alTeclearEnMenu = (evento: TeclaReact<HTMLDivElement>) => {
    if (evento.key === 'Tab') {
      setAbierto(false);
      boton.current?.focus();
      return;
    }
    if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return;
    const opciones = Array.from(menu.current?.querySelectorAll<HTMLElement>(OPCIONES_MENU) ?? []);
    if (opciones.length === 0) return;
    evento.preventDefault();
    const actual = opciones.indexOf(document.activeElement as HTMLElement);
    const paso = evento.key === 'ArrowDown' ? 1 : -1;
    opciones[(actual + paso + opciones.length) % opciones.length]?.focus();
  };

  return { abierto, setAbierto, caja, boton, menu, alTeclearEnMenu };
}
