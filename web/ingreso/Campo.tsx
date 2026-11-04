import type { ComponentProps, ReactNode } from 'react';
import { ErrorApi } from '../api/cliente.js';

export interface CampoProps extends Omit<ComponentProps<'input'>, 'id'> {
  id: string;
  etiqueta: string;
  ayuda?: ReactNode;
}

/** Campo de texto con su etiqueta y, si hace falta, una ayuda debajo. */
export function Campo({ id, etiqueta, ayuda, className, ...resto }: CampoProps) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  return (
    <div className="campo">
      <label htmlFor={id} className="campo__etiqueta">{etiqueta}</label>
      <input id={id} className={['campo__entrada', className].filter(Boolean).join(' ')} aria-describedby={idAyuda} {...resto} />
      {ayuda && <p id={idAyuda} className="campo__ayuda">{ayuda}</p>}
    </div>
  );
}

/** Texto para mostrar de un error de la API (o uno genérico si no vino del servidor). */
export function mensajeDeError(error: unknown, generico: string): string {
  return error instanceof ErrorApi ? error.mensaje : generico;
}
