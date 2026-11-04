import { useRef } from 'react';
import { Boton } from '../ui/Boton.js';
import { Vidrio } from '../ui/Vidrio.js';
import { useDialogo } from '../horas/useDialogo.js';
import '../horas/horas.css';
import './reuniones.css';

export interface DialogoPermisoAvisosProps {
  alPermitir(): void;
  /** El clic en «Ahora no»: se guarda para no volver a preguntar. */
  alRechazar(): void;
  /** `Escape` con el foco adentro: se oculta por esta sesión, sin guardar nada. */
  alCerrar(): void;
}

/** Explica para qué es el permiso del navegador antes de pedirlo (el navegador lo exige desde un clic). */
export function DialogoPermisoAvisos({ alPermitir, alRechazar, alCerrar }: DialogoPermisoAvisosProps) {
  const ref = useRef<HTMLElement>(null);
  // El diálogo no bloquea la página: un Escape que viene de otro lado (un menú, un campo) no es para él.
  useDialogo(ref, () => {
    if (ref.current?.contains(document.activeElement)) alCerrar();
  });
  return (
    <Vidrio ref={ref} as="section" role="dialog" aria-modal="true" aria-labelledby="permiso-avisos-texto" className="reuniones-permiso">
      <p id="permiso-avisos-texto" className="horas-pregunta__texto">¿Te avisamos de las reuniones?</p>
      <div className="horas-pregunta__botones">
        <Boton variante="primario" onClick={alPermitir}>Permitir</Boton>
        <Boton variante="fantasma" onClick={alRechazar}>Ahora no</Boton>
      </div>
    </Vidrio>
  );
}
