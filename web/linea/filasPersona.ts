import type { Tarea } from '../../compartido/tipos.js';
import { tonoPara } from '../ui/tonos.js';
import {
  filaTerminadas, filasDeContenedor, nombreProyecto, raicesDe, resumenDe,
  type Alcance, type Contexto, type Fila, type Franja,
} from './filasNucleo.js';

// Por persona: franja de la persona, un renglón por proyecto y debajo el árbol recortado a lo suyo.

/** Quien mira primero, después por nombre (es-AR) y «Sin asignar» al final. */
export function ordenarFranjasDePersona(franjas: Franja[], yoId: number | null): Franja[] {
  const rango = (f: Franja): number => (f.clave === 'sin-asignar' ? 2 : f.personaId !== null && f.personaId === yoId ? 0 : 1);
  return [...franjas].sort((a, b) => rango(a) - rango(b) || a.titulo.localeCompare(b.titulo, 'es-AR'));
}

function alcanceDe(f: Franja, c: Contexto): Alcance {
  return {
    franja: f.clave, prefijo: `${f.clave}:`, conContenedor: false, personaId: f.personaId, porPersona: true,
    propia: (t: Tarea) => t.responsableId === f.personaId,
    verTerminadas: c.o.terminadasVisibles.has(f.clave),
  };
}

export function filasDeFranjaPersona(f: Franja, c: Contexto): Fila[] {
  const alcance = alcanceDe(f, c);
  const memo = new Map<number, boolean>();
  // Con las terminadas a la vista, también los proyectos donde solo hay terminadas fuera de la ventana.
  const conFilas = alcance.verTerminadas ? [...f.dibujadas, ...f.terminadas] : f.dibujadas;
  const proyectos = [...new Set(conFilas.map((t) => t.proyectoId))]
    .map((id) => ({ id, nombre: nombreProyecto(id, c) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR'));
  const cuerpo = proyectos.flatMap(({ id, nombre }): Fila[] => {
    const arbol = filasDeContenedor(raicesDe(id, c), id, null, 0, c, alcance, memo);
    if (arbol.length === 0) return [];
    const renglon: Fila = { tipo: 'proyecto', clave: `${f.clave}:p${id}`, proyectoId: id, titulo: nombre, tono: c.estilos[id]?.color ?? tonoPara(id) };
    return [renglon, ...arbol];
  });
  const encabezado: Fila = {
    tipo: 'encabezado', clave: f.clave, titulo: f.titulo, tono: f.tono, personaId: f.personaId, proyectoId: null,
    esYo: f.personaId !== null && f.personaId === c.o.yoId, resumen: resumenDe(f.abiertas, f.sinFechas),
  };
  return [encabezado, ...cuerpo, ...filaTerminadas(f, c)];
}
