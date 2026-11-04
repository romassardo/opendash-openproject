import { Clock } from 'lucide-react';
import type { Tarea } from '../../compartido/tipos.js';
import { horasDe } from '../linea/horas.js';
import { unir } from '../ui/clases.js';

/** «2 h / ~5 h» (trabajadas contra estimadas) en la tarjeta y en la lista; en rojo si ya se pasó. Sin horas, no dibuja. */
export function HorasTarea({ tarea, cerrada }: { tarea: Tarea; cerrada: boolean }) {
  const horas = horasDe(tarea, cerrada);
  if (horas === null) return null;
  return (
    <span className={unir('horas-tarea', horas.pasada && 'horas-tarea--pasada')} title={horas.descripcion}>
      <Clock size={13} aria-hidden="true" />
      <span className="tnum" aria-hidden="true">{horas.texto}</span>
      <span className="sr-only">{horas.descripcion}</span>
    </span>
  );
}
