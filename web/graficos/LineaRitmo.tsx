import { useId, useRef, useState, type CSSProperties } from 'react';
import { useAnimacionGrafico } from './animar.js';
import { caminoSuave, escalaLinda, indicesRotulos, numeroEs } from './geometria.js';
import './graficos.css';

export interface PuntoRitmo {
  fecha: string;
  actual: number;
  anterior: number;
}

export interface LineaRitmoProps {
  puntos: PuntoRitmo[];
  etiquetaActual: string;
  etiquetaAnterior: string;
  formatoFecha(fecha: string): string;
}

// Medido (Throughput): viewBox 701×298, rótulo del eje X en y = 292, línea de 2,6 y anterior de 2 punteada 5 6.
const ANCHO = 701;
const ALTO = 298;
const MARGEN = { izquierda: 34, derecha: 12, arriba: 12, abajo: 32 };
const BASE = ALTO - MARGEN.abajo;
const ANCHO_ROTULO_X = 64;
const RADIO_PUNTO = 4.5;

const clamp = (n: number) => (Number.isFinite(n) ? n : 0);

// Son conteos: las marcas son enteras. La rejilla queda en 4 tramos; si no da, en 2; y con máximos
// chicos (1, 2, 5) ninguna de las dos da enteros, así que hay un tramo por unidad.
function escalaDelEje(maximo: number): { maximo: number; marcas: number[] } {
  const fina = escalaLinda(maximo, 4);
  if (fina.marcas.every(Number.isInteger)) return fina;
  const media = escalaLinda(maximo, 2);
  if (media.marcas.every(Number.isInteger)) return media;
  return Number.isInteger(media.maximo) ? escalaLinda(media.maximo, media.maximo) : media;
}

export function LineaRitmo({ puntos, etiquetaActual, etiquetaAnterior, formatoFecha }: LineaRitmoProps) {
  const ref = useRef<SVGSVGElement>(null);
  const idDegradado = useId();
  const [activo, setActivo] = useState<number | null>(null);
  useAnimacionGrafico(ref, [puntos]);

  const n = puntos.length;
  const { maximo, marcas } = escalaDelEje(Math.max(0, ...puntos.flatMap((p) => [clamp(p.actual), clamp(p.anterior)])));
  const anchoUtil = ANCHO - MARGEN.izquierda - MARGEN.derecha;
  const altoUtil = BASE - MARGEN.arriba;
  const paso = n > 1 ? anchoUtil / (n - 1) : 0;
  const x = (i: number) => (n > 1 ? MARGEN.izquierda + paso * i : MARGEN.izquierda + anchoUtil / 2);
  const y = (valor: number) => BASE - (clamp(valor) / maximo) * altoUtil;
  const trazoActual: [number, number][] = puntos.map((p, i) => [x(i), y(p.actual)]);
  const trazoAnterior: [number, number][] = puntos.map((p, i) => [x(i), y(p.anterior)]);
  const lineaActual = caminoSuave(trazoActual);
  const area = n > 0 ? `${lineaActual} L ${x(n - 1)} ${BASE} L ${x(0)} ${BASE} Z` : '';
  const visibles = new Set(indicesRotulos(n, Math.max(1, Math.floor(anchoUtil / ANCHO_ROTULO_X))));

  const suma = (campo: 'actual' | 'anterior') => puntos.reduce((total, p) => total + clamp(p[campo]), 0);
  const resumen = `${etiquetaActual}: ${numeroEs(suma('actual'))} en ${n} días. ${etiquetaAnterior}: ${numeroEs(suma('anterior'))}.`;
  const nombreDia = (p: PuntoRitmo) =>
    `${formatoFecha(p.fecha)}: ${etiquetaActual} ${numeroEs(p.actual)}, ${etiquetaAnterior} ${numeroEs(p.anterior)}`;

  const dia = activo !== null ? puntos[activo] : undefined;
  const posGlobo = dia && activo !== null ? { x: x(activo), y: y(dia.actual) } : null;
  const ladoGlobo = posGlobo ? (posGlobo.x > ANCHO * 0.7 ? 'derecha' : posGlobo.x < ANCHO * 0.3 ? 'izquierda' : 'centro') : 'centro';
  const estiloGlobo: CSSProperties | undefined = posGlobo
    ? { left: `${(posGlobo.x / ANCHO) * 100}%`, top: `${(Math.min(posGlobo.y, y(dia!.anterior)) / ALTO) * 100}%` }
    : undefined;

  return (
    <div className="grafico-linea" role="group" aria-label={resumen}>
      <svg ref={ref} viewBox={`0 0 ${ANCHO} ${ALTO}`}>
        <defs>
          <linearGradient id={idDegradado} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="grafico-area-arriba" />
            <stop offset="1" className="grafico-area-abajo" />
          </linearGradient>
        </defs>
        <g aria-hidden="true">
          {marcas.map((marca) => {
            const yMarca = BASE - (marca / maximo) * altoUtil;
            return (
              <g key={marca}>
                <line x1={MARGEN.izquierda} x2={ANCHO - MARGEN.derecha} y1={yMarca} y2={yMarca} className="grafico-rejilla" />
                <text data-eje="y" x={MARGEN.izquierda - 8} y={yMarca} textAnchor="end" dominantBaseline="central" className="grafico-rotulo">
                  {numeroEs(marca)}
                </text>
              </g>
            );
          })}
          {puntos.map((p, i) =>
            visibles.has(i) ? (
              <text key={p.fecha} data-eje="x" x={x(i)} y={292} textAnchor="middle" className="grafico-rotulo">
                {formatoFecha(p.fecha)}
              </text>
            ) : null,
          )}
        </g>
        {n > 1 && <path d={caminoSuave(trazoAnterior)} data-area="" className="grafico-linea-anterior" />}
        {n > 0 && <path d={area} data-area="" fill={`url(#${idDegradado})`} />}
        {n > 0 && <path d={lineaActual} data-trazo="linea" pathLength={1} className="grafico-linea-actual" />}
        {puntos.map((p, i) => {
          const encima = activo === i;
          return (
            <g
              key={p.fecha}
              tabIndex={0}
              role="img"
              aria-label={nombreDia(p)}
              className="grafico-dia"
              onMouseEnter={() => setActivo(i)}
              onMouseLeave={() => setActivo((actual) => (actual === i ? null : actual))}
              onFocus={() => setActivo(i)}
              onBlur={() => setActivo((actual) => (actual === i ? null : actual))}
            >
              <rect
                x={x(i) - (n > 1 ? paso / 2 : anchoUtil / 2)}
                y={MARGEN.arriba}
                width={n > 1 ? paso : anchoUtil}
                height={altoUtil}
                className="grafico-dia__zona"
              />
              {encima && (
                <>
                  <line x1={x(i)} x2={x(i)} y1={MARGEN.arriba} y2={BASE} className="grafico-cruz" />
                  <circle cx={x(i)} cy={y(p.actual)} r={RADIO_PUNTO} className="grafico-punto" />
                </>
              )}
            </g>
          );
        })}
      </svg>
      {dia && (
        <div role="tooltip" className="grafico-globo" data-lado={ladoGlobo} style={estiloGlobo}>
          <b>{formatoFecha(dia.fecha)}</b>
          <span>
            <i className="grafico-globo__marca grafico-globo__marca--actual" />
            {etiquetaActual}
            <em>{numeroEs(dia.actual)}</em>
          </span>
          <span>
            <i className="grafico-globo__marca" />
            {etiquetaAnterior}
            <em>{numeroEs(dia.anterior)}</em>
          </span>
        </div>
      )}
    </div>
  );
}
