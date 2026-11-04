import { Link } from 'react-router';
import { Aviso } from '../ui/Aviso.js';

export interface NoEncontradoProps {
  mensaje: string;
  /** Sección a la que se vuelve. */
  seccion: { ruta: string; nombre: string };
}

/** Lo que se ve cuando la dirección apunta a un proyecto o una persona que esta persona no ve. */
export function NoEncontrado({ mensaje, seccion }: NoEncontradoProps) {
  return (
    <div className="pantalla">
      <Aviso tipo="info">{mensaje}</Aviso>
      <p><Link to={seccion.ruta}>{`Ir a ${seccion.nombre}`}</Link></p>
    </div>
  );
}
