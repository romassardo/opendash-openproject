import { numeroEs } from './geometria.js';
import './graficos.css';

export interface BarraCargaProps {
  horas: number;
  capacidad: number;
}

// La pista deja un respiro a la derecha de la capacidad para que la marca no quede pegada al borde.
const RESPIRO = 1.25;

const porcentaje = (parte: number, escala: number): string => `${Math.min(Math.max((parte / escala) * 100, 0), 100)}%`;

/** Barra horizontal de carga con marca de capacidad; el tramo que pasa la capacidad va en rojo. */
export function BarraCarga({ horas, capacidad }: BarraCargaProps) {
  const cargado = Math.max(0, Number.isFinite(horas) ? horas : 0);
  const tope = Math.max(0, Number.isFinite(capacidad) ? capacidad : 0);
  const excedida = cargado > tope;
  const escala = Math.max(tope * RESPIRO, cargado) || 1;
  const nombre = `${numeroEs(cargado)} h de ${numeroEs(tope)} h${excedida ? ', excedida' : ''}`;
  return (
    <div
      role="meter"
      aria-label={nombre}
      aria-valuemin={0}
      aria-valuemax={tope}
      aria-valuenow={cargado}
      data-excedida={excedida ? 'true' : undefined}
      className="barra-carga"
    >
      <span className="barra-carga__relleno" style={{ width: porcentaje(Math.min(cargado, tope), escala) }} />
      {excedida && (
        <span className="barra-carga__exceso" style={{ left: porcentaje(tope, escala), width: porcentaje(cargado - tope, escala) }} />
      )}
      <span className="barra-carga__marca" style={{ left: porcentaje(tope, escala) }} />
    </div>
  );
}
