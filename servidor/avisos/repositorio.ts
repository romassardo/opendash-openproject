import type { Database } from 'better-sqlite3';
import type { AvisoProblema, ContextoAviso, EstadoAviso } from '../../compartido/tipos.js';

interface FilaAviso {
  id: number; usuario_id: number; creado: string; texto: string; contexto: string;
  tiene_imagen: number; estado: EstadoAviso; marcado_por: number | null; marcado_el: string | null;
}

const COLUMNAS = 'id, usuario_id, creado, texto, contexto, imagen is not null as tiene_imagen, estado, marcado_por, marcado_el';

function contextoDe(crudo: string): ContextoAviso {
  try {
    return JSON.parse(crudo) as ContextoAviso;
  } catch {
    return { ruta: '', titulo: '', navegador: '', ventana: '', tema: 'oscuro', version: '', error: null };
  }
}

const aAviso = (f: FilaAviso): AvisoProblema => ({
  id: f.id, usuarioId: f.usuario_id, creado: f.creado, texto: f.texto, contexto: contextoDe(f.contexto),
  tieneImagen: f.tiene_imagen === 1, estado: f.estado, marcadoPor: f.marcado_por, marcadoEl: f.marcado_el,
});

export interface NuevoAviso { usuarioId: number; creado: string; texto: string; contexto: ContextoAviso; imagen: { tipo: string; bytes: Buffer } | null }

export function crearAviso(db: Database, a: NuevoAviso): number {
  const r = db
    .prepare('insert into avisos_problema (usuario_id, creado, texto, contexto, imagen, imagen_tipo) values (?, ?, ?, ?, ?, ?)')
    .run(a.usuarioId, a.creado, a.texto, JSON.stringify(a.contexto), a.imagen?.bytes ?? null, a.imagen?.tipo ?? null);
  return Number(r.lastInsertRowid);
}

/** Cuántos avisos mandó esta persona desde `desde` (ISO). */
export function contarDesde(db: Database, usuarioId: number, desde: string): number {
  return db.prepare('select count(*) from avisos_problema where usuario_id = ? and creado >= ?').pluck().get(usuarioId, desde) as number;
}

export function avisosDe(db: Database, usuarioId: number): AvisoProblema[] {
  const filas = db.prepare(`select ${COLUMNAS} from avisos_problema where usuario_id = ? order by creado desc, id desc`).all(usuarioId) as FilaAviso[];
  return filas.map(aAviso);
}

export function todosLosAvisos(db: Database): AvisoProblema[] {
  const filas = db.prepare(`select ${COLUMNAS} from avisos_problema order by creado desc, id desc`).all() as FilaAviso[];
  return filas.map(aAviso);
}

export function imagenDe(db: Database, id: number): { usuarioId: number; tipo: string; bytes: Buffer } | null {
  const f = db.prepare('select usuario_id, imagen_tipo, imagen from avisos_problema where id = ? and imagen is not null').get(id) as
    { usuario_id: number; imagen_tipo: string; imagen: Buffer } | undefined;
  return f === undefined ? null : { usuarioId: f.usuario_id, tipo: f.imagen_tipo, bytes: f.imagen };
}

/** Devuelve `false` si no existe ese aviso. */
export function marcarAviso(db: Database, id: number, estado: EstadoAviso, por: number, cuando: string): boolean {
  return db.prepare('update avisos_problema set estado = ?, marcado_por = ?, marcado_el = ? where id = ?').run(estado, por, cuando, id).changes > 0;
}
