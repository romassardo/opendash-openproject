import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Tarea } from '../../compartido/tipos.js';
import { ErrorApi, pedir } from '../api/cliente.js';
import { CLAVES } from '../api/consultas.js';
import { mensajeDeError, ponerTarea } from '../tareas/acciones.js';
import { leerHoras, MSG_HORAS } from '../tareas/edicion.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { useHorasEnCurso } from './HorasProvider.js';
import './horas.css';

const MSG_CAMBIO = 'La tarea cambió en OpenProject. Probá de nuevo.';

/** Recién arrancada una tarea sin «Estimado»: una línea para cargarlo, o «Ahora no» (hoy no se vuelve a pedir). */
export function PedirEstimacion({ tarea }: { tarea: Tarea }) {
  const { terminarEstimacion } = useHorasEnCurso();
  const cliente = useQueryClient();
  const id = useId();
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (evento: FormEvent): Promise<void> => {
    evento.preventDefault();
    const { valida, horas } = leerHoras(valor);
    if (!valida || horas === null || horas <= 0) {
      setError(MSG_HORAS);
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      const guardada = await pedir<Tarea>('PATCH', `/api/tareas/${tarea.id}`, { lockVersion: tarea.lockVersion, cambios: { estimacionHoras: horas } });
      // Una lectura en curso traería la versión anterior: se cancela antes de poner la nueva.
      await cliente.cancelQueries({ queryKey: CLAVES.tareas });
      ponerTarea(cliente, guardada);
      terminarEstimacion(tarea.id, false);
    } catch (fallo) {
      if (fallo instanceof ErrorApi && fallo.codigo === 'conflicto') {
        // Se relee la tarea: el próximo «Guardar» sale con su versión nueva.
        void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
        setError(MSG_CAMBIO);
      } else {
        setError(mensajeDeError(fallo));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Aviso tipo="info" className="horas-aviso">
      <form className="horas-estimar" aria-label={`Estimado de ${tarea.titulo}`} noValidate onSubmit={(e) => void guardar(e)}>
        <label htmlFor={id} className="horas-aviso__texto horas-estimar__pregunta">{`«${tarea.titulo}» no tiene estimado. ¿Cuántas horas le calculás?`}</label>
        <div className="horas-aviso__botones">
          <span className="horas-estimar__caja">
            <input id={id} className="horas-estimar__campo" inputMode="decimal" autoComplete="off" placeholder="2"
              value={valor} onChange={(e) => setValor(e.target.value)} />
            <span aria-hidden="true">h</span>
          </span>
          <Boton variante="primario" type="submit" disabled={guardando}>Guardar</Boton>
          <Boton variante="fantasma" disabled={guardando} onClick={() => terminarEstimacion(tarea.id, true)}>Ahora no</Boton>
        </div>
      </form>
      {error !== null && <p className="horas-aviso__error" role="alert">{error}</p>}
    </Aviso>
  );
}
