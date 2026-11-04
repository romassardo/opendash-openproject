import { rangoDias, semanaDe } from '../fechas.js';
import { CeldaDia, type DatosDia } from './CeldaDia.js';
import { NOMBRES_DIAS } from './logica.js';

export interface VistaSemanaProps {
  /** Cualquier día de la semana que se muestra. */
  fecha: string;
  hoy: string;
  elegido: string;
  datosDe(fecha: string): DatosDia;
  alElegir(fecha: string): void;
}

/** Siete columnas de lunes a domingo, con todas las reuniones de cada día y su hora. */
export function VistaSemana({ fecha, hoy, elegido, datosDe, alElegir }: VistaSemanaProps) {
  const { lunes, domingo } = semanaDe(fecha);
  return (
    <div className="cal-grilla cal-grilla--semana" role="group" aria-label="Días de la semana">
      {NOMBRES_DIAS.map((nombre) => <span key={nombre} className="cal-grilla__dia" data-corto={nombre.charAt(0)} aria-hidden="true">{nombre}</span>)}
      {rangoDias(lunes, domingo).map((dia) => (
        <CeldaDia key={dia} datos={datosDe(dia)} hoy={hoy} elegido={dia === elegido} completa alElegir={alElegir} />
      ))}
    </div>
  );
}
