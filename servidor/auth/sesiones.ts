import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';

export const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000;
const FORMATO_ID = /^[0-9a-f]{64}$/;

export interface UsuarioSesion {
  id: number;
  login: string;
  nombre: string;
  tokenVencido: boolean;
}

// La base guarda solo el hash del id: una copia de la base no sirve para entrar.
function hashDeId(idCrudo: string): string {
  return createHash('sha256').update(idCrudo).digest('hex');
}

export function crearSesion(db: Database, usuarioId: number, ahora: Date): string {
  const idCrudo = randomBytes(32).toString('hex');
  const vence = new Date(ahora.getTime() + DURACION_SESION_MS).toISOString();
  db.prepare('delete from sesiones where vence <= ?').run(ahora.toISOString());
  db.prepare('insert into sesiones (id, usuario_id, vence) values (?, ?, ?)').run(hashDeId(idCrudo), usuarioId, vence);
  return idCrudo;
}

export function buscarSesion(db: Database, idCrudo: string | undefined, ahora: Date): UsuarioSesion | null {
  if (idCrudo === undefined || !FORMATO_ID.test(idCrudo)) return null;
  const id = hashDeId(idCrudo);
  const fila = db
    .prepare(
      `select u.id, u.login, u.nombre, u.token_vencido as tokenVencido, s.vence
       from sesiones s join usuarios u on u.id = s.usuario_id where s.id = ?`,
    )
    .get(id) as { id: number; login: string; nombre: string; tokenVencido: number; vence: string } | undefined;
  if (fila === undefined) return null;
  if (fila.vence <= ahora.toISOString()) {
    db.prepare('delete from sesiones where id = ?').run(id);
    return null;
  }
  return { id: fila.id, login: fila.login, nombre: fila.nombre, tokenVencido: fila.tokenVencido === 1 };
}

export function borrarSesion(db: Database, idCrudo: string): void {
  db.prepare('delete from sesiones where id = ?').run(hashDeId(idCrudo));
}

export function borrarSesionesDe(db: Database, usuarioId: number): void {
  db.prepare('delete from sesiones where usuario_id = ?').run(usuarioId);
}

/** Cierra todas las sesiones de la persona salvo la que está en uso. */
export function borrarOtrasSesiones(db: Database, usuarioId: number, idCrudoActual: string): void {
  db.prepare("delete from sesiones where usuario_id = ? and id <> ?").run(usuarioId, hashDeId(idCrudoActual));
}
