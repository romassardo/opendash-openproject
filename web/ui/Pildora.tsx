import type { CSSProperties, ReactNode } from 'react';
import { unir } from './clases.js';

export interface PildoraProps {
  /** Color del punto y del tinte (cualquier color CSS, por ejemplo `var(--tono-azul)`). */
  color?: string;
  className?: string;
  children: ReactNode;
}

export function Pildora({ color, className, children }: PildoraProps) {
  const estilo = color ? ({ '--pildora-color': color } as CSSProperties) : undefined;
  return (
    <span className={unir('pildora', color && 'pildora--color', className)} style={estilo}>
      {color && <i className="pildora__punto" aria-hidden="true" />}
      <span className="pildora__texto">{children}</span>
    </span>
  );
}
