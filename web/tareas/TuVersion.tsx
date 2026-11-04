import type { ReactNode } from 'react';
import { Boton } from '../ui/Boton.js';

export interface TuVersionProps {
  /** Nombre accesible del grupo («Tu versión del título»…). */
  etiqueta: string;
  ocupada?: boolean;
  alReaplicar(): void;
  alDescartar(): void;
  children: ReactNode;
}

/**
 * Lo que la persona quiso guardar cuando alguien cambió la tarea antes (conflicto). Arriba ya se ve la
 * versión nueva del servidor; acá queda lo escrito para reaplicarlo o descartarlo, sin perderlo.
 */
export function TuVersion({ etiqueta, ocupada = false, alReaplicar, alDescartar, children }: TuVersionProps) {
  return (
    <div role="group" aria-label={etiqueta} className="detalle-version">
      <p className="detalle-version__rotulo" aria-hidden="true">Tu versión</p>
      <div className="detalle-version__texto">{children}</div>
      <div className="detalle__botones">
        <Boton variante="fantasma" onClick={alDescartar}>Descartar</Boton>
        <Boton variante="secundario" disabled={ocupada} onClick={alReaplicar}>Reaplicar</Boton>
      </div>
    </div>
  );
}
