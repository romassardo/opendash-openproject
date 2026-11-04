import type { Catalogo, Persona, Proyecto, Tarea } from '../../compartido/tipos.js';
import { normalizar } from '../tareas/logica.js';

export const MAX_POR_GRUPO = 8;

export interface Resultados {
  tareas: Tarea[];
  proyectos: Proyecto[];
  personas: Persona[];
}

/** Cada palabra de la consulta tiene que aparecer en el texto (sin tildes ni mayúsculas). */
function coincide(texto: string, palabras: string[]): boolean {
  const pajar = normalizar(texto);
  return palabras.every((palabra) => pajar.includes(palabra));
}

/**
 * Busca en tareas (por título, sin hitos), proyectos activos y personas.
 * Sin texto devuelve solo las tareas tocadas más recientemente.
 */
export function buscar(consulta: string, tareas: Tarea[], catalogo: Catalogo): Resultados {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  const hitos = new Set(catalogo.tipos.filter((t) => t.esHito).map((t) => t.id));
  const reales = tareas.filter((t) => !hitos.has(t.tipoId));
  const recientes = (lista: Tarea[]) => [...lista].sort((a, b) => b.actualizada.localeCompare(a.actualizada));

  if (palabras.length === 0) return { tareas: recientes(reales).slice(0, MAX_POR_GRUPO), proyectos: [], personas: [] };

  return {
    tareas: recientes(reales.filter((t) => coincide(t.titulo, palabras))).slice(0, MAX_POR_GRUPO),
    proyectos: catalogo.proyectos
      .filter((p) => p.activo && coincide(`${p.nombre} ${p.identificador}`, palabras))
      .slice(0, MAX_POR_GRUPO),
    personas: catalogo.personas.filter((p) => coincide(`${p.nombre} ${p.login ?? ''}`, palabras)).slice(0, MAX_POR_GRUPO),
  };
}

export const rutaDeTarea = (id: number): string => `/tareas/${id}`;

export const rutaDeProyecto = (id: number): string => `/proyectos/${id}`;

export const rutaDePersona = (id: number): string => `/equipo/${id}`;
