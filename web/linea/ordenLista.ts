import type { Dependencia, Tarea } from '../../compartido/tipos.js';

// Orden de la lista de la línea de tiempo: el inicial (por cadenas) y el guardado y compartido.

const SIN_FECHA = '9999-12-31';
const inicioDe = (t: Tarea): string => t.inicio ?? t.fin ?? SIN_FECHA;
const porInicioEId = (a: Tarea, b: Tarea): number => inicioDe(a).localeCompare(inicioDe(b)) || a.id - b.id;

/** Grupos de tareas conectadas por dependencias (solo las que están en la lista). */
function grupos(tareas: readonly Tarea[], dependencias: readonly Dependencia[]): Tarea[][] {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const vecinas = new Map<number, number[]>(tareas.map((t) => [t.id, []]));
  for (const d of dependencias) {
    if (!porId.has(d.predecesoraId) || !porId.has(d.sucesoraId)) continue;
    vecinas.get(d.predecesoraId)!.push(d.sucesoraId);
    vecinas.get(d.sucesoraId)!.push(d.predecesoraId);
  }
  const vistos = new Set<number>();
  const resultado: Tarea[][] = [];
  for (const tarea of tareas) {
    if (vistos.has(tarea.id)) continue;
    const grupo: Tarea[] = [];
    const pendientes = [tarea.id];
    vistos.add(tarea.id);
    while (pendientes.length > 0) {
      const actual = pendientes.pop()!;
      grupo.push(porId.get(actual)!);
      for (const v of vecinas.get(actual)!) {
        if (!vistos.has(v)) { vistos.add(v); pendientes.push(v); }
      }
    }
    resultado.push(grupo);
  }
  return resultado;
}

/** Nivel de cada tarea del grupo: el camino más largo de predecesoras (con tope por si hubiera un ciclo). */
function niveles(grupo: readonly Tarea[], dependencias: readonly Dependencia[]): Map<number, number> {
  const ids = new Set(grupo.map((t) => t.id));
  const predecesoras = new Map<number, number[]>(grupo.map((t) => [t.id, []]));
  for (const d of dependencias) {
    if (ids.has(d.predecesoraId) && ids.has(d.sucesoraId)) predecesoras.get(d.sucesoraId)!.push(d.predecesoraId);
  }
  const memo = new Map<number, number>();
  const nivelDe = (id: number, camino: Set<number>): number => {
    const guardado = memo.get(id);
    if (guardado !== undefined) return guardado;
    if (camino.has(id)) return 0;
    const siguiente = new Set(camino).add(id);
    const nivel = predecesoras.get(id)!.reduce((max, p) => Math.max(max, nivelDe(p, siguiente) + 1), 0);
    memo.set(id, nivel);
    return nivel;
  };
  for (const t of grupo) nivelDe(t.id, new Set());
  return memo;
}

/** Cada cadena de dependencias junta y en orden de espera; los grupos y las sueltas, por su inicio más temprano. */
export function ordenInicial(tareas: readonly Tarea[], dependencias: readonly Dependencia[]): Tarea[] {
  const ordenados = grupos(tareas, dependencias).map((grupo) => {
    const nivel = niveles(grupo, dependencias);
    const miembros = [...grupo].sort((a, b) => (nivel.get(a.id)! - nivel.get(b.id)!) || porInicioEId(a, b));
    const clave = [...grupo].sort(porInicioEId)[0]!;
    return { miembros, clave };
  });
  ordenados.sort((a, b) => porInicioEId(a.clave, b.clave));
  return ordenados.flatMap((g) => g.miembros);
}

/** Aplica el orden guardado; las tareas sin lugar guardado entran según su fecha de inicio. */
export function aplicarOrden(tareas: readonly Tarea[], guardado: readonly number[] | undefined, dependencias: readonly Dependencia[]): Tarea[] {
  if (guardado === undefined) return ordenInicial(tareas, dependencias);
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const ubicadas: Tarea[] = [];
  const usados = new Set<number>();
  for (const id of guardado) {
    const tarea = porId.get(id);
    if (tarea === undefined || usados.has(id)) continue;
    usados.add(id);
    ubicadas.push(tarea);
  }
  const nuevas = tareas.filter((t) => !usados.has(t.id)).sort(porInicioEId);
  return nuevas.reduce<Tarea[]>((lista, nueva) => {
    const posicion = lista.findIndex((t) => inicioDe(t) > inicioDe(nueva));
    return posicion === -1 ? [...lista, nueva] : [...lista.slice(0, posicion), nueva, ...lista.slice(posicion)];
  }, ubicadas);
}

/** Saca `id` de su lugar y lo pone en `nuevoIndice` de la lista resultante. */
export function moverEnLista(ids: readonly number[], id: number, nuevoIndice: number): number[] {
  if (!ids.includes(id)) return [...ids];
  const resto = ids.filter((i) => i !== id);
  const destino = Math.max(0, Math.min(nuevoIndice, resto.length));
  return [...resto.slice(0, destino), id, ...resto.slice(destino)];
}

/** Pone `despuesId` justo después de `antesId`; `null` si falta alguna o ya está detrás. */
export function bajarDetras(ids: readonly number[], antesId: number, despuesId: number): number[] | null {
  const iAntes = ids.indexOf(antesId);
  const iDespues = ids.indexOf(despuesId);
  if (iAntes === -1 || iDespues === -1 || iDespues > iAntes) return null;
  const resto = ids.filter((i) => i !== despuesId);
  const destino = resto.indexOf(antesId) + 1;
  return [...resto.slice(0, destino), despuesId, ...resto.slice(destino)];
}
