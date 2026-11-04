import type { Database } from 'better-sqlite3';
import { repartirTonos, tonoPara, type EstiloProyecto } from '../../compartido/estilos.js';
import { JORNADA_HORAS_DEFECTO } from '../../compartido/horas.js';
import type { Ajustes, AjustesAvisos, AjustesHoras, AjustesMetricas, MapeoTablero } from '../../compartido/tipos.js';

const METRICAS_POR_DEFECTO: AjustesMetricas = { horasPorDefecto: 4, horasSemanaLargas: 4, capacidadPorDefecto: 40, restarReuniones: false };
const TABLERO_POR_DEFECTO: MapeoTablero = { nuevo: null, curso: null, pausa: null, cerrado: null };

function leerJson(db: Database, clave: string): unknown {
  const valor = db.prepare('select valor from ajustes where clave = ?').pluck().get(clave) as string | undefined;
  if (valor === undefined) return undefined;
  try {
    return JSON.parse(valor);
  } catch {
    return undefined;
  }
}

function guardarJson(db: Database, clave: string, valor: unknown): void {
  db.prepare('insert into ajustes (clave, valor) values (?, ?) on conflict(clave) do update set valor = excluded.valor')
    .run(clave, JSON.stringify(valor));
}

// Completa con el valor por defecto lo que falte o no sea un número/id, para que un JSON viejo no rompa la lectura.
const numeroOr = (v: unknown, defecto: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : defecto);
const idOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

export function leerMetricas(db: Database): AjustesMetricas {
  const m = (leerJson(db, 'metricas') ?? {}) as Partial<Record<keyof AjustesMetricas, unknown>>;
  return {
    horasPorDefecto: numeroOr(m.horasPorDefecto, METRICAS_POR_DEFECTO.horasPorDefecto),
    horasSemanaLargas: numeroOr(m.horasSemanaLargas, METRICAS_POR_DEFECTO.horasSemanaLargas),
    capacidadPorDefecto: numeroOr(m.capacidadPorDefecto, METRICAS_POR_DEFECTO.capacidadPorDefecto),
    restarReuniones: typeof m.restarReuniones === 'boolean' ? m.restarReuniones : METRICAS_POR_DEFECTO.restarReuniones,
  };
}

export function leerHoras(db: Database): AjustesHoras {
  const h = (leerJson(db, 'horas') ?? {}) as Partial<Record<keyof AjustesHoras, unknown>>;
  return { jornadaHoras: numeroOr(h.jornadaHoras, JORNADA_HORAS_DEFECTO) };
}

export function guardarHoras(db: Database, h: AjustesHoras): void {
  guardarJson(db, 'horas', h);
}

export function leerTablero(db: Database): MapeoTablero {
  const t = (leerJson(db, 'tablero') ?? TABLERO_POR_DEFECTO) as Partial<Record<keyof MapeoTablero, unknown>>;
  return { nuevo: idOrNull(t.nuevo), curso: idOrNull(t.curso), pausa: idOrNull(t.pausa), cerrado: idOrNull(t.cerrado) };
}

/** Los ajustes del equipo; los estilos son solo los de los proyectos visibles. A los que no tienen estilo se les reparte un color sin repetir sobre todo el catálogo. */
export function leerAjustes(db: Database, proyectosVisibles: number[], todosLosProyectos?: readonly number[]): Ajustes {
  const filas = db.prepare('select proyecto_id, color, icono from proyecto_estilo').all() as
    { proyecto_id: number; color: EstiloProyecto['color']; icono: EstiloProyecto['icono'] }[];
  const guardados = new Map(filas.map((f) => [f.proyecto_id, { color: f.color, icono: f.icono }]));
  const estilos: Record<number, EstiloProyecto> = {};
  const elegidos = new Map(filas.map((f) => [f.proyecto_id, f.color]));
  const reparto = repartirTonos(todosLosProyectos ?? proyectosVisibles, elegidos);
  for (const id of proyectosVisibles) estilos[id] = guardados.get(id) ?? { color: reparto.get(id) ?? tonoPara(id), icono: 'carpeta' };
  return { estilos, metricas: leerMetricas(db), horas: leerHoras(db), avisos: { receptores: leerReceptores(db) } };
}

/** Lo marcado a mano: id del proyecto → es plantilla (true) o se desmarca aunque OpenProject lo marque (false). */
export function leerPlantillas(db: Database): Record<number, boolean> {
  const crudo = leerJson(db, 'plantillas');
  const salida: Record<number, boolean> = {};
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return salida;
  for (const [id, marca] of Object.entries(crudo)) {
    if (/^\d+$/.test(id) && typeof marca === 'boolean') salida[Number(id)] = marca;
  }
  return salida;
}

export function guardarPlantilla(db: Database, proyectoId: number, plantilla: boolean): void {
  guardarJson(db, 'plantillas', { ...leerPlantillas(db), [proyectoId]: plantilla });
}

export function guardarEstilo(db: Database, proyectoId: number, estilo: EstiloProyecto): void {
  db.prepare('insert into proyecto_estilo (proyecto_id, color, icono) values (?, ?, ?) on conflict(proyecto_id) do update set color = excluded.color, icono = excluded.icono')
    .run(proyectoId, estilo.color, estilo.icono);
}

export function guardarMetricas(db: Database, m: AjustesMetricas): void {
  guardarJson(db, 'metricas', m);
}

export function guardarTablero(db: Database, mapeo: MapeoTablero): void {
  guardarJson(db, 'tablero', mapeo);
}

/** Las personas que reciben los avisos de problemas; lista vacía = todavía no se eligió a nadie. */
export function leerReceptores(db: Database): AjustesAvisos['receptores'] {
  const crudo = (leerJson(db, 'avisos') ?? {}) as { receptores?: unknown };
  return Array.isArray(crudo.receptores) ? crudo.receptores.filter((id): id is number => Number.isInteger(id)) : [];
}

export function guardarReceptores(db: Database, receptores: number[]): void {
  guardarJson(db, 'avisos', { receptores });
}
