import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Catalogo, Tarea } from '../../compartido/tipos.js';
import { mensajeDeError } from '../tareas/acciones.js';
import { opcionesResponsable } from '../tareas/edicion.js';
import { useAvisos } from '../ui/avisos.js';
import { Boton } from '../ui/Boton.js';
import { cambiarResponsable } from './escrituras.js';

export interface ElegirResponsableProps {
  tarea: Tarea;
  catalogo: Catalogo;
  alCerrar(): void;
  /** Id del globito: el botón que lo abrió lo señala con `aria-controls`. */
  id?: string;
}

/**
 * Lista de las personas que OpenProject deja asignar en el proyecto. Elegir y confirmar son dos gestos: recorrer la lista
 * con el teclado no asigna a nadie; se guarda con «Asignar».
 */
export function ElegirResponsable({ tarea, catalogo, alCerrar, id }: ElegirResponsableProps) {
  const cliente = useQueryClient();
  const avisos = useAvisos();
  const [guardando, setGuardando] = useState(false);
  const [valor, setValor] = useState('');
  const campo = useRef<HTMLSelectElement>(null);
  useEffect(() => campo.current?.focus(), []);
  const opciones = opcionesResponsable(tarea, catalogo);

  const asignar = async () => {
    if (valor === '' || guardando) return;
    setGuardando(true);
    try {
      await cambiarResponsable(cliente, tarea, Number(valor));
      alCerrar();
    } catch (error) {
      avisos.avisar({ texto: mensajeDeError(error), error: true });
      setGuardando(false);
    }
  };

  return (
    <div
      id={id}
      className="ordenar__globo"
      role="dialog"
      aria-label={`Responsable de «${tarea.titulo}»`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); alCerrar(); } }}
    >
      <label className="ordenar__campo">
        <span>Responsable</span>
        <select ref={campo} value={valor} disabled={guardando} onChange={(e) => setValor(e.target.value)}>
          <option value="">Elegir…</option>
          {opciones.filter((o) => o.valor !== '').map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </select>
      </label>
      <div className="ordenar__globo-botones">
        <Boton variante="primario" disabled={valor === '' || guardando} onClick={() => void asignar()}>Asignar</Boton>
      </div>
    </div>
  );
}
