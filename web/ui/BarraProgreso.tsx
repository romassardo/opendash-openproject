import type { CSSProperties } from 'react';
import { unir } from './clases.js';
import type { Tono } from './tonos.js';

export interface BarraProgresoProps {
  valor: number;
  maximo: number;
  /** Color del relleno (uno de los tonos de proyecto); sin tono usa el acento. */
  tono?: Tono;
  /** Nombre accesible: qué mide la barra. */
  etiqueta: string;
  /** Pasó la capacidad: el relleno se pinta con el color de «excedida». */
  excedida?: boolean;
  className?: string;
}

export function BarraProgreso({ valor, maximo, tono, etiqueta, excedida = false, className }: BarraProgresoProps) {
  const tope = Math.max(0, maximo);
  const actual = Math.min(Math.max(0, valor), tope);
  const fraccion = tope > 0 ? actual / tope : 0;
  const estilo = tono ? ({ '--barra-color': `var(--tono-${tono})` } as CSSProperties) : undefined;
  return (
    <div
      role="progressbar"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={tope}
      aria-valuenow={actual}
      data-excedida={excedida ? 'true' : undefined}
      className={unir('barra-progreso', className)}
      style={estilo}
    >
      <span className="barra-progreso__relleno" style={{ transform: `scaleX(${fraccion})` }} />
    </div>
  );
}
