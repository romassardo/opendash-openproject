import { useState, type CSSProperties } from 'react';
import type { Persona, Presencia } from '../../compartido/tipos.js';
import { unir } from './clases.js';
import { tonoPara } from './tonos.js';

export interface AvatarProps {
  persona: Persona | null;
  tamano?: number;
  /** Punto de presencia en la esquina; sin él no se dibuja nada. */
  presencia?: Presencia;
  /** Atajo de `presencia="conectado"` (la usan las pantallas de la parte 1). */
  enLinea?: boolean;
  className?: string;
}

const AVISO_PRESENCIA: Record<Presencia, string> = {
  conectado: 'conectado',
  trabajando: 'trabajando',
  reunion: 'en reunión',
  vacaciones: 'de vacaciones',
  ausente: 'ausente',
  'sin-opendash': 'sin OpenDash',
};

export function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  const primera = palabras[0]?.[0] ?? '';
  const ultima = palabras.length > 1 ? (palabras[palabras.length - 1]?.[0] ?? '') : '';
  return (primera + ultima).toLocaleUpperCase('es-AR') || '?';
}

export function Avatar({ persona, tamano = 32, presencia, enLinea = false, className }: AvatarProps) {
  const estado: Presencia | undefined = presencia ?? (enLinea ? 'conectado' : undefined);
  // URL de la foto que no cargó: se muestran las iniciales hasta que cambie la URL.
  const [rota, setRota] = useState<string | null>(null);
  const grande = tamano >= 64;
  const tono = persona ? tonoPara(persona.id) : null;
  const estilo = {
    width: tamano,
    height: tamano,
    fontSize: Math.round(tamano * 0.4),
    '--avatar-tono': tono ? `var(--tono-${tono})` : undefined,
  } as CSSProperties;
  const nombre = persona ? `${persona.nombre}${estado ? `, ${AVISO_PRESENCIA[estado]}` : ''}` : 'Sin asignar';
  const punto = estado && (
    <i
      className="avatar__presencia"
      data-presencia={estado}
      style={{ width: Math.max(9, Math.round(tamano * 0.22)) }}
      aria-hidden="true"
    />
  );

  const foto = persona?.avatarUrl ?? null;
  if (foto !== null && foto !== rota) {
    return (
      <span className={unir('avatar', grande && 'avatar--grande', className)} style={estilo}>
        <img
          src={foto}
          alt={nombre}
          width={tamano}
          height={tamano}
          style={{ width: tamano, height: tamano }}
          onError={() => setRota(foto)}
        />
        {punto}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={nombre}
      className={unir('avatar', persona ? 'avatar--iniciales' : 'avatar--vacio', grande && 'avatar--grande', className)}
      style={estilo}
    >
      <span aria-hidden="true">{persona ? iniciales(persona.nombre) : '?'}</span>
      {punto}
    </span>
  );
}
