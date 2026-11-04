import { useMemo } from 'react';
import { CeldaDia, type DatosDia } from './CeldaDia.js';
import { NOMBRES_DIAS, semanasDelMes } from './logica.js';

export interface GrillaMesProps {
  /** Cualquier día del mes que se muestra. */
  fecha: string;
  hoy: string;
  elegido: string;
  datosDe(fecha: string): DatosDia;
  alElegir(fecha: string): void;
}

/** Cuadrícula de 6 semanas de lunes a domingo. */
export function GrillaMes({ fecha, hoy, elegido, datosDe, alElegir }: GrillaMesProps) {
  const semanas = useMemo(() => semanasDelMes(fecha, hoy), [fecha, hoy]);
  return (
    <div className="cal-grilla" role="group" aria-label="Días del mes">
      {NOMBRES_DIAS.map((nombre) => <span key={nombre} className="cal-grilla__dia" data-corto={nombre.charAt(0)} aria-hidden="true">{nombre}</span>)}
      {semanas.flat().map((d) => (
        <CeldaDia key={d.fecha} datos={datosDe(d.fecha)} hoy={hoy} elegido={d.fecha === elegido} deOtroMes={!d.delMes} alElegir={alElegir} />
      ))}
    </div>
  );
}
