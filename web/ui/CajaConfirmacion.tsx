import type { ReactNode } from 'react';
import { useCajaConfirmacion } from './confirmacion.js';

interface Props {
  className: string;
  etiqueta: string;
  alCancelar(): void;
  /** Guardando: `Escape` no hace nada. */
  bloqueada?: boolean;
  children: ReactNode;
}

/** Confirmación en línea: se monta cuando se pide y, al hacerlo, enfoca su botón con `data-accion="cancelar"`. */
export function CajaConfirmacion({ className, etiqueta, alCancelar, bloqueada = false, children }: Props) {
  const propiedades = useCajaConfirmacion(alCancelar, bloqueada);
  return <div {...propiedades} className={className} role="group" aria-label={etiqueta}>{children}</div>;
}
