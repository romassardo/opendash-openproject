import type { ReactNode } from 'react';
import { useCatalogo } from '../api/consultas.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { SeccionMiembros } from './SeccionMiembros.js';
import { SeccionVersiones } from './SeccionVersiones.js';
import '../tareas/tareas.css';
import './proyectos.css';

/** Pestaña «Miembros y versiones» de un proyecto (`?vista=gestion`). */
export function PantallaProyectoGestion({ proyectoId, pestanas }: { proyectoId: number; pestanas: ReactNode }) {
  const catalogo = useCatalogo();
  const nombre = catalogo.data?.proyectos.find((p) => p.id === proyectoId)?.nombre ?? 'Proyecto';
  return (
    <div className="pantalla pantalla-gestion">
      <EncabezadoPantalla titulo={nombre}>
        <div className="tareas__barra"><div className="tareas__acciones" data-entra="pieza">{pestanas}</div></div>
      </EncabezadoPantalla>
      <SeccionMiembros proyectoId={proyectoId} />
      <SeccionVersiones proyectoId={proyectoId} />
    </div>
  );
}
