import { useState } from 'react';
import { Play } from 'lucide-react';
import { relojTexto } from '../../compartido/horas.js';
import { mensajeDeError } from '../tareas/acciones.js';
import { useHorasEnCurso } from './HorasProvider.js';
import './horas.css';

export interface BotonJugarChicoProps {
  tareaId: number;
  titulo: string;
}

const quieto = (evento: { stopPropagation(): void }): void => evento.stopPropagation();

/**
 * ▶ chico del tablero y la lista: aparece al pasar el mouse o con el foco (siempre visible sin hover); si la tarea corre, queda el reloj chico.
 * Nada de lo que pasa acá abre el panel ni empieza un arrastre de la tarjeta.
 */
export function BotonJugarChico({ tareaId, titulo }: BotonJugarChicoProps) {
  const { enMarcha, acciones, trabajar } = useHorasEnCurso();
  const [error, setError] = useState<string | null>(null);
  const tramo = enMarcha.find((t) => t.tareaId === tareaId) ?? null;

  if (tramo !== null) {
    return (
      <span className="horas-chico horas-chico--corre" onPointerDown={quieto} onClick={quieto}>
        <span className="horas-punto" data-pausa={tramo.pausado || undefined} aria-hidden="true" />
        <span className="tnum" role="timer" aria-label={`Tiempo trabajado en ${titulo}`}>{relojTexto(tramo.segundosVivos)}</span>
      </span>
    );
  }

  return (
    <span className="horas-chico" onPointerDown={quieto} onKeyDown={quieto} onClick={quieto}>
      <button
        type="button"
        className="horas-chico__jugar"
        aria-label={`Trabajar en esta: ${titulo}`}
        title={error ?? 'Trabajar en esta'}
        disabled={acciones.pendiente}
        onClick={() => {
          setError(null);
          trabajar(tareaId).catch((fallo: unknown) => setError(mensajeDeError(fallo)));
        }}
      >
        <Play size={13} aria-hidden="true" />
      </button>
      {error !== null && <span className="horas-chico__error" role="alert">{error}</span>}
    </span>
  );
}
