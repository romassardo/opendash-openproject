import type { Database } from 'better-sqlite3';
import type { CatalogoOp, Dependencia, Tarea, Version } from '../../compartido/tipos.js';

export interface CacheOp {
  catalogo(): CatalogoOp | null;
  /** Estados, tipos y prioridades se reemplazan; proyectos, versiones y personas se fusionan por id, y los asignables se reemplazan por proyecto. */
  guardarCatalogo(c: CatalogoOp): void;
  /** Pone (o reemplaza por id) una versión en el catálogo guardado; sin catálogo no hace nada. */
  guardarVersion(v: Version): void;
  /** Saca una versión del catálogo guardado: la fusión por id nunca la quitaría sola. */
  quitarVersion(id: number): void;
  tareas(proyectoIds: number[]): Tarea[];
  tarea(id: number): Tarea | null;
  /**
   * Guarda las tareas salvo las copias más viejas que la guardada; devuelve los ids que guardó. Con
   * `leidaDesde` (momento en que empezó la lectura en OpenProject) una copia más vieja también entra si
   * la fila guardada es anterior a esa lectura: así una base restaurada no queda congelada.
   */
  guardarTareas(t: Tarea[], opciones?: { leidaDesde?: string }): number[];
  quitarAusentes(idsVigentes: number[], proyectoIds: number[]): void;
  dependencias(): Dependencia[];
  /** Reemplaza las dependencias con ambos extremos en `tareaIds` (las que ese usuario puede ver) y deja el resto. */
  guardarDependencias(d: Dependencia[], tareaIds: number[]): void;
  /** Agrega (o reemplaza por id) una dependencia sin tocar las demás. */
  agregarDependencia(d: Dependencia): void;
  quitarDependencia(id: number): void;
  /** Borra las tareas con su cierre, sus comentarios y las dependencias que las tocan. */
  quitarTareas(ids: number[]): void;
  quitarCierre(tareaId: number): void;
  guardarCierre(tareaId: number, fecha: string): void;
  guardarComentarios(tareaId: number, cantidad: number): void;
  proyectosDe(usuarioId: number): number[];
}

interface FilaTarea { datos: string; cerradaEl: string | null; comentarios: number | null }

const SELECT_TAREAS = `select t.datos as datos, c.cerrada_el as cerradaEl, m.cantidad as comentarios
  from cache_tareas t
  left join cierres c on c.tarea_id = t.id
  left join comentarios_cuenta m on m.tarea_id = t.id`;

function aTarea(fila: FilaTarea): Tarea {
  const base = JSON.parse(fila.datos) as Tarea;
  // Las guardadas antes de que existiera un campo no lo traen.
  return { ...base, horasReales: base.horasReales ?? null, restanteHoras: base.restanteHoras ?? null, cerradaEl: fila.cerradaEl, comentarios: fila.comentarios };
}

export function crearCache(db: Database, ahora: () => Date = () => new Date()): CacheOp {
  const sql = {
    leerCatalogo: db.prepare("select datos from cache_catalogo where clave = 'catalogo'"),
    guardarCatalogo: db.prepare(
      "insert into cache_catalogo (clave, datos, actualizado) values ('catalogo', ?, ?) on conflict(clave) do update set datos = excluded.datos, actualizado = excluded.actualizado",
    ),
    tarea: db.prepare(`${SELECT_TAREAS} where t.id = ?`),
    // Una copia con lockVersion menor que la guardada es más vieja (una sincronización que empezó antes
    // de una escritura): no la pisa, salvo que la fila guardada sea anterior a la lectura (?5 = leidaDesde).
    guardarTarea: db.prepare(
      `insert into cache_tareas (id, proyecto_id, datos, actualizada, guardada) values (?1, ?2, ?3, ?4, ?6)
       on conflict(id) do update set proyecto_id = excluded.proyecto_id, datos = excluded.datos,
         actualizada = excluded.actualizada, guardada = excluded.guardada
       where json_extract(excluded.datos, '$.lockVersion') >= json_extract(cache_tareas.datos, '$.lockVersion')
          or (?5 is not null and (cache_tareas.guardada is null or cache_tareas.guardada < ?5))`,
    ),
    idsDeProyecto: db.prepare('select id from cache_tareas where proyecto_id = ?').pluck(),
    borrarTarea: db.prepare('delete from cache_tareas where id = ?'),
    borrarCierre: db.prepare('delete from cierres where tarea_id = ?'),
    borrarComentarios: db.prepare('delete from comentarios_cuenta where tarea_id = ?'),
    dependencias: db.prepare('select id, sucesora_id as sucesoraId, predecesora_id as predecesoraId, lag from cache_dependencias order by id'),
    todasDependencias: db.prepare('select id, sucesora_id, predecesora_id from cache_dependencias'),
    borrarDependencia: db.prepare('delete from cache_dependencias where id = ?'),
    borrarDependenciasDe: db.prepare('delete from cache_dependencias where sucesora_id = ? or predecesora_id = ?'),
    guardarDependencia: db.prepare('insert or replace into cache_dependencias (id, sucesora_id, predecesora_id, lag) values (?, ?, ?, ?)'),
    guardarCierre: db.prepare(
      'insert into cierres (tarea_id, cerrada_el) values (?, ?) on conflict(tarea_id) do update set cerrada_el = excluded.cerrada_el',
    ),
    guardarComentarios: db.prepare(
      'insert into comentarios_cuenta (tarea_id, cantidad) values (?, ?) on conflict(tarea_id) do update set cantidad = excluded.cantidad',
    ),
    proyectosDe: db.prepare('select proyecto_id from usuario_proyectos where usuario_id = ? order by proyecto_id').pluck(),
  };

  const guardarTareas = db.transaction((tareas: Tarea[], opciones?: { leidaDesde?: string }): number[] => {
    const guardadas: number[] = [];
    const leidaDesde = opciones?.leidaDesde ?? null;
    const ahoraIso = ahora().toISOString();
    for (const t of tareas) {
      // cerradaEl y comentarios viven en sus propias tablas: no se duplican en el JSON.
      const { cerradaEl: _cerradaEl, comentarios: _comentarios, ...resto } = t;
      if (sql.guardarTarea.run({ 1: t.id, 2: t.proyectoId, 3: JSON.stringify(resto), 4: t.actualizada, 5: leidaDesde, 6: ahoraIso }).changes > 0) guardadas.push(t.id);
    }
    return guardadas;
  });

  const quitarAusentes = db.transaction((idsVigentes: number[], proyectoIds: number[]) => {
    const vigentes = new Set(idsVigentes);
    for (const proyectoId of proyectoIds) {
      for (const id of sql.idsDeProyecto.all(proyectoId) as number[]) {
        if (vigentes.has(id)) continue;
        sql.borrarTarea.run(id);
        sql.borrarCierre.run(id);
        sql.borrarComentarios.run(id);
      }
    }
  });

  const quitarTareas = db.transaction((ids: number[]) => {
    for (const id of ids) {
      sql.borrarTarea.run(id);
      sql.borrarCierre.run(id);
      sql.borrarComentarios.run(id);
      sql.borrarDependenciasDe.run(id, id);
    }
  });

  const guardarDependencias = db.transaction((dependencias: Dependencia[], tareaIds: number[]) => {
    const propias = new Set(tareaIds);
    const filas = sql.todasDependencias.all() as { id: number; sucesora_id: number; predecesora_id: number }[];
    for (const f of filas) {
      if (propias.has(f.sucesora_id) && propias.has(f.predecesora_id)) sql.borrarDependencia.run(f.id);
    }
    for (const d of dependencias) sql.guardarDependencia.run(d.id, d.sucesoraId, d.predecesoraId, d.lag);
  });

  function leerCatalogo(): CatalogoOp | null {
    const datos = sql.leerCatalogo.pluck().get() as string | undefined;
    return datos === undefined ? null : (JSON.parse(datos) as CatalogoOp);
  }

  return {
    catalogo: leerCatalogo,
    guardarCatalogo: db.transaction((c: CatalogoOp) => {
      const previo = leerCatalogo();
      const fusionar = <T extends { id: number }>(viejos: T[], nuevos: T[]): T[] => [
        ...new Map([...viejos, ...nuevos].map((x) => [x.id, x] as const)).values(),
      ];
      const fusionado: CatalogoOp = previo === null ? c : {
        ...c,
        proyectos: fusionar(previo.proyectos, c.proyectos),
        versiones: fusionar(previo.versiones, c.versiones),
        personas: fusionar(previo.personas, c.personas),
        // Se reemplazan solo los proyectos que trae esta carga; una caché vieja puede no tener el campo.
        asignables: { ...previo.asignables, ...c.asignables },
      };
      sql.guardarCatalogo.run(JSON.stringify(fusionado), ahora().toISOString());
    }),
    guardarVersion(v) {
      const c = leerCatalogo();
      if (c === null) return;
      const resto = c.versiones.some((x) => x.id === v.id) ? c.versiones.map((x) => (x.id === v.id ? v : x)) : [...c.versiones, v];
      sql.guardarCatalogo.run(JSON.stringify({ ...c, versiones: resto }), ahora().toISOString());
    },
    quitarVersion(id) {
      const c = leerCatalogo();
      if (c === null) return;
      sql.guardarCatalogo.run(JSON.stringify({ ...c, versiones: c.versiones.filter((x) => x.id !== id) }), ahora().toISOString());
    },
    agregarDependencia(d) { sql.guardarDependencia.run(d.id, d.sucesoraId, d.predecesoraId, d.lag); },
    quitarDependencia(id) { sql.borrarDependencia.run(id); },
    quitarTareas,
    quitarCierre(tareaId) { sql.borrarCierre.run(tareaId); },
    tareas(proyectoIds) {
      if (proyectoIds.length === 0) return [];
      const marcas = proyectoIds.map(() => '?').join(',');
      const filas = db.prepare(`${SELECT_TAREAS} where t.proyecto_id in (${marcas}) order by t.id`).all(...proyectoIds) as FilaTarea[];
      return filas.map(aTarea);
    },
    tarea(id) {
      const fila = sql.tarea.get(id) as FilaTarea | undefined;
      return fila === undefined ? null : aTarea(fila);
    },
    guardarTareas,
    quitarAusentes,
    dependencias: () => sql.dependencias.all() as Dependencia[],
    guardarDependencias,
    guardarCierre(tareaId, fecha) { sql.guardarCierre.run(tareaId, fecha); },
    guardarComentarios(tareaId, cantidad) { sql.guardarComentarios.run(tareaId, cantidad); },
    proyectosDe: (usuarioId) => sql.proyectosDe.all(usuarioId) as number[],
  };
}
