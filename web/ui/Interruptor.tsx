import { useId } from 'react';
import { unir } from './clases.js';

export interface InterruptorProps {
  etiqueta: string;
  ayuda?: string;
  activo: boolean;
  deshabilitado?: boolean;
  onCambio(activo: boolean): void;
}

/** Interruptor prendido/apagado: un botón `switch`; Espacio y Enter lo accionan. */
export function Interruptor({ etiqueta, ayuda, activo, deshabilitado = false, onCambio }: InterruptorProps) {
  const id = useId();
  const idEtiqueta = `${id}-etiqueta`;
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  return (
    <div className="interruptor">
      <div className="interruptor__texto">
        <span id={idEtiqueta} className="interruptor__etiqueta">{etiqueta}</span>
        {ayuda && <span id={idAyuda} className="interruptor__ayuda">{ayuda}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-labelledby={idEtiqueta}
        aria-describedby={idAyuda}
        aria-disabled={deshabilitado ? true : undefined}
        className={unir('interruptor__boton', activo && 'interruptor__boton--activo')}
        onClick={() => { if (!deshabilitado) onCambio(!activo); }}
      >
        <span className="interruptor__perilla" aria-hidden="true" />
      </button>
    </div>
  );
}
