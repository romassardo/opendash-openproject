import type { Database } from 'better-sqlite3';

export const VENTANA_INTENTOS_MS = 15 * 60 * 1000;
/** Fallos por login desde una misma IP. */
export const MAX_FALLOS = 5;
/** Fallos desde una misma IP, sea cual sea el login. */
export const MAX_FALLOS_IP = 20;

const clave = (login: string): string => login.trim().toLowerCase();

function desde(ahora: Date): string {
  return new Date(ahora.getTime() - VENTANA_INTENTOS_MS).toISOString();
}

export function estaBloqueado(db: Database, login: string, ip: string, ahora: Date): boolean {
  const limite = desde(ahora);
  db.prepare('delete from intentos_ingreso where momento <= ?').run(limite);
  const porLogin = db
    .prepare('select count(*) as n from intentos_ingreso where login = ? and ip = ? and momento > ?')
    .get(clave(login), ip, limite) as { n: number };
  if (porLogin.n >= MAX_FALLOS) return true;
  const porIp = db.prepare('select count(*) as n from intentos_ingreso where ip = ? and momento > ?').get(ip, limite) as { n: number };
  return porIp.n >= MAX_FALLOS_IP;
}

// Se anota el intento antes de verificar la clave: así los pedidos en paralelo se cuentan entre sí.
export function registrarIntento(db: Database, login: string, ip: string, ahora: Date): number {
  const r = db.prepare('insert into intentos_ingreso (login, ip, momento) values (?, ?, ?)').run(clave(login), ip, ahora.toISOString());
  return Number(r.lastInsertRowid);
}

export function descartarIntento(db: Database, rowid: number): void {
  db.prepare('delete from intentos_ingreso where rowid = ?').run(rowid);
}
