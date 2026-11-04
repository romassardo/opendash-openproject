import type { Database } from 'better-sqlite3';
import type { Feriado } from '../../compartido/tipos.js';
import type { FeriadoLista } from './fuente.js';

interface FilaLista { fecha: string; nombre: string; puente: number }
interface FilaAjuste { fecha: string; accion: 'agregar' | 'quitar'; nombre: string | null }

/** Cambia la lista de ese año por la nueva; los ajustes a mano no se tocan. */
export function reemplazarAnio(db: Database, anio: number, lista: FeriadoLista[]): void {
  const borrar = db.prepare('delete from feriados_lista where fecha between ? and ?');
  const insertar = db.prepare('insert or replace into feriados_lista (fecha, nombre, puente) values (?, ?, ?)');
  db.transaction(() => {
    borrar.run(`${anio}-01-01`, `${anio}-12-31`);
    for (const f of lista) insertar.run(f.fecha, f.nombre, f.puente ? 1 : 0);
  })();
}

/** (lista − quitados) ∪ agregados, por fecha; lo agregado a mano manda sobre la lista. */
export function feriadosEntre(db: Database, desde: string, hasta: string): Feriado[] {
  const lista = db.prepare('select fecha, nombre, puente from feriados_lista where fecha between ? and ?').all(desde, hasta) as FilaLista[];
  const ajustes = db.prepare('select fecha, accion, nombre from feriados_ajustes where fecha between ? and ?').all(desde, hasta) as FilaAjuste[];
  const porFecha = new Map<string, Feriado>();
  for (const f of lista) porFecha.set(f.fecha, { fecha: f.fecha, nombre: f.nombre, puente: f.puente === 1, manual: false });
  for (const a of ajustes) {
    if (a.accion === 'quitar') porFecha.delete(a.fecha);
    else porFecha.set(a.fecha, { fecha: a.fecha, nombre: a.nombre ?? '', puente: false, manual: true });
  }
  return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function fechasFeriado(db: Database, desde: string, hasta: string): Set<string> {
  return new Set(feriadosEntre(db, desde, hasta).map((f) => f.fecha));
}

const enLista = (db: Database, fecha: string): boolean => db.prepare('select 1 from feriados_lista where fecha = ?').get(fecha) !== undefined;
const ajusteDe = (db: Database, fecha: string): FilaAjuste | undefined =>
  db.prepare('select fecha, accion, nombre from feriados_ajustes where fecha = ?').get(fecha) as FilaAjuste | undefined;

const nombreEnLista = (db: Database, fecha: string): string | undefined =>
  db.prepare('select nombre from feriados_lista where fecha = ?').pluck().get(fecha) as string | undefined;

/** Si estaba quitado de la lista y el nombre es el de la lista, vuelve la entrada de la lista; si no, queda agregado a mano con el nombre escrito. */
export function agregarFeriado(db: Database, fecha: string, nombre: string): void {
  db.transaction(() => {
    if (ajusteDe(db, fecha)?.accion === 'quitar' && nombreEnLista(db, fecha)?.trim() === nombre.trim()) {
      db.prepare('delete from feriados_ajustes where fecha = ?').run(fecha);
      return;
    }
    db.prepare("insert or replace into feriados_ajustes (fecha, accion, nombre) values (?, 'agregar', ?)").run(fecha, nombre);
  })();
}

/** Lo agregado a mano se borra; lo de la lista queda marcado como quitado. `false` si ese día no era feriado. */
export function quitarFeriado(db: Database, fecha: string): boolean {
  return db.transaction(() => {
    const ajuste = ajusteDe(db, fecha);
    if (ajuste?.accion === 'quitar') return false;
    if (enLista(db, fecha)) {
      db.prepare("insert or replace into feriados_ajustes (fecha, accion, nombre) values (?, 'quitar', null)").run(fecha);
      return true;
    }
    if (ajuste === undefined) return false;
    db.prepare('delete from feriados_ajustes where fecha = ?').run(fecha);
    return true;
  })();
}
