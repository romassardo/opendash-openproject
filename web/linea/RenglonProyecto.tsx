import type { CSSProperties } from 'react';
import type { Fila } from './filas.js';
import { ALTO_PROYECTO, ANCHO_LISTA } from './medidas.js';

type FilaProyecto = Extract<Fila, { tipo: 'proyecto' }>;

/** Renglón del proyecto dentro de la franja de una persona, con su color difuminado de fondo. */
export function RenglonProyecto({ fila, ancho }: { fila: FilaProyecto; ancho: number }) {
  const estilo = { height: ALTO_PROYECTO, gridTemplateColumns: `${ANCHO_LISTA}px ${ancho}px`, '--tono-fila': `var(--tono-${fila.tono})` } as CSSProperties;
  return (
    <div className="renglon renglon--proyecto renglon--tinte" style={estilo}>
      <div className="renglon__lista">
        <i className="renglon__punto-proyecto" aria-hidden="true" />
        <span className="renglon__titulo">{fila.titulo}</span>
      </div>
      <div className="renglon__pista" />
    </div>
  );
}
