import { useRef } from 'react';
import { Boton } from '../ui/Boton.js';
import { Vidrio } from '../ui/Vidrio.js';
import { useDialogo } from './useDialogo.js';
import './horas.css';

export interface ConfirmarHorasExtraProps {
  jornadaHoras: number;
  alSeguir(): void;
  alCancelar(): void;
}

/** Con el día lleno, antes de arrancar: seguir como horas extra (hoy el tope ya no frena) o dejarlo ahí. */
export function ConfirmarHorasExtra({ jornadaHoras, alSeguir, alCancelar }: ConfirmarHorasExtraProps) {
  const ref = useRef<HTMLElement>(null);
  useDialogo(ref, alCancelar);
  return (
    <Vidrio ref={ref} as="section" role="dialog" aria-modal="true" aria-labelledby="horas-extra-titulo" aria-describedby="horas-extra-texto" className="horas-pregunta">
      <p id="horas-extra-titulo" className="horas-pregunta__texto">{`Ya llegaste a las ${jornadaHoras} h de hoy`}</p>
      <p id="horas-extra-texto" className="horas-pregunta__detalle">Si seguís, lo que trabajes de acá en más cuenta como horas extra y hoy el reloj ya no se frena solo.</p>
      <div className="horas-pregunta__botones">
        <Boton variante="primario" onClick={alSeguir}>Seguir con horas extra</Boton>
        <Boton variante="fantasma" onClick={alCancelar}>Cancelar</Boton>
      </div>
    </Vidrio>
  );
}
