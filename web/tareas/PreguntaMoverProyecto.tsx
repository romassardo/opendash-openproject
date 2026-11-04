import { useId, useLayoutEffect, useRef } from 'react';
import { Boton } from '../ui/Boton.js';

export interface PreguntaMoverProyectoProps {
  proyecto: string;
  alMover(): void;
  alCancelar(): void;
}

/** Confirmación del cambio de proyecto: mover puede dejar la tarea sin su versión ni su tarea madre. */
export function PreguntaMoverProyecto({ proyecto, alMover, alCancelar }: PreguntaMoverProyectoProps) {
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    caja.current?.querySelector<HTMLButtonElement>('[data-accion="mover"]')?.focus();
  }, []);
  return (
    <div
      ref={caja}
      className="detalle-salida detalle-salida--fijo"
      role="alertdialog"
      aria-labelledby={id}
      data-conserva-borrador=""
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          alCancelar();
        }
      }}
    >
      <p id={id} className="detalle-salida__titulo">¿Mover la tarea a «{proyecto}»?</p>
      <p className="detalle-salida__texto">Puede perder su versión y su tarea madre si no existen en ese proyecto.</p>
      <div className="detalle__botones">
        <Boton variante="fantasma" onClick={alCancelar}>Cancelar</Boton>
        <Boton variante="primario" data-accion="mover" onClick={alMover}>Mover</Boton>
      </div>
    </div>
  );
}
