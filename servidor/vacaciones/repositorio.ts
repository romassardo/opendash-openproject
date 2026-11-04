import type { Database } from 'better-sqlite3';
import type { Vacaciones } from '../../compartido/tipos.js';

/** Las vacaciones de una persona que terminan en `desde` o después, por inicio. */
export function vacacionesDe(db: Database, usuarioId: number, desde: string): Vacaciones[] {
  return db.prepare('select id, desde, hasta from vacaciones where usuario_id = ? and hasta >= ? order by desde, id')
    .all(usuarioId, desde) as Vacaciones[];
}

/** Lo mismo para todo el equipo, agrupado por persona. */
export function vacacionesDeTodos(db: Database, desde: string): Map<number, Vacaciones[]> {
  const filas = db.prepare('select id, usuario_id as usuarioId, desde, hasta from vacaciones where hasta >= ? order by desde, id')
    .all(desde) as (Vacaciones & { usuarioId: number })[];
  const porPersona = new Map<number, Vacaciones[]>();
  for (const { usuarioId, ...v } of filas) porPersona.set(usuarioId, [...(porPersona.get(usuarioId) ?? []), v]);
  return porPersona;
}

/** Si el período comparte al menos un día con otro de la misma persona. */
export function sePisan(db: Database, usuarioId: number, desde: string, hasta: string): boolean {
  return db.prepare('select 1 from vacaciones where usuario_id = ? and desde <= ? and hasta >= ?').get(usuarioId, hasta, desde) !== undefined;
}

export function crearVacaciones(db: Database, usuarioId: number, desde: string, hasta: string): void {
  db.prepare('insert into vacaciones (usuario_id, desde, hasta) values (?, ?, ?)').run(usuarioId, desde, hasta);
}

/** Borra solo si son de esa persona; devuelve si había algo que borrar. */
export function borrarVacaciones(db: Database, usuarioId: number, id: number): boolean {
  return db.prepare('delete from vacaciones where id = ? and usuario_id = ?').run(id, usuarioId).changes > 0;
}
