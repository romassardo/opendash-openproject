import { useState, type FormEvent } from 'react';
import { duracionTexto } from '../../compartido/horas.js';
import type { Tramo } from '../../compartido/tipos.js';
import { useTareas } from '../api/consultas.js';
import { mensajeDeError } from '../tareas/acciones.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { useHorasEnCurso } from './HorasProvider.js';
import './horas.css';

export interface CorreccionTramoProps {
  tramo: Tramo;
  /** Después de guardar bien. */
  alGuardar?(): void;
}

const MIN_HORA = 60;
const SEG_MIN = 60;

/** «Cargaste 3 h 10 m en «X»» con el campo de horas y minutos para corregirlo. */
export function CorreccionTramo({ tramo, alGuardar }: CorreccionTramoProps) {
  const { acciones } = useHorasEnCurso();
  const titulo = useTareas().data?.tareas.find((t) => t.id === tramo.tareaId)?.titulo ?? 'la tarea';
  const total = Math.round((tramo.segundos ?? 0) / SEG_MIN);
  const [horas, setHoras] = useState(String(Math.floor(total / MIN_HORA)));
  const [minutos, setMinutos] = useState(String(total % MIN_HORA));
  const [error, setError] = useState<string | null>(null);

  const guardar = async (evento: FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);
    const segundos = (Number(horas) * MIN_HORA + Number(minutos)) * SEG_MIN;
    if (!Number.isFinite(segundos) || segundos < SEG_MIN) {
      setError('Poné al menos 1 minuto');
      return;
    }
    try {
      await acciones.corregir(tramo.id, segundos);
      alGuardar?.();
    } catch (fallo) {
      setError(mensajeDeError(fallo));
    }
  };

  return (
    <form className="horas-correccion" onSubmit={(e) => void guardar(e)}>
      <p className="horas-correccion__texto">{`Cargaste ${duracionTexto(tramo.segundos ?? 0)} en «${titulo}»`}</p>
      <div className="horas-correccion__campos">
        <label className="horas-correccion__campo">
          <input type="number" min={0} max={12} inputMode="numeric" value={horas} onChange={(e) => setHoras(e.target.value)} aria-label="Horas" />
          <span>h</span>
        </label>
        <label className="horas-correccion__campo">
          <input type="number" min={0} max={59} inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value)} aria-label="Minutos" />
          <span>m</span>
        </label>
        <Boton variante="primario" type="submit" disabled={acciones.pendiente}>Guardar</Boton>
      </div>
      {error !== null && <Aviso tipo="error">{error}</Aviso>}
    </form>
  );
}
