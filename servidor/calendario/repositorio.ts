import type { Database } from 'better-sqlite3';
import type { EstadoCalendario, FallaCalendario, Reunion, VentanaFechas } from '../../compartido/tipos.js';
import { cifrar, descifrar } from '../seguridad/cifrado.js';

export interface CacheCalendario { reuniones: Reunion[]; ventana: VentanaFechas | null; estado: EstadoCalendario }

interface FilaCache { reuniones_cifradas: string | null; ventana: string | null; leido: string | null; falla: FallaCalendario | null }

const aad = (usuarioId: number): string => `calendario:${usuarioId}`;

/** Las reuniones (con títulos y enlaces) solo viven cifradas; sin lectura previa devuelve lista vacía. */
export function leerCache(db: Database, clave: Buffer, usuarioId: number, alFallar?: () => void): CacheCalendario | null {
  const fila = db.prepare('select reuniones_cifradas, ventana, leido, falla from calendario_cache where usuario_id = ?').get(usuarioId) as FilaCache | undefined;
  if (fila === undefined) return null;
  const estado = { leido: fila.leido, falla: fila.falla };
  try {
    const reuniones = fila.reuniones_cifradas === null ? [] : (JSON.parse(descifrar(fila.reuniones_cifradas, clave, aad(usuarioId))) as Reunion[]);
    const ventana = fila.ventana === null ? null : (JSON.parse(fila.ventana) as VentanaFechas);
    return { reuniones, ventana, estado };
  } catch {
    // Datos que no se descifran o no se leen: se tratan como sin reuniones, la próxima lectura buena los pisa.
    alFallar?.();
    return { reuniones: [], ventana: null, estado };
  }
}

export function guardarLectura(db: Database, clave: Buffer, usuarioId: number, reuniones: Reunion[], ventana: VentanaFechas, ahora: Date): void {
  const momento = ahora.toISOString();
  db.prepare(
    `insert into calendario_cache (usuario_id, reuniones_cifradas, ventana, leido, intento, falla) values (?, ?, ?, ?, ?, null)
     on conflict(usuario_id) do update set reuniones_cifradas = excluded.reuniones_cifradas, ventana = excluded.ventana,
       leido = excluded.leido, intento = excluded.intento, falla = null`,
  ).run(usuarioId, cifrar(JSON.stringify(reuniones), clave, aad(usuarioId)), JSON.stringify(ventana), momento, momento);
}

/** Anota la falla y conserva las reuniones y el momento de la última lectura buena. */
export function guardarFalla(db: Database, usuarioId: number, falla: FallaCalendario, ahora: Date): void {
  db.prepare(
    `insert into calendario_cache (usuario_id, intento, falla) values (?, ?, ?)
     on conflict(usuario_id) do update set intento = excluded.intento, falla = excluded.falla`,
  ).run(usuarioId, ahora.toISOString(), falla);
}

export function borrarCache(db: Database, usuarioId: number): void {
  db.prepare('delete from calendario_cache where usuario_id = ?').run(usuarioId);
}

/** `null` si la persona no tiene un enlace guardado. */
export function estadoCalendario(db: Database, usuarioId: number): EstadoCalendario | null {
  const usuario = db.prepare('select ics_cifrado from usuarios where id = ?').get(usuarioId) as { ics_cifrado: string | null } | undefined;
  if (usuario?.ics_cifrado == null) return null;
  const fila = db.prepare('select leido, falla from calendario_cache where usuario_id = ?').get(usuarioId) as EstadoCalendario | undefined;
  return fila ?? { leido: null, falla: null };
}
