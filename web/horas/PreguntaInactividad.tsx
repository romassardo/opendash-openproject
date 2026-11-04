import { useRef } from 'react';
import { useTareas } from '../api/consultas.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { horaArgentina } from '../ui/tiempo.js';
import { Vidrio } from '../ui/Vidrio.js';
import { useDialogo } from './useDialogo.js';
import './horas.css';

export interface PreguntaInactividadProps {
  desde: Date;
  /** Las tareas que estaban corriendo. */
  tareaIds: number[];
  alResponder(seguia: boolean, desde: Date): void;
  /** Si la respuesta no llegó al servidor, la pregunta sigue y se puede volver a contestar. */
  error?: string | null;
}

/** «Estuviste sin actividad desde las 12:40. ¿Seguías trabajando en «X»?»: no corta nada hasta que se contesta. */
export function PreguntaInactividad({ desde, tareaIds, alResponder, error = null }: PreguntaInactividadProps) {
  const tareas = useTareas().data?.tareas;
  const titulos = tareaIds.map((id) => tareas?.find((t) => t.id === id)?.titulo ?? 'la tarea');
  const hora = horaArgentina(desde.toISOString());
  const ref = useRef<HTMLElement>(null);
  // Escape contesta lo que no corta nada: «Sí, seguía».
  useDialogo(ref, () => alResponder(true, desde));
  return (
    <Vidrio ref={ref} as="section" role="alertdialog" aria-modal="true" aria-labelledby="inactividad-titulo" aria-describedby="inactividad-titulo" className="horas-pregunta">
      <p id="inactividad-titulo" className="horas-pregunta__texto">
        {`Estuviste sin actividad desde las ${hora}. ¿Seguías trabajando en ${titulos.map((t) => `«${t}»`).join(', ')}?`}
      </p>
      {error !== null && <Aviso tipo="error">{error}</Aviso>}
      <div className="horas-pregunta__botones">
        <Boton variante="primario" onClick={() => alResponder(true, desde)}>Sí, seguía</Boton>
        <Boton variante="secundario" onClick={() => alResponder(false, desde)}>{`No, paré a las ${hora}`}</Boton>
      </div>
    </Vidrio>
  );
}
