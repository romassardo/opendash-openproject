import { useRef } from 'react';
import { useAnimacionGrafico } from './animar.js';
import { barraRedondeada, escalaLinda, indicesRotulos } from './geometria.js';
import './graficos.css';

export interface BarrasProps {
  barras: { etiqueta: string; valor: number }[];
  /** Cómo se escribe un valor en el nombre accesible y en el globo nativo. */
  formato(valor: number): string;
  /** Resalta la última barra (el día o la hora actual) y atenúa las demás. */
  destacarUltima?: boolean;
  /** Resalta la barra de ese índice (el día de hoy en una semana entera) y atenúa las demás; manda sobre `destacarUltima`. */
  destacar?: number;
}

// Medido (Focus por hora): pista de 190 de alto, columna de 10,1 y hueco de 5,76 → la columna es el 64 % de su casilla.
const ANCHO = 700;
const ALTO_PISTA = 190;
const ESPACIO_ROTULO = 8;
const ALTO_ROTULO = 14;
const ALTO = ALTO_PISTA + ESPACIO_ROTULO + ALTO_ROTULO;
const FRACCION_COLUMNA = 0.64;
const ROTULOS_MAXIMOS = 12;
const ALTO_MINIMO = 4;

export function Barras({ barras, formato, destacarUltima = false, destacar }: BarrasProps) {
  const ref = useRef<SVGSVGElement>(null);
  useAnimacionGrafico(ref, [barras]);
  const casilla = barras.length > 0 ? ANCHO / barras.length : ANCHO;
  const columna = casilla * FRACCION_COLUMNA;
  const { maximo } = escalaLinda(Math.max(0, ...barras.map((b) => (Number.isFinite(b.valor) ? b.valor : 0))));
  const rotulos = new Set(indicesRotulos(barras.length, ROTULOS_MAXIMOS));
  const nombre = barras.length > 0 ? `${barras.map((b) => `${b.etiqueta}: ${formato(b.valor)}`).join('. ')}.` : 'Sin datos.';
  return (
    <svg ref={ref} className="grafico-barras" viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" aria-label={nombre}>
      {barras.map((b, i) => {
        const x = casilla * i + (casilla - columna) / 2;
        const alto = b.valor > 0 ? Math.max((b.valor / maximo) * ALTO_PISTA, ALTO_MINIMO) : 0;
        const conDestacada = destacar !== undefined || destacarUltima;
        const destacada = destacar !== undefined ? i === destacar : destacarUltima && i === barras.length - 1;
        return (
          <g key={`${b.etiqueta}-${i}`} className="grafico-barra" data-atenuada={conDestacada && !destacada ? 'true' : undefined}>
            <title>{`${b.etiqueta}: ${formato(b.valor)}`}</title>
            <rect x={x} y={0} width={columna} height={ALTO_PISTA} rx={Math.min(12, columna / 2)} className="grafico-pista-barra" />
            {alto > 0 && (
              <path
                d={barraRedondeada(x, ALTO_PISTA - alto, columna, alto)}
                data-barra=""
                data-destacada={destacada ? 'true' : undefined}
                className="grafico-relleno-barra"
              />
            )}
            {rotulos.has(i) && (
              <text x={x + columna / 2} y={ALTO - 2} textAnchor="middle" className="grafico-rotulo" aria-hidden="true">
                {b.etiqueta}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
