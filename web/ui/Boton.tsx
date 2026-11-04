import type { ComponentProps, ReactNode } from 'react';
import { unir } from './clases.js';

export type VarianteBoton = 'primario' | 'secundario' | 'fantasma';

export interface BotonProps extends ComponentProps<'button'> {
  variante: VarianteBoton;
  icono?: ReactNode;
  children?: ReactNode;
}

export function Boton({ variante, icono, children, className, type = 'button', ...resto }: BotonProps) {
  return (
    <button {...resto} type={type} data-variante={variante} className={unir('boton', `boton--${variante}`, className)}>
      {icono && <span className="boton__icono" aria-hidden="true">{icono}</span>}
      {children}
    </button>
  );
}
