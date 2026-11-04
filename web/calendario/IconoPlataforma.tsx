import { Video } from 'lucide-react';
import type { Plataforma } from '../../compartido/tipos.js';

// Íconos propios y chicos (nada de paquetes de marcas): una forma reconocible con el color de la plataforma.
const TAMANO = 16;

/** Ícono de Teams, Meet o Zoom; sin plataforma conocida, una cámara. */
export function IconoPlataforma({ plataforma }: { plataforma: Plataforma | null }) {
  const comun = { width: TAMANO, height: TAMANO, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false } as const;
  switch (plataforma) {
    case 'teams':
      return (
        <svg {...comun}>
          <rect x="1" y="3" width="10" height="10" rx="2.4" fill="var(--tono-indigo)" />
          <path d="M3.6 6h4.8M6 6v5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <circle cx="12.4" cy="5" r="1.6" fill="var(--tono-indigo)" opacity=".7" />
          <path d="M11.6 8h3a.4.4 0 0 1 .4.4V10a2 2 0 0 1-2 2h-.6" fill="var(--tono-indigo)" opacity=".7" />
        </svg>
      );
    case 'meet':
      return (
        <svg {...comun}>
          <rect x="1" y="3.5" width="9" height="9" rx="2" fill="var(--tono-verde)" />
          <path d="M10.6 7 15 4.2v7.6L10.6 9z" fill="var(--tono-verde)" opacity=".75" />
        </svg>
      );
    case 'zoom':
      return (
        <svg {...comun}>
          <rect x="1" y="3.5" width="9.4" height="9" rx="2.4" fill="var(--tono-azul)" />
          <path d="M11 7 15 4.4v7.2L11 9z" fill="var(--tono-azul)" />
        </svg>
      );
    default:
      return <Video size={TAMANO} aria-hidden="true" />;
  }
}
