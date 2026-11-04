import { Star } from 'lucide-react';

export interface EstrellaProps {
  activa: boolean;
  /** Nombre de lo que se fija (un proyecto); arma el nombre accesible del botón. */
  nombre: string;
  onCambio(activa: boolean): void;
}

export function Estrella({ activa, nombre, onCambio }: EstrellaProps) {
  return (
    <button
      type="button"
      className="estrella"
      aria-pressed={activa}
      aria-label={`Fijar ${nombre}`}
      onClick={() => onCambio(!activa)}
    >
      <Star size={17} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
