import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { unir } from '../ui/clases.js';
import { Vidrio } from '../ui/Vidrio.js';

export interface SeccionOrdenarProps {
  titulo: string;
  cantidad: number;
  children: ReactNode;
}

/** Una sección de «Para ordenar»: título con su cantidad, plegable. */
export function SeccionOrdenar({ titulo, cantidad, children }: SeccionOrdenarProps) {
  const [abierta, setAbierta] = useState(true);
  const id = useId();
  return (
    <Vidrio as="section" className="ordenar__seccion" aria-labelledby={id}>
      <h2 className="lista__grupo-cabeza">
        <button type="button" id={id} className="lista__grupo-boton" aria-expanded={abierta} onClick={() => setAbierta(!abierta)}>
          <ChevronDown size={16} className={unir('lista__chevron', !abierta && 'lista__chevron--cerrado')} aria-hidden="true" />
          <span>{titulo}</span>
          <span className="columna__cuenta tnum">{cantidad}</span>
        </button>
      </h2>
      {abierta && <ul className="lista__filas">{children}</ul>}
    </Vidrio>
  );
}
