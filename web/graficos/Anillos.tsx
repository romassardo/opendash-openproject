import { useRef } from 'react';
import type { Tono } from '../ui/tonos.js';
import { useAnimacionGrafico } from './animar.js';
import { arco, numeroEs } from './geometria.js';
import './graficos.css';

export type TonoHoy = 'hoy-tareas' | 'hoy-horas' | 'hoy-reunion';

const variableDe = (tono: AnilloDato['tono']): string => (tono.startsWith('hoy-') ? `var(--${tono})` : `var(--tono-${tono})`);

export interface AnilloDato {
  valor: number;
  total: number;
  /** Un tono de proyecto o uno de los tres colores de «Hoy» (`hoy-tareas`, `hoy-horas`, `hoy-reunion`). */
  tono: Tono | TonoHoy;
  etiqueta: string;
  /** Unidad del valor para el nombre accesible («h»); sin unidad se lee «2 de 8». */
  unidad?: string;
  /** El valor cambia solo (un reloj): se redibuja sin repetir la entrada del anillo. */
  vivo?: boolean;
}

export interface AnillosProps {
  /** El primero va por afuera. */
  anillos: AnilloDato[];
  tamano?: number;
}

// Medido: viewBox 136, centro 68, trazo 13, primer radio 56 y 15 de paso radial (2 px entre anillos).
const LADO = 136;
const CENTRO = LADO / 2;
const TRAZO = 13;
const RADIO_EXTERNO = 56;
const PASO = 15;

const fraccion = (valor: number, total: number): number => (total > 0 ? Math.min(Math.max(valor / total, 0), 1) : 0);

function resumen({ etiqueta, valor, total, unidad }: AnilloDato): string {
  return `${etiqueta}: ${numeroEs(valor)} de ${numeroEs(total)}${unidad ? ` ${unidad}` : ''}`;
}

/** Anillos concéntricos de avance (el primero afuera); el trazo se topa en una vuelta completa. */
export function Anillos({ anillos, tamano = 130 }: AnillosProps) {
  const ref = useRef<SVGSVGElement>(null);
  // Lo que cambia cada segundo no relanza la entrada: de un anillo vivo solo cuenta que existe.
  useAnimacionGrafico(ref, [anillos.map((a) => (a.vivo ? { ...a, valor: 0 } : a))]);
  const nombre = `${anillos.map(resumen).join('. ')}.`;
  return (
    <svg
      ref={ref}
      className="grafico-anillos"
      viewBox={`0 0 ${LADO} ${LADO}`}
      width={tamano}
      height={tamano}
      role="img"
      aria-label={nombre}
    >
      {anillos.map((anillo, i) => {
        const r = RADIO_EXTERNO - PASO * i;
        const avance = fraccion(anillo.valor, anillo.total);
        return (
          <g key={`${anillo.etiqueta}-${i}`} style={{ color: variableDe(anillo.tono) }}>
            <circle cx={CENTRO} cy={CENTRO} r={r} className="grafico-pista-anillo" strokeWidth={TRAZO} />
            {avance > 0 && (
              <path
                d={arco(CENTRO, CENTRO, r, 0, avance * 360)}
                data-trazo="anillo"
                pathLength={1}
                className="grafico-trazo-anillo"
                strokeWidth={TRAZO}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
