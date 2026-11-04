import type { ElementType, HTMLAttributes, ReactNode, Ref } from 'react';
import { unir } from './clases.js';

export type VarianteVidrio = 'tarjeta' | 'cromo' | 'denso';

export interface VidrioProps extends HTMLAttributes<HTMLElement> {
  ref?: Ref<HTMLElement>;
  as?: ElementType;
  variante?: VarianteVidrio;
  className?: string;
  children?: ReactNode;
}

/** Panel de vidrio esmerilado. A diferencia de la referencia, no tiene una luz que siga al puntero. */
export function Vidrio({ as: Etiqueta = 'div', variante = 'tarjeta', className, children, ...resto }: VidrioProps) {
  return (
    <Etiqueta
      data-entra="vidrio"
      {...resto}
      className={unir('vidrio', variante !== 'tarjeta' && `vidrio--${variante}`, className)}
    >
      {children}
    </Etiqueta>
  );
}
