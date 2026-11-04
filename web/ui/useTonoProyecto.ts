import { useAjustes } from '../api/consultas.js';
import { tonoPara, type Tono } from './tonos.js';

/** Devuelve el tono de un proyecto según los ajustes (repartidos sin repetir); sin ajustes, el tono estable por id. */
export function useTonoProyecto(): (proyectoId: number) => Tono {
  const ajustes = useAjustes();
  const estilos = ajustes.data?.estilos;
  return (proyectoId) => estilos?.[proyectoId]?.color ?? tonoPara(proyectoId);
}
