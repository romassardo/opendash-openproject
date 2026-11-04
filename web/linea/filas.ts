import type { EstiloProyecto } from '../../compartido/estilos.js';
import type { Catalogo, Dependencia, Tarea } from '../../compartido/tipos.js';
import { avancesPorMadre, esHitoDe } from '../tareas/logica.js';
import { tonoPara } from '../ui/tonos.js';
import { conflictos } from './cadena.js';
import { filasDeFranjaPersona, ordenarFranjasDePersona } from './filasPersona.js';
import {
  barraDe, esCerrada, esDibujable, esTerminadaConFechas, filaTerminadas, filasDeContenedor, madresEfectivas, nombrePersona, nombreProyecto, pasaFiltros,
  raicesDe, resumenDe, type Alcance, type Contexto, type Fila, type Franja, type OpcionesFilas,
} from './filasNucleo.js';
import { porInicio, tieneFechas, type Ventana } from './modelo.js';

export type { BarraFila, Fila, OpcionesFilas } from './filasNucleo.js';

// Filas de la línea de tiempo: franjas, renglones de proyecto, grupos (madres con hijas), tareas y terminadas. Todo puro.

const porTitulo = (a: Franja, b: Franja): number => a.titulo.localeCompare(b.titulo, 'es-AR');

function rotuloDe(t: Tarea, c: Contexto): Pick<Franja, 'clave' | 'titulo' | 'tono' | 'personaId' | 'proyectoId'> {
  if (c.o.vista === 'todas') return { clave: 'todas', titulo: 'Todas las tareas', tono: null, personaId: null, proyectoId: null };
  if (c.o.vista === 'persona') {
    if (t.responsableId === null) return { clave: 'sin-asignar', titulo: 'Sin asignar', tono: null, personaId: null, proyectoId: null };
    return { clave: `persona-${t.responsableId}`, titulo: nombrePersona(t.responsableId, c), tono: tonoPara(t.responsableId), personaId: t.responsableId, proyectoId: null };
  }
  return { clave: `proyecto-${t.proyectoId}`, titulo: nombreProyecto(t.proyectoId, c), tono: c.estilos[t.proyectoId]?.color ?? tonoPara(t.proyectoId), personaId: null, proyectoId: t.proyectoId };
}

/** Las franjas de la vista con sus tareas que se ven (con fechas dentro de la ventana) y cuántas hay sin fechas. */
function franjasDe(c: Contexto): Franja[] {
  const franjas = new Map<string, Franja>();
  for (const t of c.tareas) {
    if (!esDibujable(t, c)) continue;
    const rotulo = rotuloDe(t, c);
    const f = franjas.get(rotulo.clave) ?? { ...rotulo, dibujadas: [], abiertas: 0, sinFechas: 0, terminadas: [] };
    franjas.set(rotulo.clave, { ...f, dibujadas: [...f.dibujadas, t] });
  }
  for (const t of c.tareas) {
    const f = franjas.get(rotuloDe(t, c).clave);
    if (!f || !pasaFiltros(t, c)) continue;
    if (!tieneFechas(t)) franjas.set(f.clave, { ...f, sinFechas: f.sinFechas + 1 });
    // Las cerradas de fuera de la ventana también cuentan: con «mostrar» aparecen todas.
    else if (esTerminadaConFechas(t, c)) franjas.set(f.clave, { ...f, terminadas: [...f.terminadas, t] });
  }
  return [...franjas.values()].map((f) => ({ ...f, abiertas: f.dibujadas.filter((t) => !esCerrada(t, c)).length }));
}

function encabezadoDe(f: Franja): Fila {
  return {
    tipo: 'encabezado', clave: f.clave, titulo: f.titulo, tono: f.tono, personaId: f.personaId, proyectoId: f.proyectoId,
    esYo: false, resumen: resumenDe(f.abiertas, f.sinFechas),
  };
}

function filasPorProyecto(c: Contexto): Fila[] {
  const franjas = franjasDe(c).sort(porTitulo);
  return franjas.flatMap((f) => {
    if (f.proyectoId === null) return [];
    const alcance: Alcance = {
      franja: f.clave, prefijo: '', conContenedor: true, personaId: null, porPersona: false,
      propia: () => true, verTerminadas: c.o.terminadasVisibles.has(f.clave),
    };
    const cuerpo = filasDeContenedor(raicesDe(f.proyectoId, c), f.proyectoId, null, 0, c, alcance, new Map());
    const cierre = filaTerminadas(f, c);
    return cuerpo.length === 0 && cierre.length === 0 ? [] : [encabezadoDe(f), ...cuerpo, ...cierre];
  });
}

function filasTodas(c: Contexto): Fila[] {
  return franjasDe(c).flatMap((f) => {
    const ver = c.o.terminadasVisibles.has(f.clave);
    const abiertas = f.dibujadas.filter((t) => !esCerrada(t, c));
    const cuerpo = (ver ? [...abiertas, ...f.terminadas] : abiertas).sort(porInicio).map((t, indice): Fila => (
      { tipo: 'tarea', clave: `t${t.id}`, tarea: t, nivel: 0, barra: barraDe(t, c), contenedor: null, indice }
    ));
    return [encabezadoDe(f), ...cuerpo, ...filaTerminadas(f, c)];
  });
}

function filasPorPersona(c: Contexto): Fila[] {
  return ordenarFranjasDePersona(franjasDe(c), c.o.yoId).flatMap((f) => filasDeFranjaPersona(f, c));
}

/** Arma las filas de la línea de tiempo: franjas, proyectos, grupos, tareas con su barra, nivel y contenedor, y terminadas. */
export function armarFilas(
  tareas: Tarea[], dependencias: Dependencia[], catalogo: Catalogo, v: Ventana, o: OpcionesFilas, estilos: Record<number, EstiloProyecto> = {},
): Fila[] {
  const madreDe = madresEfectivas(tareas);
  const hijasDe = new Map<number, Tarea[]>();
  for (const t of tareas) {
    const madre = madreDe.get(t.id) ?? null;
    if (madre !== null) hijasDe.set(madre, [...(hijasDe.get(madre) ?? []), t]);
  }
  const enDependencia = conflictos(tareas, dependencias, catalogo);
  const c: Contexto = {
    tareas, dependencias, catalogo, v, o, estilos, hijasDe, madreDe,
    conDependencias: new Set(dependencias.flatMap((d) => [d.sucesoraId, d.predecesoraId])),
    enConflicto: new Set(dependencias.filter((d) => enDependencia.has(d.id)).map((d) => d.sucesoraId)),
    avances: avancesPorMadre(tareas, catalogo),
    esHito: esHitoDe(catalogo),
  };
  if (o.vista === 'proyecto') return filasPorProyecto(c);
  return o.vista === 'persona' ? filasPorPersona(c) : filasTodas(c);
}
