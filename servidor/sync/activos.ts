import type { Database } from 'better-sqlite3';

export const VENTANA_ACTIVIDAD_MS = 15 * 60_000;

// Usuarios con actividad en los últimos 15 minutos y token vigente, el más reciente primero.
export function usuariosActivos(db: Database, ahora: Date): number[] {
  const desde = new Date(ahora.getTime() - VENTANA_ACTIVIDAD_MS).toISOString();
  return db
    .prepare('select id from usuarios where token_vencido = 0 and ultima_actividad >= ? order by ultima_actividad desc')
    .pluck()
    .all(desde) as number[];
}
