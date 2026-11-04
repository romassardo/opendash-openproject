import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { migrar } from './migraciones.js';

export function abrirDb(ruta: string): Database.Database {
  if (ruta !== ':memory:') {
    mkdirSync(dirname(ruta), { recursive: true });
  }
  const db = new Database(ruta);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrar(db);
  return db;
}
