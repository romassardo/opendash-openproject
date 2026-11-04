import type { CSSProperties } from 'react';
import { Flag } from 'lucide-react';
import { cuentaComoReunion } from '../../compartido/calendario.js';
import type { Reunion } from '../../compartido/tipos.js';
import { unir } from '../ui/clases.js';
import { Pildora } from '../ui/Pildora.js';
import { colorPlataforma, diaLargo, horaTexto } from './logica.js';
import { plural } from '../ui/plural.js';

/** Lo que se sabe de un día para dibujarlo. */
export interface DatosDia {
  fecha: string;
  reuniones: Reunion[];
  /** Tareas propias e hitos que vencen ese día. */
  vencen: number;
  feriado: string | null;
  vacaciones: boolean;
}

export interface CeldaDiaProps {
  datos: DatosDia;
  hoy: string;
  elegido: boolean;
  /** Fuera del mes que se muestra: más apagado. */
  deOtroMes?: boolean;
  /** Vista Semana: todas las reuniones, cada una con su hora. */
  completa?: boolean;
  alElegir(fecha: string): void;
}

const MAXIMO_ETIQUETAS = 3;

function nombreAccesible({ fecha, reuniones, vencen, feriado, vacaciones }: DatosDia): string {
  // Los eventos de día entero y los «libres» se ven, pero no cuentan como reunión.
  const cuentan = reuniones.filter(cuentaComoReunion).length;
  const partes = [`${diaLargo(fecha)}, ${cuentan === 0 ? 'sin reuniones' : plural(cuentan, 'reunión', 'reuniones')}`];
  if (feriado) partes.push(`feriado: ${feriado}`);
  if (vacaciones) partes.push('vacaciones');
  if (vencen > 0) partes.push(`vencimientos: ${vencen}`);
  return partes.join(', ');
}

/** Un día de la grilla: el botón entero elige el día; adentro solo hay texto, nada que se pueda apretar. */
export function CeldaDia({ datos, hoy, elegido, deOtroMes = false, completa = false, alElegir }: CeldaDiaProps) {
  const { fecha, reuniones, vencen, feriado, vacaciones } = datos;
  const visibles = completa ? reuniones : reuniones.slice(0, MAXIMO_ETIQUETAS);
  const restantes = reuniones.length - visibles.length;
  const esHoy = fecha === hoy;
  return (
    <button
      type="button"
      className={unir('cal-dia', deOtroMes && 'cal-dia--otro', esHoy && 'cal-dia--hoy', elegido && 'cal-dia--elegido', completa && 'cal-dia--completa')}
      aria-label={nombreAccesible(datos)}
      aria-pressed={elegido}
      data-vacaciones={vacaciones ? '' : undefined}
      onClick={() => alElegir(fecha)}
    >
      <span className="cal-dia__cabeza">
        <span className="cal-dia__numero tnum">{Number(fecha.slice(8))}</span>
        {restantes > 0 && <span className="cal-dia__mas">{`+${restantes} más`}</span>}
        {vencen > 0 && <Flag className="cal-dia__bandera" size={14} aria-hidden="true" />}
      </span>
      {feriado && <Pildora color="var(--tono-rosa)" className="cal-dia__feriado">{feriado}</Pildora>}
      {visibles.map((r) => (
        <span key={`${r.id}-${fecha}`} className={unir('cal-etiqueta', r.libre && 'cal-etiqueta--libre')} style={{ '--barra': colorPlataforma(r.plataforma) } as CSSProperties}>
          {completa && <b className="cal-etiqueta__hora tnum">{r.diaEntero ? 'Todo el día' : horaTexto(r.inicio)}</b>}
          <span className="cal-etiqueta__titulo">{r.titulo}</span>
          {completa && r.libre && <span className="cal-etiqueta__libre">Libre</span>}
        </span>
      ))}
    </button>
  );
}
