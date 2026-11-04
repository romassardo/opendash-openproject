import type { Database } from 'better-sqlite3';
import { proyectoDeContenedor, type OrdenLinea } from '../../compartido/linea.js';

interface Fila { contenedor: string; tarea_id: number }

/** Solo los contenedores de los proyectos pedidos; las claves mal formadas se ignoran. */
export function leerOrden(db: Database, proyectos: readonly number[]): OrdenLinea {
  const visibles = new Set(proyectos);
  const filas = db.prepare('select contenedor, tarea_id from orden_linea order by contenedor, posicion').all() as Fila[];
  const orden: OrdenLinea = {};
  for (const { contenedor, tarea_id } of filas) {
    const proyecto = proyectoDeContenedor(contenedor);
    if (proyecto === null || !visibles.has(proyecto)) continue;
    (orden[contenedor] ??= []).push(tarea_id);
  }
  return orden;
}

/** Reemplaza el orden del contenedor en una sola transacción. */
export function guardarOrden(db: Database, contenedor: string, ids: readonly number[]): void {
  const borrar = db.prepare('delete from orden_linea where contenedor = ?');
  const poner = db.prepare('insert into orden_linea (contenedor, tarea_id, posicion) values (?, ?, ?)');
  db.transaction(() => {
    borrar.run(contenedor);
    ids.forEach((id, posicion) => poner.run(contenedor, id, posicion));
  })();
}
