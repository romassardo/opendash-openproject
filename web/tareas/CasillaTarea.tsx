import { useCallback, useState } from 'react';
import { Check } from 'lucide-react';
import type { Catalogo, Tarea } from '../../compartido/tipos.js';
import { unir } from '../ui/clases.js';
import { useAvisoDeCierre, useMoverTarea } from './acciones.js';
import { columnaDeTarea } from './logica.js';

/** Lo que necesita una casilla para cerrar o reabrir: la acción y qué tareas están esperando al servidor. */
export interface Completador {
  completar(tarea: Tarea, catalogo: Catalogo): Promise<void>;
  enVuelo: ReadonlySet<number>;
}

/**
 * Cerrar, o reabrir en «Nuevo», es igual que soltar la tarjeta en esa columna del tablero.
 * Una tarea en vuelo no vuelve a enviarse hasta que el servidor responde; si falla, `alFallar` recibe el motivo.
 */
export function useCompletarTarea(alFallar: (mensaje: string) => void): Completador {
  // El callback va envuelto: useMoverTarea también pasa el error como segundo argumento.
  const alFallarMover = useCallback((mensaje: string) => alFallar(mensaje), [alFallar]);
  const mover = useMoverTarea(alFallarMover);
  const publicarCierre = useAvisoDeCierre();
  const [enVuelo, setEnVuelo] = useState<ReadonlySet<number>>(new Set());

  const completar = useCallback(async (tarea: Tarea, catalogo: Catalogo): Promise<void> => {
    if (enVuelo.has(tarea.id)) return;
    const estabaCerrada = columnaDeTarea(tarea, catalogo) === 'cerrado';
    setEnVuelo((previo) => new Set(previo).add(tarea.id));
    try {
      const guardada = await mover(tarea, estabaCerrada ? 'nuevo' : 'cerrado', catalogo);
      if (guardada) publicarCierre(tarea, estabaCerrada, guardada);
    } finally {
      setEnVuelo((previo) => new Set([...previo].filter((x) => x !== tarea.id)));
    }
  }, [enVuelo, mover, publicarCierre]);

  return { completar, enVuelo };
}

export interface CasillaTareaProps {
  tarea: Tarea;
  catalogo: Catalogo;
  accion: Completador;
}

/** Casilla redonda de cerrar o reabrir una tarea (la de las listas, el detalle y Mis tareas). */
export function CasillaTarea({ tarea, catalogo, accion }: CasillaTareaProps) {
  const cerrada = columnaDeTarea(tarea, catalogo) === 'cerrado';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={cerrada}
      aria-label={`${cerrada ? 'Reabrir' : 'Completar'} «${tarea.titulo}»`}
      disabled={accion.enVuelo.has(tarea.id)}
      className={unir('lista__check', cerrada && 'lista__check--hecha')}
      onClick={(evento) => {
        // Dentro de una fila clicable, la casilla no abre la tarea.
        evento.stopPropagation();
        void accion.completar(tarea, catalogo);
      }}
    >
      {cerrada && <Check size={13} aria-hidden="true" />}
    </button>
  );
}
