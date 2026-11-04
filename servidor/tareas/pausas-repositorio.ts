import type { Database } from 'better-sqlite3';
import type { Pausa, PausaNueva } from '../../compartido/pausas.js';

interface Fila { id: number; tarea_id: number; despues: number; dias: number }

const aPausa = (f: Fila): Pausa => ({ id: f.id, tareaId: f.tarea_id, despues: f.despues, dias: f.dias });

export function todasLasPausas(db: Database): Pausa[] {
  return (db.prepare('select id, tarea_id, despues, dias from pausas_tarea order by tarea_id, despues, id').all() as Fila[]).map(aPausa);
}

export function pausasDe(db: Database, tareaId: number): Pausa[] {
  return (db.prepare('select id, tarea_id, despues, dias from pausas_tarea where tarea_id = ? order by despues, id').all(tareaId) as Fila[]).map(aPausa);
}

export function pausa(db: Database, id: number): Pausa | null {
  const fila = db.prepare('select id, tarea_id, despues, dias from pausas_tarea where id = ?').get(id) as Fila | undefined;
  return fila === undefined ? null : aPausa(fila);
}

export function guardarPausa(db: Database, tareaId: number, nueva: PausaNueva, usuarioId: number, ahora: Date): Pausa {
  const { lastInsertRowid } = db.prepare('insert into pausas_tarea (tarea_id, despues, dias, creada_por, creada) values (?, ?, ?, ?, ?)')
    .run(tareaId, nueva.despues, nueva.dias, usuarioId, ahora.toISOString());
  return { id: Number(lastInsertRowid), tareaId, ...nueva };
}

export function borrarPausa(db: Database, id: number): void {
  db.prepare('delete from pausas_tarea where id = ?').run(id);
}

/** Al borrar tareas, sus pausas no tienen sentido. */
export function borrarPausasDe(db: Database, tareaIds: readonly number[]): void {
  const borrar = db.prepare('delete from pausas_tarea where tarea_id = ?');
  db.transaction(() => { for (const id of tareaIds) borrar.run(id); })();
}
