import type { ReactNode } from 'react';
import { Vidrio } from '../ui/Vidrio.js';

export interface TarjetaSeccionProps {
  /** Clave de la sección: da el ancla `configuracion-<clave>` a la que lleva la navegación. */
  clave: string;
  titulo: string;
  subtitulo: string;
  children: ReactNode;
}

/** Una tarjeta de la derecha: cada sección de la pantalla. */
export function TarjetaSeccion({ clave, titulo, subtitulo, children }: TarjetaSeccionProps) {
  const id = `configuracion-${clave}`;
  return (
    <Vidrio as="section" id={id} className="configuracion__seccion" aria-labelledby={`${id}-titulo`}>
      <header className="configuracion__cabeza">
        <h2 id={`${id}-titulo`} className="tarjeta__titulo">{titulo}</h2>
        <p className="tarjeta__sub">{subtitulo}</p>
      </header>
      {children}
    </Vidrio>
  );
}
