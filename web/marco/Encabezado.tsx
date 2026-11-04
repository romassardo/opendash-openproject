import { Fragment, useRef, type ReactNode } from 'react';
import { useEntradaTitulo } from '../animaciones/entradas.js';

/** Título de pantalla que entra letra por letra; el nombre accesible es el texto entero. */
export function TituloPantalla({ texto }: { texto: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEntradaTitulo(ref, [texto]);
  return (
    <h1 ref={ref} className="titulo-pantalla" aria-label={texto}>
      {texto.split(' ').map((palabra, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="titulo__palabra" aria-hidden="true">
            {[...palabra].map((letra, j) => (
              <span key={j} className="titulo__letra" data-letra="">{letra}</span>
            ))}
          </span>
        </Fragment>
      ))}
    </h1>
  );
}

export interface EncabezadoPantallaProps {
  titulo: string;
  subtitulo?: ReactNode;
  /** Fila de abajo (contadores, acciones). */
  children?: ReactNode;
}

/** Encabezado de cada pantalla: deja libre el lugar de la barra de herramientas, arriba a la derecha. */
export function EncabezadoPantalla({ titulo, subtitulo, children }: EncabezadoPantallaProps) {
  return (
    <header className="encabezado">
      <div className="encabezado__texto">
        <TituloPantalla texto={titulo} />
        {subtitulo !== undefined && <p className="subtitulo-pantalla" data-entra="pieza">{subtitulo}</p>}
      </div>
      {children}
    </header>
  );
}
