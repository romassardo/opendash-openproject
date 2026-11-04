import { useRef } from 'react';
import type { Tono } from '../ui/tonos.js';
import { useAnimacionGrafico } from './animar.js';
import { arco } from './geometria.js';
import './graficos.css';

export interface AnilloAvanceProps {
  /** De 0 a 100; fuera de ese rango se limita. */
  porcentaje: number;
  tono: Tono;
  tamano?: number;
  /** Nombre accesible; por defecto «Avance». */
  etiqueta?: string;
}

// Medido: SVG de 64, r 27 y trazo 7 con extremos redondeados, valor central en 700.
const LADO = 64;
const CENTRO = LADO / 2;
const RADIO = 27;
const TRAZO = 7;

export function AnilloAvance({ porcentaje, tono, tamano = 64, etiqueta = 'Avance' }: AnilloAvanceProps) {
  const ref = useRef<SVGSVGElement>(null);
  const entero = Math.round(Math.min(Math.max(Number.isFinite(porcentaje) ? porcentaje : 0, 0), 100));
  useAnimacionGrafico(ref, [entero]);
  const texto = `${entero} %`;
  return (
    <svg
      ref={ref}
      className="grafico-anillo-avance"
      viewBox={`0 0 ${LADO} ${LADO}`}
      width={tamano}
      height={tamano}
      role="img"
      aria-label={`${etiqueta}: ${texto}`}
      style={{ color: `var(--tono-${tono})` }}
    >
      <circle cx={CENTRO} cy={CENTRO} r={RADIO} className="grafico-pista-anillo" strokeWidth={TRAZO} />
      {entero > 0 && (
        <path
          d={arco(CENTRO, CENTRO, RADIO, 0, (entero / 100) * 360)}
          data-trazo="anillo"
          pathLength={1}
          className="grafico-trazo-anillo"
          strokeWidth={TRAZO}
        />
      )}
      <text x={CENTRO} y={CENTRO} className="grafico-valor-anillo" textAnchor="middle" dominantBaseline="central">
        {texto}
      </text>
    </svg>
  );
}
