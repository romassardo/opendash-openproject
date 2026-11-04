import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { unir } from './clases.js';

export interface OpcionSegmentado<T extends string> {
  valor: T;
  etiqueta: string;
  icono?: ReactNode;
}

export interface SegmentadoProps<T extends string> {
  opciones: OpcionSegmentado<T>[];
  valor: NoInfer<T>;
  onCambio(valor: NoInfer<T>): void;
  /** Nombre accesible del grupo. */
  etiqueta?: string;
  tamano?: 'normal' | 'chico';
  className?: string;
  /** Al montarse lleva el foco a la opción marcada (cuando el control se vuelve a dibujar tras un cambio hecho con él). */
  enfocarAlMontar?: boolean;
}

interface Lente { x: number; ancho: number }

const DESTINO: Record<string, (i: number, n: number) => number> = {
  ArrowRight: (i) => i + 1,
  ArrowDown: (i) => i + 1,
  ArrowLeft: (i) => i - 1,
  ArrowUp: (i) => i - 1,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

/** Control segmentado: un radiogroup con foco itinerante y una lente de vidrio que se desliza. */
export function Segmentado<T extends string>({ opciones, valor, onCambio, etiqueta, tamano = 'normal', className, enfocarAlMontar = false }: SegmentadoProps<T>) {
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const [lente, setLente] = useState<Lente | null>(null);
  // -1 si el valor no está entre las opciones: ninguna marcada, la primera recibe el Tab.
  const activo = opciones.findIndex((o) => o.valor === valor);
  const conFoco = Math.max(0, activo);

  useLayoutEffect(() => {
    if (enfocarAlMontar) botones.current[Math.max(0, activo)]?.focus();
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const medir = () => {
      const boton = botones.current[activo];
      if (!boton) {
        setLente(null);
        return;
      }
      const nueva = { x: boton.offsetLeft, ancho: boton.offsetWidth };
      setLente((previa) => (previa && previa.x === nueva.x && previa.ancho === nueva.ancho ? previa : nueva));
    };
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(medir);
    botones.current.forEach((b) => b && observador.observe(b));
    return () => observador.disconnect();
  }, [activo, opciones]);

  const elegir = (i: number) => {
    const opcion = opciones[i];
    if (!opcion) return;
    botones.current[i]?.focus();
    if (opcion.valor !== valor) onCambio(opcion.valor);
  };

  const alTeclear = (evento: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const destino = DESTINO[evento.key];
    if (!destino) return;
    evento.preventDefault();
    const n = opciones.length;
    elegir((destino(i, n) + n) % n);
  };

  return (
    <div role="radiogroup" aria-label={etiqueta} className={unir('segmentado', tamano === 'chico' && 'segmentado--chico', className)}>
      {lente && (
        <span
          className="segmentado__lente"
          aria-hidden="true"
          style={{ width: lente.ancho, transform: `translateX(${lente.x}px)` }}
        />
      )}
      {opciones.map((opcion, i) => (
        <button
          key={opcion.valor}
          ref={(nodo) => { botones.current[i] = nodo; }}
          type="button"
          role="radio"
          aria-checked={i === activo}
          tabIndex={i === conFoco ? 0 : -1}
          className="segmentado__opcion"
          onClick={() => elegir(i)}
          onKeyDown={(evento) => alTeclear(evento, i)}
        >
          {opcion.icono && <span className="segmentado__icono" aria-hidden="true">{opcion.icono}</span>}
          {opcion.etiqueta}
        </button>
      ))}
    </div>
  );
}
