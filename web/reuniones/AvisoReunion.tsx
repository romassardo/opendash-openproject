import { Bell, X } from 'lucide-react';
import { Vidrio } from '../ui/Vidrio.js';
import './reuniones.css';

export interface AvisoReunionProps {
  /** «En 5 min» o «Empezó». */
  cuando: string;
  titulo: string;
  /** Solo enlaces http(s) ya filtrados. */
  enlace: string | null;
  alCerrar(): void;
}

/** La pieza de arriba a la derecha que avisa de una reunión próxima. */
export function AvisoReunion({ cuando, titulo, enlace, alCerrar }: AvisoReunionProps) {
  return (
    <Vidrio role="status" className="aviso-reunion">
      <Bell size={16} aria-hidden="true" className="aviso-reunion__icono" />
      <p className="aviso-reunion__texto">
        <span className="aviso-reunion__cuando">{cuando}</span>
        <span aria-hidden="true"> · </span>
        <span className="aviso-reunion__titulo">{titulo}</span>
      </p>
      {enlace !== null && (
        <a className="aviso-reunion__unirse" href={enlace} target="_blank" rel="noopener noreferrer">Unirse</a>
      )}
      <button type="button" className="aviso-reunion__cerrar" aria-label="Cerrar aviso" onClick={alCerrar}>
        <X size={14} aria-hidden="true" />
      </button>
    </Vidrio>
  );
}
