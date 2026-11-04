import type { Fila } from './filas.js';
import type { ContextoLinea } from './contextoLinea.js';
import { ALTO_TERMINADAS, ANCHO_LISTA } from './medidas.js';

type FilaTerminadas = Extract<Fila, { tipo: 'terminadas' }>;

/** Cierre de una franja: cuántas terminadas hay y el botón para mostrarlas u ocultarlas. */
export function RenglonTerminadas({ fila, ctx, ancho }: { fila: FilaTerminadas; ctx: ContextoLinea; ancho: number }) {
  return (
    <div className="renglon renglon--terminadas" style={{ height: ALTO_TERMINADAS, gridTemplateColumns: `${ANCHO_LISTA}px ${ancho}px` }}>
      <div className="renglon__lista">
        <b className="renglon__tilde" aria-hidden="true">✓</b>
        <span>{fila.cantidad} {fila.cantidad === 1 ? 'terminada' : 'terminadas'}</span>
        <button type="button" className="renglon__alternar" aria-expanded={fila.visibles} onClick={() => ctx.alternarTerminadas(fila.franja)}>
          {fila.visibles ? 'ocultar' : 'mostrar'}
        </button>
      </div>
      <div className="renglon__pista" />
    </div>
  );
}
