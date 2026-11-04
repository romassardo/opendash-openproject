import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { unir } from './clases.js';

export interface ContadorProps {
  etiqueta: string;
  valor: number | string;
  total?: number | string;
  /** Cambio respecto del período anterior (un `<Variacion />`), a la derecha del valor. */
  variacion?: ReactNode;
  className?: string;
  /** Si se da, el valor es un enlace a esa ruta. */
  enlace?: string;
}

export function Contador({ etiqueta, valor, total, variacion, className, enlace }: ContadorProps) {
  return (
    <dl className={unir('contador', className)} data-entra="vidrio">
      <dt className="contador__etiqueta">{etiqueta}</dt>
      <dd className="contador__valor tnum">
        {enlace === undefined ? <b>{valor}</b> : <Link to={enlace} className="contador__enlace"><b>{valor}</b></Link>}
        {total !== undefined && <small>{`/ ${total}`}</small>}
        {variacion}
      </dd>
    </dl>
  );
}
