import { useId, useState } from 'react';
import type { Persona } from '../../compartido/tipos.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { useCajaConfirmacion } from '../ui/confirmacion.js';
import { plural } from '../ui/plural.js';

interface Props {
  nombre: string;
  tareasAbiertas: number;
  /** Personas del proyecto a quienes se pueden pasar las tareas (sin la que se saca). */
  destinos: Persona[];
  pendiente: boolean;
  error: string | null;
  alConfirmar(pasarA: number | null): void;
  alCancelar(): void;
}

/** Confirmación de sacar a alguien del proyecto; si tiene tareas abiertas, pregunta a quién pasarlas. */
export function DialogoSacarMiembro({ nombre, tareasAbiertas, destinos, pendiente, error, alConfirmar, alCancelar }: Props) {
  const [destino, setDestino] = useState('');
  const idDestino = useId();
  const propsCaja = useCajaConfirmacion(alCancelar, pendiente);
  return (
    <div {...propsCaja} className="version__confirmar" role="group" aria-label={`Confirmar que ${nombre} salga del proyecto`}>
      <span>¿Sacar a “{nombre}” del proyecto?</span>
      {tareasAbiertas > 0 && (
        <>
          <label htmlFor={idDestino}>Sus {plural(tareasAbiertas, 'tarea abierta', 'tareas abiertas')}: pasarlas a</label>
          <select id={idDestino} className="version__estado" value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">Sin asignar</option>
            {destinos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </>
      )}
      <Boton variante="secundario" disabled={pendiente} onClick={() => alConfirmar(destino === '' ? null : Number(destino))}>Sacar</Boton>
      <Boton variante="fantasma" data-accion="cancelar" disabled={pendiente} onClick={alCancelar}>Cancelar</Boton>
      {error !== null && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}
