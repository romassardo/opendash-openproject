import { useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { relojTexto } from '../../compartido/horas.js';
import { mensajeDeError } from '../tareas/acciones.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { useHorasEnCurso } from './HorasProvider.js';
import './horas.css';

export interface BotonTrabajarProps {
  tareaId: number;
  titulo: string;
}

/** ▶ «Trabajar en esta» o, si esa tarea corre, el reloj con «Pausa» («Seguir» si está en pausa) y «Terminar». */
export function BotonTrabajar({ tareaId, titulo }: BotonTrabajarProps) {
  const { enMarcha, acciones, trabajar, seguir } = useHorasEnCurso();
  const [error, setError] = useState<string | null>(null);
  const tramo = enMarcha.find((t) => t.tareaId === tareaId) ?? null;

  const ejecutar = async (accion: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await accion();
    } catch (fallo) {
      setError(mensajeDeError(fallo));
    }
  };

  return (
    <div className="horas-trabajar">
      {tramo === null ? (
        <Boton variante="primario" icono={<Play />} disabled={acciones.pendiente} aria-label={`Trabajar en esta: ${titulo}`}
          onClick={() => void ejecutar(() => trabajar(tareaId))}>
          Trabajar en esta
        </Boton>
      ) : (
        <div className="horas-trabajar__corre">
          <span className="horas-punto" data-pausa={tramo.pausado || undefined} aria-hidden="true" />
          <span className="horas-trabajar__reloj tnum" role="timer" aria-label={`Tiempo trabajado en ${titulo}`}>{relojTexto(tramo.segundosVivos)}</span>
          <Boton variante="secundario" icono={tramo.pausado ? <Play /> : <Pause />} disabled={acciones.pendiente}
            onClick={() => void ejecutar(() => (tramo.pausado ? seguir(tramo.id) : acciones.pausar(tramo.id)))}>
            {tramo.pausado ? 'Seguir' : 'Pausa'}
          </Boton>
          <Boton variante="secundario" icono={<Square />} disabled={acciones.pendiente} onClick={() => void ejecutar(() => acciones.terminar(tramo.id))}>
            Terminar
          </Boton>
        </div>
      )}
      {error !== null && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}
