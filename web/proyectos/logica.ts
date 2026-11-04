import type { Catalogo, Proyecto, Tarea } from '../../compartido/tipos.js';
import { mesDe } from '../fechas.js';
import { columnaDeTarea, esHitoDe, vencida } from '../tareas/logica.js';

// Lógica pura de la pantalla Proyectos. `hoy` es 'YYYY-MM-DD' en hora argentina.

export interface ResumenProyecto {
  proyecto: Proyecto;
  estado: 'activo' | 'terminado';
  hechas: number;
  total: number;
  porcentaje: number;
  proximoHito: { titulo: string; fecha: string; esVersion: boolean } | null;
  personas: number[];
  fin: string | null;
  vencidas: number;
}

const porcentajeDe = (parte: number, total: number): number => (total ? Math.round((parte / total) * 100) : 0);

export function resumirProyecto(proyecto: Proyecto, tareas: Tarea[], catalogo: Catalogo, hoy: string): ResumenProyecto {
  const esHito = esHitoDe(catalogo);
  const delProyecto = tareas.filter((t) => t.proyectoId === proyecto.id);
  const sinHitos = delProyecto.filter((t) => !esHito(t));
  const abierta = (t: Tarea): boolean => columnaDeTarea(t, catalogo) !== 'cerrado';

  const madres = new Set(sinHitos.flatMap((t) => (t.madreId === null ? [] : [t.madreId])));
  const hojas = sinHitos.filter((t) => !madres.has(t.id));
  const hechas = hojas.filter((t) => !abierta(t)).length;
  const abiertas = sinHitos.filter(abierta);

  return {
    proyecto,
    estado: sinHitos.length > 0 && abiertas.length === 0 ? 'terminado' : 'activo',
    hechas,
    total: hojas.length,
    porcentaje: porcentajeDe(hechas, hojas.length),
    proximoHito: proximoHito(proyecto, delProyecto.filter((t) => esHito(t) && abierta(t)), catalogo, hoy),
    personas: [...new Set((abiertas.length > 0 ? abiertas : sinHitos).flatMap((t) => (t.responsableId === null ? [] : [t.responsableId])))],
    fin: delProyecto.reduce<string | null>((max, t) => (t.fin !== null && (max === null || t.fin > max) ? t.fin : max), null),
    vencidas: abiertas.filter((t) => vencida(t, hoy, catalogo)).length,
  };
}

/** El hito abierto más temprano (aunque esté vencido) o, si no hay, la versión que cierra más pronto. */
function proximoHito(proyecto: Proyecto, hitosAbiertos: Tarea[], catalogo: Catalogo, hoy: string): ResumenProyecto['proximoHito'] {
  const conFecha = hitosAbiertos
    .flatMap((t) => { const fecha = t.fin ?? t.inicio; return fecha === null ? [] : [{ titulo: t.titulo, fecha, id: t.id }]; })
    .sort((a, b) => (a.fecha === b.fecha ? a.id - b.id : a.fecha < b.fecha ? -1 : 1));
  const hito = conFecha[0];
  if (hito) return { titulo: hito.titulo, fecha: hito.fecha, esVersion: false };

  const version = catalogo.versiones
    .flatMap((v) => (v.proyectoId === proyecto.id && v.fin !== null && v.fin >= hoy ? [{ titulo: v.nombre, fecha: v.fin }] : []))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))[0];
  return version ? { ...version, esVersion: true } : null;
}

export function contadoresProyectos(
  resumenes: ResumenProyecto[], hoy: string,
): { activos: number; terminados: number; enFecha: number | null; vencenEsteMes: number } {
  const activos = resumenes.filter((r) => r.estado === 'activo');
  const sinVencidas = activos.filter((r) => r.vencidas === 0).length;
  return {
    activos: activos.length,
    terminados: resumenes.length - activos.length,
    enFecha: activos.length > 0 ? porcentajeDe(sinVencidas, activos.length) : null,
    vencenEsteMes: activos.filter((r) => r.fin !== null && mesDe(r.fin) === mesDe(hoy)).length,
  };
}
