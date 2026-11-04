import { diasEntre } from '../fechas.js';
import type { Tramo } from './ausencias.js';
import type { Ventana } from './modelo.js';

/** Rayas sobre los días de vacaciones, recortadas a la ventana. */
export function Rayas({ tramos, ventana }: { tramos: readonly Tramo[] | undefined; ventana: Ventana }) {
  if (!tramos) return null;
  const visibles = tramos.filter((t) => t.hasta >= ventana.desde && t.desde <= ventana.hasta);
  return (
    <>
      {visibles.map((t) => {
        const desde = t.desde < ventana.desde ? ventana.desde : t.desde;
        const hasta = t.hasta > ventana.hasta ? ventana.hasta : t.hasta;
        return (
          <i
            key={`${t.desde}-${t.hasta}`}
            className="renglon__vacaciones"
            aria-hidden="true"
            style={{ left: diasEntre(ventana.desde, desde) * ventana.pxPorDia, width: (diasEntre(desde, hasta) + 1) * ventana.pxPorDia }}
          />
        );
      })}
    </>
  );
}
