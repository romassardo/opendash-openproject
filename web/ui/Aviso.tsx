import type { ReactNode } from 'react';
import { CircleAlert, Info } from 'lucide-react';
import { unir } from './clases.js';

export interface AvisoProps {
  tipo: 'error' | 'info';
  className?: string;
  children: ReactNode;
}

/** Mensaje en línea: los errores se anuncian enseguida, la información con cortesía. */
export function Aviso({ tipo, className, children }: AvisoProps) {
  const Icono = tipo === 'error' ? CircleAlert : Info;
  return (
    <div role={tipo === 'error' ? 'alert' : 'status'} className={unir('aviso', `aviso--${tipo}`, className)}>
      <Icono className="aviso__icono" size={18} aria-hidden="true" />
      <div className="aviso__texto">{children}</div>
    </div>
  );
}
