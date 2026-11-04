import { useRef } from 'react';
import type { Tono } from '../ui/tonos.js';
import { useAnimacionGrafico } from './animar.js';
import { arco, numeroEs } from './geometria.js';
import './graficos.css';

export interface DonaSegmento {
  valor: number;
  tono: Tono;
  etiqueta: string;
}

export interface DonaProps {
  segmentos: DonaSegmento[];
  total: number;
  /** Texto bajo el total, en el centro («tareas»). */
  leyenda: string;
  /** Si se da, se muestra en lugar del total (por ejemplo «–» mientras cargan los datos). */
  totalTexto?: string;
}

// Medido: viewBox 140, r 52, trazo 16, extremos redondeados.
const LADO = 140;
const CENTRO = LADO / 2;
const RADIO = 52;
const TRAZO = 16;
// Cada extremo redondeado sobresale medio trazo (≈ 9° a este radio): el hueco entre tramos suma
// los dos extremos más un respiro de unos 3°.
const HUECO = 21;

export function Dona({ segmentos, total, leyenda, totalTexto }: DonaProps) {
  const ref = useRef<SVGSVGElement>(null);
  useAnimacionGrafico(ref, [segmentos, total]);
  const visibles = total > 0 ? segmentos.filter((s) => s.valor > 0) : [];
  const hueco = visibles.length > 1 ? HUECO : 0;
  let cursor = 0;
  const tramos = visibles.map((s) => {
    const barrido = (Math.min(s.valor, total) / total) * 360;
    const desde = cursor + hueco / 2;
    cursor += barrido;
    // Un tramo más chico que el hueco queda como un punto (el extremo redondeado), nunca al revés.
    return { ...s, d: arco(CENTRO, CENTRO, RADIO, desde, desde + Math.max(barrido - hueco, 0.01)) };
  });
  const detalle = visibles.length > 0 ? `: ${visibles.map((s) => `${s.etiqueta} ${numeroEs(s.valor)}`).join(', ')}.` : '.';
  return (
    <div className="grafico-dona">
      <svg ref={ref} viewBox={`0 0 ${LADO} ${LADO}`} role="img" aria-label={`${totalTexto ?? numeroEs(total)} ${leyenda}${detalle}`}>
        <circle cx={CENTRO} cy={CENTRO} r={RADIO} className="grafico-pista-dona" strokeWidth={TRAZO} />
        {tramos.map((t, i) => (
          <path
            key={`${t.etiqueta}-${i}`}
            d={t.d}
            data-trazo="dona"
            pathLength={1}
            className="grafico-trazo-dona"
            strokeWidth={TRAZO}
            style={{ stroke: `var(--tono-${t.tono})` }}
          />
        ))}
      </svg>
      <div className="grafico-dona__centro" aria-hidden="true">
        <b>{totalTexto ?? numeroEs(total)}</b>
        <span>{leyenda}</span>
      </div>
    </div>
  );
}
