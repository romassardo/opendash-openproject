import { diasEntre } from '../fechas.js';
import { unir } from '../ui/clases.js';
import { ANCHO_LISTA } from './medidas.js';
import { marcasDe, type Ventana, type Zoom } from './modelo.js';

/** Marcas de fecha sobre las pistas, alineadas con la rejilla. En Semana, el día feriado lo dice. */
export function EncabezadoFechas({ ventana, zoom, feriados }: { ventana: Ventana; zoom: Zoom; feriados: ReadonlyMap<string, string> }) {
  return (
    <div className={unir('linea__encabezado', zoom === 'semana' && 'linea__encabezado--semana')} style={{ gridTemplateColumns: `${ANCHO_LISTA}px ${ventana.dias * ventana.pxPorDia}px` }}>
      <div />
      <div className="linea__marcas">
        {marcasDe(ventana, zoom).map((m) => {
          const feriado = feriados.get(m.fecha);
          return (
            <span key={m.fecha} className="linea__marca" style={{ left: diasEntre(ventana.desde, m.fecha) * ventana.pxPorDia }} title={feriado}>
              {m.texto}
              {zoom === 'semana' && feriado !== undefined && <small className="linea__marca-feriado">Feriado</small>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
