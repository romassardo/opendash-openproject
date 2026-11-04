import { useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { Vidrio } from '../ui/Vidrio.js';
import { EncabezadoPantalla } from './Encabezado.js';
import type { Seccion } from './secciones.js';

/** Pantallas de etapas siguientes: el encabezado y un panel «Próximamente». */
export function PantallaProximamente({ seccion }: { seccion: Seccion }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(ref);
  const Icono = seccion.icono;
  return (
    <div ref={ref} className="pantalla">
      <EncabezadoPantalla titulo={seccion.nombre} subtitulo="Esta pantalla llega en una próxima etapa" />
      <Vidrio as="section" className="proximamente" aria-labelledby="proximamente-titulo">
        <span className="proximamente__icono" aria-hidden="true">
          <Icono size={26} />
        </span>
        <h2 id="proximamente-titulo" className="proximamente__titulo">Próximamente</h2>
        <p className="tarjeta__sub proximamente__texto">
          Todavía la estamos armando. Mientras tanto, tus tareas siguen en Tareas.
        </p>
        <Link to="/tareas" className="boton boton--fantasma">
          Ir a Tareas
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </Vidrio>
    </div>
  );
}
