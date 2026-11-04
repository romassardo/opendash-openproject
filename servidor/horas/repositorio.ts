import type { Database } from 'better-sqlite3';
import { msDeReloj, type Contado } from '../../compartido/horas.js';
import type { EstadoCarga, HorasPorDia, Pedazo, Tramo } from '../../compartido/tipos.js';

interface FilaTramo {
  id: number; usuario_id: number; tarea_id: number; dia: string; inicio: string; fin: string | null; segundos: number | null;
  frenado_solo: 'tope' | 'medianoche' | null; aviso_visto: number; estado: EstadoCarga; entrada_op_id: number | null;
  motivo: string | null; corriendo: number;
}

const SELECT = `select t.id, t.usuario_id, t.tarea_id, t.dia, t.inicio, t.fin, t.segundos, t.frenado_solo, t.aviso_visto,
  t.estado, t.entrada_op_id, t.motivo,
  exists(select 1 from pedazos_trabajo p where p.tramo_id = t.id and p.hasta is null) as corriendo
  from tramos_trabajo t`;

const aTramo = (f: FilaTramo): Tramo => ({
  id: f.id, usuarioId: f.usuario_id, tareaId: f.tarea_id, dia: f.dia, inicio: f.inicio, fin: f.fin,
  pausado: f.fin === null && f.corriendo === 0, segundos: f.segundos, frenadoSolo: f.frenado_solo,
  avisoVisto: f.aviso_visto === 1, estado: f.estado, entradaOpId: f.entrada_op_id, motivo: f.motivo,
});

const lista = (db: Database, donde: string, ...params: (string | number)[]): Tramo[] =>
  (db.prepare(`${SELECT} ${donde}`).all(...params) as FilaTramo[]).map(aTramo);

export function tramo(db: Database, id: number): Tramo | null {
  return lista(db, 'where t.id = ?', id)[0] ?? null;
}

export const abiertosDe = (db: Database, usuarioId: number): Tramo[] =>
  lista(db, 'where t.usuario_id = ? and t.fin is null order by t.id', usuarioId);

/** Tareas en marcha y no pausadas, por usuario. */
export function enMarchaPorUsuario(db: Database): Map<number, number[]> {
  const mapa = new Map<number, number[]>();
  for (const t of abiertosDeTodos(db)) {
    if (t.pausado) continue;
    mapa.set(t.usuarioId, [...(mapa.get(t.usuarioId) ?? []), t.tareaId]);
  }
  return mapa;
}

export const abiertosDeTodos = (db: Database): Tramo[] => lista(db, 'where t.fin is null order by t.id');

/** Cerrados y no descartados de un día. */
export const cerradosDelDia = (db: Database, usuarioId: number, dia: string): Tramo[] =>
  lista(db, "where t.usuario_id = ? and t.dia = ? and t.fin is not null and t.estado <> 'descartado' order by t.inicio", usuarioId, dia);

/** Frenados solos sin ver, pendientes de cargar y rechazados. */
export const avisosDe = (db: Database, usuarioId: number): Tramo[] =>
  lista(db, `where t.usuario_id = ? and t.fin is not null and t.estado <> 'descartado'
    and ((t.frenado_solo is not null and t.aviso_visto = 0) or t.estado in ('pendiente', 'rechazado')) order by t.inicio`, usuarioId);

/** Los pedazos del día de una persona, sin los de tramos descartados. */
export function pedazosDelDia(db: Database, usuarioId: number, dia: string): Pedazo[] {
  const filas = db.prepare(`select p.tramo_id as tramoId, p.desde, p.hasta from pedazos_trabajo p
    join tramos_trabajo t on t.id = p.tramo_id
    where t.usuario_id = ? and t.dia = ? and t.estado <> 'descartado' order by p.desde`).all(usuarioId, dia) as Pedazo[];
  return filas;
}

/** Los tramos cerrados del día (sin descartados) con lo contado y lo medido. */
export function contadosDelDia(db: Database, usuarioId: number, dia: string): Contado[] {
  return db.prepare(`select id as tramoId, fin, coalesce(segundos, 0) as segundos, medidos from tramos_trabajo
    where usuario_id = ? and dia = ? and fin is not null and estado <> 'descartado'`).all(usuarioId, dia) as Contado[];
}

export function crearTramo(db: Database, usuarioId: number, tareaId: number, dia: string, ahora: Date): Tramo {
  const instante = ahora.toISOString();
  const id = Number(db.prepare('insert into tramos_trabajo (usuario_id, tarea_id, dia, inicio, creado) values (?, ?, ?, ?, ?)')
    .run(usuarioId, tareaId, dia, instante, instante).lastInsertRowid);
  db.prepare('insert into pedazos_trabajo (tramo_id, desde) values (?, ?)').run(id, instante);
  return tramo(db, id) as Tramo;
}

export function pausarTramo(db: Database, id: number, ahora: Date): void {
  db.prepare('update pedazos_trabajo set hasta = ? where tramo_id = ? and hasta is null').run(ahora.toISOString(), id);
}

export function seguirTramo(db: Database, id: number, ahora: Date): void {
  db.prepare('insert into pedazos_trabajo (tramo_id, desde) values (?, ?)').run(id, ahora.toISOString());
}

/** Cierra el tramo en `fin`: recorta los pedazos que se pasan y fija lo contado. */
export function cerrarTramoEn(db: Database, id: number, fin: Date, segundos: number, frenadoSolo: 'tope' | 'medianoche' | null): void {
  const instante = fin.toISOString();
  db.prepare('delete from pedazos_trabajo where tramo_id = ? and desde >= ?').run(id, instante);
  db.prepare('update pedazos_trabajo set hasta = ? where tramo_id = ? and (hasta is null or hasta > ?)').run(instante, id, instante);
  db.prepare("update tramos_trabajo set fin = ?, segundos = ?, medidos = ?, frenado_solo = ?, estado = 'pendiente' where id = ?")
    .run(instante, segundos, segundos, frenadoSolo, id);
}

export function corregirSegundos(db: Database, id: number, segundos: number): void {
  db.prepare("update tramos_trabajo set segundos = ?, estado = 'pendiente', motivo = null, aviso_visto = 1 where id = ?").run(segundos, id);
}

export function pasarATarea(db: Database, id: number, tareaId: number): void {
  db.prepare("update tramos_trabajo set tarea_id = ?, estado = 'pendiente', motivo = null where id = ?").run(tareaId, id);
}

export function marcarEstado(db: Database, id: number, estado: EstadoCarga): void {
  db.prepare('update tramos_trabajo set estado = ?, motivo = null where id = ?').run(estado, id);
}

export function marcarAvisoVisto(db: Database, id: number): void {
  db.prepare('update tramos_trabajo set aviso_visto = 1 where id = ?').run(id);
}

/** Las horas de reloj por persona y día (tramos cerrados, sin descartados) desde `desde`. */
export function horasPorDia(db: Database, usuarioIds: readonly number[], desde: string, ahora: Date): HorasPorDia[] {
  const donde = `where t.dia >= ? and t.fin is not null and t.estado <> 'descartado'`;
  const tramos = (db.prepare(`select t.id as tramoId, t.usuario_id as usuarioId, t.dia, t.fin, coalesce(t.segundos, 0) as segundos, t.medidos
    from tramos_trabajo t ${donde} order by t.dia, t.usuario_id`).all(desde) as (Contado & { usuarioId: number; dia: string })[])
    .filter((t) => usuarioIds.includes(t.usuarioId));
  const pedazos = db.prepare(`select p.tramo_id as tramoId, p.desde, p.hasta from pedazos_trabajo p
    join tramos_trabajo t on t.id = p.tramo_id ${donde}`).all(desde) as Pedazo[];
  const grupos = new Map<string, { usuarioId: number; dia: string; cerrados: Contado[] }>();
  for (const { usuarioId, dia, ...cerrado } of tramos) {
    const clave = `${dia}|${usuarioId}`;
    const grupo = grupos.get(clave) ?? { usuarioId, dia, cerrados: [] };
    grupo.cerrados.push(cerrado);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()].map(({ usuarioId, dia, cerrados }) => {
    const ids = new Set(cerrados.map((c) => c.tramoId));
    const propios = pedazos.filter((p) => ids.has(p.tramoId));
    return { usuarioId, dia, segundos: Math.round(msDeReloj(propios, cerrados, ahora) / 1000) };
  });
}

/** La persona confirmó seguir después del tope ese día. */
export function conHorasExtra(db: Database, usuarioId: number, dia: string): boolean {
  return db.prepare('select 1 from horas_extra where usuario_id = ? and dia = ?').get(usuarioId, dia) !== undefined;
}

export function marcarHorasExtra(db: Database, usuarioId: number, dia: string, ahora: Date): void {
  db.prepare('insert or ignore into horas_extra (usuario_id, dia, confirmado) values (?, ?, ?)').run(usuarioId, dia, ahora.toISOString());
}

/**
 * El último día antes de `hoy` (y no antes de `desde`) con tramos que contaron, con sus tareas en el orden en que se
 * arrancaron; `null` si no hay ninguno.
 */
export function ultimoDiaTrabajado(db: Database, usuarioId: number, hoy: string, desde: string): { dia: string; tareaIds: number[] } | null {
  const donde = "usuario_id = ? and fin is not null and estado <> 'descartado'";
  const dia = db.prepare(`select max(dia) from tramos_trabajo where ${donde} and dia < ? and dia >= ?`).pluck().get(usuarioId, hoy, desde) as string | null;
  if (dia === null) return null;
  const tareaIds = db.prepare(`select tarea_id from tramos_trabajo where ${donde} and dia = ? group by tarea_id order by min(inicio)`)
    .pluck().all(usuarioId, dia) as number[];
  return { dia, tareaIds };
}

export function variasALaVez(db: Database, usuarioId: number): boolean {
  return db.prepare('select varias_a_la_vez from usuarios where id = ?').pluck().get(usuarioId) === 1;
}

/**
 * Guarda el resultado de un intento de carga. `cargado` y `rechazado` solo valen si el tramo no cambió mientras
 * se cargaba (segundos, tarea o estado); si cambió, queda como está y se reintenta en la próxima ronda.
 */
export function registrarCarga(
  db: Database, id: number, datos: { entradaOpId: number | null; estado: EstadoCarga; motivo: string | null; segundos: number | null; tareaId: number },
): void {
  db.prepare(`update tramos_trabajo set entrada_op_id = @entrada,
    estado = case when @estado in ('cargado', 'rechazado') and (segundos is not @segundos or tarea_id <> @tarea or estado <> 'pendiente') then estado else @estado end,
    motivo = case when @estado = 'cargado' then null
      when @estado = 'rechazado' and (segundos is not @segundos or tarea_id <> @tarea or estado <> 'pendiente') then motivo
      else @motivo end where id = @id`)
    .run({ id, entrada: datos.entradaOpId, estado: datos.estado, motivo: datos.motivo, segundos: datos.segundos, tarea: datos.tareaId });
}

/** Guarda cuanto antes la entrada de OpenProject que el tramo ya tiene, aunque la carga después falle. */
export function guardarEntrada(db: Database, id: number, entradaOpId: number): void {
  db.prepare('update tramos_trabajo set entrada_op_id = ? where id = ?').run(entradaOpId, id);
}

/** Descarta el tramo ya sin entrada en OpenProject (la borró o nunca la tuvo). */
export function descartarSinEntrada(db: Database, id: number): void {
  db.prepare("update tramos_trabajo set estado = 'descartado', motivo = null, entrada_op_id = null where id = ?").run(id);
}

/** Cuándo empezó el último pedazo del tramo (el más reciente). */
export function inicioUltimoPedazo(db: Database, tramoId: number): string | null {
  return (db.prepare('select max(desde) from pedazos_trabajo where tramo_id = ?').pluck().get(tramoId) as string | null) ?? null;
}

export const pendientesDeCarga = (db: Database): Tramo[] =>
  lista(db, "where t.fin is not null and t.estado = 'pendiente' order by t.id");

export const MOTIVO_TAREA_BORRADA = 'La tarea ya no existe en OpenProject';

/**
 * La tarea se borró en OpenProject (con sus horas): los tramos cerrados que no estén descartados pasan a
 * `rechazado` sin entrada, para que su dueño los pase a otra tarea. Devuelve cuántos tocó.
 */
export function rechazarPorTareaBorrada(db: Database, tareaIds: readonly number[]): number {
  if (tareaIds.length === 0) return 0;
  const marcas = tareaIds.map(() => '?').join(',');
  return db.prepare(`update tramos_trabajo set estado = 'rechazado', motivo = ?, entrada_op_id = null
    where fin is not null and estado <> 'descartado' and tarea_id in (${marcas})`).run(MOTIVO_TAREA_BORRADA, ...tareaIds).changes;
}
