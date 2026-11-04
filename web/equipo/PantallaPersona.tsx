import { useParams } from 'react-router';
import { useCatalogo } from '../api/consultas.js';
import { NoEncontrado } from '../marco/NoEncontrado.js';
import { idDeRuta } from '../tareas/baseTareas.js';
import { PantallaTareas } from '../tareas/PantallaTareas.js';

/** `/equipo/:id`: el tablero y la lista de tareas de una sola persona. */
export function PantallaPersona() {
  const { id = '' } = useParams();
  const personaId = idDeRuta(id);
  const catalogo = useCatalogo();
  // Sin catálogo y sin error todavía no se sabe si la persona existe; con error, la pantalla de tareas lo muestra.
  if (catalogo.data === undefined && !catalogo.isError) return null;
  if (catalogo.data && !catalogo.data.personas.some((p) => p.id === personaId)) {
    return <NoEncontrado mensaje="No encontramos esa persona" seccion={{ ruta: '/equipo', nombre: 'Equipo' }} />;
  }
  return <PantallaTareas contexto={{ tipo: 'persona', id: personaId }} />;
}
