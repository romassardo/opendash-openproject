import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useCatalogo } from '../api/consultas.js';
import { NoEncontrado } from '../marco/NoEncontrado.js';
import { idDeRuta } from '../tareas/baseTareas.js';
import { PantallaTareas } from '../tareas/PantallaTareas.js';
import { Segmentado, type OpcionSegmentado } from '../ui/Segmentado.js';
import { PantallaProyectoGestion } from './PantallaProyectoGestion.js';

type Parte = 'tablero' | 'gestion';
const PARTES: OpcionSegmentado<Parte>[] = [
  { valor: 'tablero', etiqueta: 'Tablero' },
  { valor: 'gestion', etiqueta: 'Miembros y versiones' },
];

/** `/proyectos/:id`: el tablero y la lista de tareas de un solo proyecto, y (`?vista=gestion`) sus miembros y versiones. */
export function PantallaProyecto() {
  const { id = '' } = useParams();
  const proyectoId = idDeRuta(id);
  const catalogo = useCatalogo();
  const [params, setParams] = useSearchParams();
  const parte: Parte = params.get('vista') === 'gestion' ? 'gestion' : 'tablero';
  // Cada parte dibuja su propio control: al cambiar de parte el que tenía el foco se desmonta y el nuevo lo recibe.
  const [conFoco, setConFoco] = useState(false);
  const elegir = (nueva: Parte) => {
    setConFoco(true);
    const siguiente = new URLSearchParams(params);
    if (nueva === 'gestion') siguiente.set('vista', 'gestion');
    else siguiente.delete('vista');
    setParams(siguiente);
  };
  const pestanas = <Segmentado etiqueta="Parte del proyecto" opciones={PARTES} valor={parte} onCambio={elegir} enfocarAlMontar={conFoco} />;
  // Sin catálogo y sin error todavía no se sabe si el proyecto existe; con error, la pantalla de tareas lo muestra.
  if (catalogo.data === undefined && !catalogo.isError) return null;
  if (catalogo.data && !catalogo.data.proyectos.some((p) => p.id === proyectoId)) {
    return <NoEncontrado mensaje="No encontramos ese proyecto" seccion={{ ruta: '/proyectos', nombre: 'Proyectos' }} />;
  }
  if (parte === 'gestion') return <PantallaProyectoGestion proyectoId={proyectoId} pestanas={pestanas} />;
  return <PantallaTareas contexto={{ tipo: 'proyecto', id: proyectoId }} pestanas={pestanas} />;
}
