import type { Database } from 'better-sqlite3';
import type { CatalogoOp, Tarea } from '../../compartido/tipos.js';
import { marcarTokenVencido } from '../auth/clientes.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { contarComentarios, fechaDeCierre } from '../openproject/historial.js';
import type { CacheOp } from './cache.js';
import { REGISTRO_MUDO, type Registro } from '../registro.js';
import { conLimite } from './pool.js';

export interface ServicioSync {
  cargaCompleta(usuarioId: number): Promise<void>;
  refrescoIncremental(usuarioId: number): Promise<void>;
  /** Vuelve a leer a quién se puede asignar en un proyecto (después de cambiar sus miembros). */
  releerAsignables(usuarioId: number, proyectoId: number): Promise<void>;
  iniciar(): void;
  detener(): void;
  estado(): { desactualizado: boolean; ultimoRefresco: string | null };
}

export interface DepsSync {
  db: Database;
  cache: CacheOp;
  clientePara: (usuarioId: number) => ClienteOp | null;
  ahora: () => Date;
  usuariosActivos: () => number[];
  registro?: Registro;
  intervalos?: { incrementalMs: number; completoMs: number };
}

const INTERVALOS = { incrementalMs: 45_000, completoMs: 60 * 60_000 };
const MARGEN_MS = 60_000;
/** 90 días de Métricas más el período anterior, con margen. */
export const CIERRES_RECIENTES_MS = 185 * 24 * 60 * 60_000;
const SIMULTANEAS = 3;

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : 'error desconocido');

export function crearServicioSync(deps: DepsSync): ServicioSync {
  const { db, cache } = deps;
  const registro = deps.registro ?? REGISTRO_MUDO;
  const intervalos = deps.intervalos ?? INTERVALOS;
  const leer = db.prepare('select valor from estado_sync where clave = ?').pluck();
  const escribir = db.prepare(
    'insert into estado_sync (clave, valor) values (?, ?) on conflict(clave) do update set valor = excluded.valor',
  );
  const reemplazarProyectos = db.transaction((usuarioId: number, proyectoIds: number[]) => {
    db.prepare('delete from usuario_proyectos where usuario_id = ?').run(usuarioId);
    const poner = db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (?, ?)');
    for (const id of proyectoIds) poner.run(usuarioId, id);
  });

  const estado = (): { desactualizado: boolean; ultimoRefresco: string | null } => ({
    desactualizado: leer.get('desactualizado') === '1',
    ultimoRefresco:
      (db.prepare("select max(valor) from estado_sync where clave like 'ultimo_refresco:%'").pluck().get() as string | null) ?? null,
  });

  const marcarCorrecto = (usuarioId: number, inicio: Date, completa: boolean): void => {
    escribir.run(`ultimo_refresco:${usuarioId}`, inicio.toISOString());
    if (completa) escribir.run(`ultimo_completo:${usuarioId}`, inicio.toISOString());
    escribir.run('desactualizado', '0');
  };

  // Un refresco nunca rechaza: 401 vence el token, cualquier otra falla deja la caché y marca desactualizado.
  async function protegido(usuarioId: number, trabajo: (cliente: ClienteOp) => Promise<void>): Promise<void> {
    try {
      const cliente = deps.clientePara(usuarioId);
      if (cliente === null) return;
      await trabajo(cliente);
    } catch (error) {
      if (error instanceof ErrorOp && error.tipo === 'no-autorizado') {
        marcarTokenVencido(db, usuarioId);
        return;
      }
      escribir.run('desactualizado', '1');
      const motivo = error instanceof ErrorOp ? error.tipo : 'interno';
      registro.warn({ motivo, usuarioId }, `[sync] refresco fallido (${motivo}): ${mensajeDe(error)}`);
    }
  }

  const idsCerrados = (catalogo: CatalogoOp): Set<number> => new Set(catalogo.estados.filter((e) => e.cerrado).map((e) => e.id));

  // Guarda las tareas; las que no están cerradas pierden cualquier fecha de cierre vieja. Una copia más
  // vieja que la de la caché (la app escribió mientras tanto) no se guarda ni toca el cierre: se devuelven
  // solo las que quedaron guardadas.
  function guardarTareas(tareas: Tarea[], cerrados: Set<number>, leidaDesde?: string): Tarea[] {
    const guardadas = new Set(cache.guardarTareas(tareas, leidaDesde === undefined ? undefined : { leidaDesde }));
    const vigentes = tareas.filter((t) => guardadas.has(t.id));
    for (const t of vigentes) if (!cerrados.has(t.estadoId)) cache.quitarCierre(t.id);
    return vigentes;
  }

  // Pide el historial de cada tarea (de a 3): guarda comentarios y, si está cerrada, su fecha de cierre.
  async function completarHistorial(cliente: ClienteOp, tareas: Tarea[], catalogo: CatalogoOp): Promise<void> {
    const cerrados = idsCerrados(catalogo);
    const nombresCerrados = catalogo.estados.filter((e) => e.cerrado).map((e) => e.nombre);
    await conLimite(tareas, SIMULTANEAS, async (tarea) => {
      let actividades;
      try {
        actividades = await cliente.actividades(tarea.id);
      } catch (error) {
        if (error instanceof ErrorOp && error.tipo === 'no-autorizado') throw error;
        registro.warn({ motivo: 'historial-omitido', tareaId: tarea.id }, `[sync] historial de la tarea ${tarea.id} omitido: ${mensajeDe(error)}`);
        return;
      }
      cache.guardarComentarios(tarea.id, contarComentarios(actividades));
      if (cerrados.has(tarea.estadoId)) {
        cache.guardarCierre(tarea.id, fechaDeCierre(actividades, nombresCerrados) ?? tarea.actualizada);
      }
    });
  }

  // Proyectos visibles en los que además se pueden leer las tareas.
  async function proyectosLegibles(cliente: ClienteOp, visibles: number[]): Promise<number[]> {
    const lecturas = await conLimite(visibles, SIMULTANEAS, (id) => cliente.puedeLeerTareas(id));
    return visibles.filter((_, i) => lecturas[i] === true);
  }

  // A quién se puede asignar en cada proyecto legible; esas personas suman al catálogo aunque no tengan tareas.
  // Un proyecto cuya lista no se pudo traer se omite: su clave no se escribe y queda lo que ya había en la caché.
  async function conAsignables(cliente: ClienteOp, catalogo: CatalogoOp, legibles: number[]): Promise<CatalogoOp> {
    const listas = await conLimite(legibles, SIMULTANEAS, async (id) => {
      try {
        return await cliente.asignables(id);
      } catch (error) {
        if (error instanceof ErrorOp && error.tipo === 'no-autorizado') throw error;
        registro.warn({ motivo: 'asignables-omitidos', proyectoId: id }, `[sync] asignables del proyecto ${id} omitidos: ${mensajeDe(error)}`);
        return null;
      }
    });
    const personas = new Map(catalogo.personas.map((p) => [p.id, p] as const));
    const asignables: Record<number, number[]> = {};
    legibles.forEach((id, i) => {
      const lista = listas[i];
      if (lista === null || lista === undefined) return;
      for (const p of lista) personas.set(p.id, p);
      asignables[id] = lista.map((p) => p.id);
    });
    return { ...catalogo, personas: [...personas.values()], asignables };
  }

  async function ejecutarCompleta(usuarioId: number): Promise<void> {
    await protegido(usuarioId, async (cliente) => {
      const inicio = deps.ahora();
      const base = await cliente.catalogo();
      const legibles = await proyectosLegibles(cliente, base.proyectos.map((p) => p.id));
      const catalogo = await conAsignables(cliente, base, legibles);
      // Momento previo a la lectura: una escritura nuestra posterior no se pisa, una fila más vieja sí.
      const leidaDesde = deps.ahora().toISOString();
      const lote = await cliente.tareas();
      const tareas = lote.tareas;
      const dependencias = await cliente.dependencias();
      const cerrados = idsCerrados(catalogo);
      // Cerradas que cambiaron desde la última vez (pudieron reabrirse y cerrarse sin que un incremental lo viera).
      const cambiadas = new Set(tareas.filter((t) => cache.tarea(t.id)?.actualizada !== t.actualizada).map((t) => t.id));
      const vacioSospechoso = tareas.length === 0 && cache.tareas(legibles).length > 0;
      if (vacioSospechoso) registro.warn({ motivo: 'vacio-sospechoso' }, '[sync] OpenProject devolvió 0 tareas con la caché llena: no se borra nada');
      const vigentes = db.transaction(() => {
        cache.guardarCatalogo(catalogo);
        const guardadas = guardarTareas(tareas, cerrados, leidaDesde);
        if (!vacioSospechoso) cache.quitarAusentes([...tareas.map((t) => t.id), ...lote.salteadas], legibles);
        cache.guardarDependencias(dependencias, tareas.map((t) => t.id));
        reemplazarProyectos(usuarioId, legibles);
        return guardadas;
      })();

      const limite = inicio.getTime() - CIERRES_RECIENTES_MS;
      const conHistorial = vigentes.filter((t) =>
        cerrados.has(t.estadoId) ? Date.parse(t.actualizada) >= limite && (cache.tarea(t.id)?.cerradaEl == null || cambiadas.has(t.id)) : true,
      );
      await completarHistorial(cliente, conHistorial, catalogo);
      marcarCorrecto(usuarioId, inicio, true);
    });
  }

  async function ejecutarIncremental(usuarioId: number): Promise<void> {
    const ultimo = leer.get(`ultimo_refresco:${usuarioId}`) as string | undefined;
    const catalogo = cache.catalogo();
    if (ultimo === undefined || catalogo === null) return ejecutarCompleta(usuarioId);
    await protegido(usuarioId, async (cliente) => {
      const inicio = deps.ahora();
      const desde = new Date(Date.parse(ultimo) - MARGEN_MS).toISOString();
      const nuevas = guardarTareas((await cliente.tareas({ actualizadasDesde: desde })).tareas, idsCerrados(catalogo));
      // Son pocas: se recuentan los comentarios y se vuelve a leer el cierre de todas.
      await completarHistorial(cliente, nuevas, catalogo);
      marcarCorrecto(usuarioId, inicio, false);
    });
  }

  // Cola única: ninguna corrida (turnos, registro, ingreso) se superpone con otra.
  let cola: Promise<void> = Promise.resolve();
  let pendientes = 0;
  function encolar(trabajo: () => Promise<void>): Promise<void> {
    pendientes += 1;
    const corrida = cola
      .then(trabajo)
      .catch((error: unknown) => registro.warn({ motivo: 'corrida-fallida' }, `[sync] corrida fallida: ${mensajeDe(error)}`))
      .finally(() => { pendientes -= 1; });
    cola = corrida;
    return corrida;
  }
  const cargaCompleta = (usuarioId: number): Promise<void> => encolar(() => ejecutarCompleta(usuarioId));
  const refrescoIncremental = (usuarioId: number): Promise<void> => encolar(() => ejecutarIncremental(usuarioId));

  async function ejecutarAsignables(usuarioId: number, proyectoId: number): Promise<void> {
    await protegido(usuarioId, async (cliente) => {
      const catalogo = cache.catalogo();
      if (catalogo === null) return;
      const lista = await cliente.asignables(proyectoId);
      if (lista === null) return;
      const personas = new Map(catalogo.personas.map((p) => [p.id, p] as const));
      for (const p of lista) personas.set(p.id, p);
      cache.guardarCatalogo({ ...catalogo, personas: [...personas.values()], asignables: { [proyectoId]: lista.map((p) => p.id) } });
    });
  }
  const releerAsignables = (usuarioId: number, proyectoId: number): Promise<void> => encolar(() => ejecutarAsignables(usuarioId, proyectoId));

  let temporizadores: NodeJS.Timeout[] = [];
  let primerTurno = true;

  function usuariosConCliente(): number[] {
    return deps.usuariosActivos().filter((id) => {
      try {
        return deps.clientePara(id) !== null;
      } catch (error) {
        registro.warn({ motivo: 'sin-cliente', usuarioId: id }, `[sync] sin cliente para el usuario ${id}: ${mensajeDe(error)}`);
        return false;
      }
    });
  }

  async function paraCadaUsuario(corrida: (usuarioId: number) => Promise<void>): Promise<void> {
    for (const id of usuariosConCliente()) await corrida(id);
  }

  return {
    cargaCompleta,
    refrescoIncremental,
    releerAsignables,
    estado,
    iniciar() {
      if (temporizadores.length > 0) return;
      primerTurno = true;
      temporizadores = [
        setInterval(() => {
          if (pendientes > 0) return;
          const completa = primerTurno;
          primerTurno = false;
          void encolar(() => paraCadaUsuario(completa ? ejecutarCompleta : ejecutarIncremental));
        }, intervalos.incrementalMs),
        // La carga horaria no se pierde si coincide con otra corrida: espera su turno en la cola.
        setInterval(() => void encolar(() => paraCadaUsuario(ejecutarCompleta)), intervalos.completoMs),
      ];
      for (const t of temporizadores) t.unref();
    },
    detener() {
      for (const t of temporizadores) clearInterval(t);
      temporizadores = [];
    },
  };
}
