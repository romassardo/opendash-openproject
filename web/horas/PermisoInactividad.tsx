import { useRef } from 'react';
import { Boton } from '../ui/Boton.js';
import { Vidrio } from '../ui/Vidrio.js';
import { useDialogo } from './useDialogo.js';
import './horas.css';

export interface PermisoInactividadProps {
  alPermitir(): void;
  alRechazar(): void;
}

/** Explica para qué es el permiso del navegador antes de pedirlo (el navegador lo exige desde un clic). */
export function PermisoInactividad({ alPermitir, alRechazar }: PermisoInactividadProps) {
  const ref = useRef<HTMLElement>(null);
  useDialogo(ref, alRechazar);
  return (
    <Vidrio ref={ref} as="section" role="dialog" aria-modal="true" aria-labelledby="permiso-inactividad-texto" aria-describedby="permiso-inactividad-texto" className="horas-pregunta">
      <p id="permiso-inactividad-texto" className="horas-pregunta__texto">Para preguntarte si seguías trabajando cuando la PC queda sin uso</p>
      <div className="horas-pregunta__botones">
        <Boton variante="primario" onClick={alPermitir}>Permitir</Boton>
        <Boton variante="fantasma" onClick={alRechazar}>Ahora no</Boton>
      </div>
    </Vidrio>
  );
}
