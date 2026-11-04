import type { QueryClient } from '@tanstack/react-query';
import { claveContenedor, type OrdenLinea } from '../../compartido/linea.js';
import type { Pausa, PausaNueva } from '../../compartido/pausas.js';
import type { Catalogo, Dependencia, NuevaTarea, Tarea } from '../../compartido/tipos.js';
import { CLAVES, type ListaTareas } from '../api/consultas.js';
import { diaMesCorto } from '../fechas.js';
import { MSG_CONFLICTO, mensajeDeError } from '../tareas/acciones.js';
import { columnaDeTarea } from '../tareas/logica.js';
import { calendarioDe, habilesEntre } from '../../compartido/calendarioOp.js';
import { anteriorEnConflicto } from './cadena.js';
import { fechasDetras, planCascada, type Corrimiento } from './cascada.js';
import type { FechasBarra } from './arrastre.js';
import {
  borrarTarea, borrarUnion, crearPausa, crearTarea, crearUnion, esError, escribirFechas, guardarOrden, MSG_SIN_PERMISO, quitarPausa, releerTareas,
  reprogramarAutomatica,
} from './escrituras.js';
import { aplicarOrden as ordenarTareas, bajarDetras } from './ordenLista.js';
import { mismasFechas, movidasEntre, type FechasTarea, type Paso } from './registro.js';

// Los cambios de la línea contra la API, sin React: cada uno devuelve qué pasó y los pasos para deshacerlo.

export interface ContextoCambios {
  cliente: QueryClient;
  catalogo: Catalogo;
  /** Si la tarea cae en vacaciones de su responsable: el texto; si no, `null`. */
  vacacionesDe(tarea: Tarea): string | null;
}

export interface Resultado {
  pasos: Paso[]; texto: string; error: boolean; vacaciones: string | null;
  /** Si está, el aviso ofrece «Abrir» esa tarea en lugar de «Deshacer». */
  abrirId?: number;
  /** La tarea que se creó, si el cambio fue un alta. */
  creada?: Tarea;
}

const listaDe = (cliente: QueryClient): ListaTareas | undefined => cliente.getQueryData<ListaTareas>(CLAVES.tareas);
const tareaDe = (cliente: QueryClient, id: number): Tarea | undefined => listaDe(cliente)?.tareas.find((t) => t.id === id);
const fechasDe = (t: Pick<Tarea, 'inicio' | 'fin'>): FechasTarea => ({ inicio: t.inicio, fin: t.fin });
const esHitoDe = (catalogo: Catalogo, t: Tarea): boolean => catalogo.tipos.find((x) => x.id === t.tipoId)?.esHito === true;
const entre = (titulo: string): string => `«${titulo}»`;

export function textoDeFallo(error: unknown): string {
  if (esError(error, 'conflicto', 409)) return MSG_CONFLICTO;
  if (esError(error, 'prohibido', 403)) return MSG_SIN_PERMISO;
  return mensajeDeError(error);
}

const fallo = (pasos: Paso[], error: unknown): Resultado => ({ pasos, texto: textoDeFallo(error), error: true, vacaciones: null });

function fraseCorridas(n: number): string {
  return n === 1 ? 'Se corrió 1 tarea que la espera.' : `Se corrieron ${n} tareas que la esperan.`;
}

/** La primera tarea abierta que cae en vacaciones, armada como línea de aviso. */
function avisoVacaciones(ctx: ContextoCambios, candidatas: readonly Tarea[]): string | null {
  for (const t of candidatas) {
    if (columnaDeTarea(t, ctx.catalogo) === 'cerrado') continue;
    const texto = ctx.vacacionesDe(t);
    if (texto !== null) return `«${t.titulo}» cae en vacaciones: ${texto}.`;
  }
  return null;
}

/** Ids del contenedor (proyecto y madre) en el orden vigente: el guardado, o el inicial. Incluye las tareas fuera de la ventana. */
export function idsDeContenedor(cliente: QueryClient, lista: ListaTareas, proyectoId: number, madreId: number | null): number[] {
  const clave = claveContenedor(proyectoId, madreId);
  const delContenedor = lista.tareas.filter((t) => t.proyectoId === proyectoId && t.madreId === madreId);
  const guardado = cliente.getQueryData<OrdenLinea>(CLAVES.ordenLinea)?.[clave];
  return ordenarTareas(delContenedor, guardado, lista.dependencias).map((t) => t.id);
}

interface Corridas { hechas: number; total: number; frenada: { titulo: string; motivo: string } | null; sinPermiso: string[] }

/** Escribe las corridas de a una, con el `lockVersion` vigente y solo si la tarea sigue como se vio. */
async function escribirCorridas(ctx: ContextoCambios, plan: readonly Corrimiento[], pasos: Paso[]): Promise<Corridas> {
  const { cliente, catalogo } = ctx;
  const resultado: Corridas = { hechas: 0, total: plan.length, frenada: null, sinPermiso: [] };
  for (const c of plan) {
    const tarea = tareaDe(cliente, c.tareaId);
    if (!tarea) return { ...resultado, frenada: { titulo: c.titulo, motivo: 'ya no está en la lista' } };
    if (!mismasFechas(tarea, c.antes)) return { ...resultado, frenada: { titulo: c.titulo, motivo: 'cambió mientras tanto en OpenProject' } };
    try {
      const guardada = await escribirFechas(cliente, tarea, c.despues, esHitoDe(catalogo, tarea));
      pasos.push({ tipo: 'fechas', tareaId: c.tareaId, titulo: c.titulo, antes: c.antes, despues: fechasDe(guardada) });
      resultado.hechas += 1;
    } catch (error) {
      if (esError(error, 'prohibido', 403)) {
        resultado.sinPermiso.push(c.titulo);
        continue;
      }
      return { ...resultado, frenada: { titulo: c.titulo, motivo: textoDeFallo(error) } };
    }
  }
  return resultado;
}

function textoFrenada(c: Corridas): string {
  const partes = [`Se movieron ${c.hechas} de ${c.total}.`];
  if (c.frenada) partes.push(`${entre(c.frenada.titulo)} no se pudo mover: ${c.frenada.motivo}`);
  if (c.sinPermiso.length > 0) partes.push(`Quedaron afuera por falta de permiso: ${c.sinPermiso.map(entre).join(', ')}.`);
  return partes.join(' ');
}

const hayProblema = (c: Corridas): boolean => c.frenada !== null || c.sinPermiso.length > 0;

/** Tope de vueltas de la cascada: cada una corre lo que OpenProject reprogramó por las corridas de la anterior. */
const MAX_VUELTAS_CASCADA = 6;

/**
 * Corre lo que la tarea `desdeId` pisó y vuelve a planificar sobre la lista fresca hasta que no quede nada
 * (una automática que reprograma OpenProject entre dos manuales puede dejar pisada a la segunda).
 * Devuelve la lista fresca si hubo corridas o problemas; si no, la que recibió.
 */
async function correrCascada(
  ctx: ContextoCambios, desdeId: number, lista: ListaTareas, pasos: Paso[],
): Promise<{ lista: ListaTareas; corridas: Corridas }> {
  const suma: Corridas = { hechas: 0, total: 0, frenada: null, sinPermiso: [] };
  let actual = lista;
  for (let vuelta = 0; vuelta < MAX_VUELTAS_CASCADA; vuelta += 1) {
    const plan = planCascada(desdeId, actual.tareas, actual.dependencias, ctx.catalogo, calendarioDe(ctx.catalogo));
    if (plan.length === 0) break;
    const c = await escribirCorridas(ctx, plan, pasos);
    suma.hechas += c.hechas;
    suma.total += c.total;
    suma.frenada = suma.frenada ?? c.frenada;
    suma.sinPermiso.push(...c.sinPermiso);
    if (c.hechas > 0 || hayProblema(c)) actual = await releerTareas(ctx.cliente);
    if (c.hechas === 0 || hayProblema(c)) break;
  }
  return { lista: actual, corridas: suma };
}

function invalidar(cliente: QueryClient, id?: number): void {
  void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
  if (id !== undefined) void cliente.invalidateQueries({ queryKey: CLAVES.tarea(id) });
}

function textoMovida(t: Pick<Tarea, 'inicio' | 'fin'>): string {
  const inicio = t.inicio ?? t.fin;
  const fin = t.fin ?? t.inicio;
  if (!inicio || !fin || inicio === fin) return `Movida al ${diaMesCorto(inicio ?? fin ?? '')}.`;
  return `Movida: ahora va del ${diaMesCorto(inicio)} al ${diaMesCorto(fin)}.`;
}

/** Escribe las fechas de la tarea movida y corre las sucesoras manuales que pisó. */
export async function aplicarMover(ctx: ContextoCambios, tarea: Tarea, fechas: FechasBarra, esHito: boolean): Promise<Resultado> {
  const { cliente, catalogo } = ctx;
  const previa = listaDe(cliente)?.tareas ?? [];
  const pasos: Paso[] = [];
  let guardada: Tarea;
  try {
    guardada = await escribirFechas(cliente, tarea, fechas, esHito);
  } catch (error) {
    invalidar(cliente, tarea.id);
    return fallo(pasos, error);
  }
  pasos.push({ tipo: 'fechas', tareaId: tarea.id, titulo: tarea.titulo, antes: fechasDe(tarea), despues: fechasDe(guardada) });
  try {
    let lista = await releerTareas(cliente);
    const cascada = await correrCascada(ctx, tarea.id, lista, pasos);
    const { corridas } = cascada;
    lista = cascada.lista;
    const cambiadas = movidasEntre(previa, lista.tareas).filter((t) => t.id !== tarea.id);
    const movida = lista.tareas.find((t) => t.id === tarea.id) ?? guardada;
    const vacaciones = avisoVacaciones(ctx, [movida, ...cambiadas]);
    if (hayProblema(corridas)) return { pasos, texto: textoFrenada(corridas), error: true, vacaciones };
    const texto = cambiadas.length > 0 ? `Movida. ${fraseCorridas(cambiadas.length)}` : textoMovida(movida);
    return { pasos, texto, error: false, vacaciones };
  } catch (error) {
    invalidar(cliente);
    return fallo(pasos, error);
  }
}

/**
 * Una sucesora que era manual no cambia de modo por unirla: si OpenProject la pasó a automática (o quedó
 * encimada), se escribe de nuevo en manual, en sus fechas de antes o, si quedó pisada, en las mínimas.
 */
async function devolverManual(ctx: ContextoCambios, antes: Tarea, actual: Tarea, antesId: number, lista: ListaTareas): Promise<Tarea> {
  const supuesta: Tarea = { ...actual, programacionManual: true, inicio: antes.inicio, fin: antes.fin };
  const plan = planCascada(
    antesId, lista.tareas.map((t) => (t.id === antes.id ? supuesta : t)), lista.dependencias, ctx.catalogo, calendarioDe(ctx.catalogo),
  );
  const corrida = plan.find((c) => c.tareaId === antes.id);
  const objetivo: FechasTarea = corrida ? corrida.despues : fechasDe(antes);
  if (actual.programacionManual && mismasFechas(actual, objetivo)) return actual;
  return escribirFechas(ctx.cliente, actual, objetivo, esHitoDe(ctx.catalogo, actual), true);
}

/**
 * Corre la sucesora pisada detrás de su anterior (conservando su duración hábil) y la cascada de las manuales que pisó.
 * Una automática se vuelve a guardar en automático (sin fechas, con su duración hábil) para que OpenProject la reprograme; si no la corre,
 * el resultado ofrece abrirla.
 */
export async function aplicarCorrerDetras(ctx: ContextoCambios, sucesoraId: number): Promise<Resultado> {
  const { cliente, catalogo } = ctx;
  const pasos: Paso[] = [];
  try {
    let lista = await releerTareas(cliente);
    const previa = lista.tareas;
    const tarea = previa.find((t) => t.id === sucesoraId);
    if (!tarea) return fallo([], new Error('La tarea ya no está en la lista. Recargá la pantalla.'));
    const nuevas = fechasDetras(sucesoraId, lista.tareas, lista.dependencias, catalogo);
    if (nuevas === null) return { pasos: [], texto: 'Ya no se pisa con la anterior.', error: false, vacaciones: null };
    const anterior = anteriorEnConflicto(sucesoraId, lista.tareas, lista.dependencias, catalogo)?.titulo ?? 'la anterior';
    // Una automática no acepta fechas pisadas (OpenProject 16 da 422): se le pide que se reprograme sola.
    const guardada = tarea.programacionManual
      ? await escribirFechas(cliente, tarea, nuevas, esHitoDe(catalogo, tarea), true)
      : await reprogramarAutomatica(cliente, tarea, esHitoDe(catalogo, tarea) ? undefined : habilesEntre(nuevas.inicio, nuevas.fin, calendarioDe(catalogo)));
    // Lo que OpenProject reprograma en una automática no se deshace (no acepta fechas pisadas): solo se anota lo manual.
    if (tarea.programacionManual) {
      pasos.push({ tipo: 'fechas', tareaId: tarea.id, titulo: tarea.titulo, antes: fechasDe(tarea), despues: fechasDe(guardada) });
    }
    lista = await releerTareas(cliente);
    if (fechasDetras(sucesoraId, lista.tareas, lista.dependencias, catalogo) !== null) {
      return { pasos, texto: 'OpenProject no la corrió; abrila para revisarla', error: true, vacaciones: null, abrirId: sucesoraId };
    }
    const cascada = await correrCascada(ctx, sucesoraId, lista, pasos);
    const { corridas } = cascada;
    lista = cascada.lista;
    const movida = lista.tareas.find((t) => t.id === sucesoraId) ?? guardada;
    const otras = movidasEntre(previa, lista.tareas).filter((t) => t.id !== sucesoraId);
    const vacaciones = avisoVacaciones(ctx, [movida, ...otras]);
    if (hayProblema(corridas)) return { pasos, texto: textoFrenada(corridas), error: true, vacaciones };
    const inicio = movida.inicio ?? movida.fin ?? '';
    const fin = movida.fin ?? movida.inicio ?? '';
    const rango = inicio === fin ? `el ${diaMesCorto(inicio)}` : `del ${diaMesCorto(inicio)} al ${diaMesCorto(fin)}`;
    const base = `Corrida detrás de ${entre(anterior)}: ${rango}.`;
    return { pasos, texto: otras.length > 0 ? `${base} ${fraseCorridas(otras.length)}` : base, error: false, vacaciones };
  } catch (error) {
    invalidar(cliente, sucesoraId);
    return fallo(pasos, error);
  }
}

/** Une dos tareas (B espera a A), corre lo que haga falta y acomoda la lista si están juntas. */
export async function aplicarUnir(ctx: ContextoCambios, antesId: number, despuesId: number): Promise<Resultado> {
  const { cliente, catalogo } = ctx;
  const previa = listaDe(cliente)?.tareas ?? [];
  const antesT = previa.find((t) => t.id === antesId);
  const despuesT = previa.find((t) => t.id === despuesId);
  if (!antesT || !despuesT) return fallo([], new Error('La tarea ya no está en la lista. Recargá la pantalla.'));
  const pasos: Paso[] = [];
  try {
    const dependencia = await crearUnion(cliente, despuesId, antesId);
    let lista = await releerTareas(cliente);
    const leida = lista.tareas.find((t) => t.id === despuesId) ?? despuesT;
    const pasoUnion = (sucesora: Tarea): Paso => ({
      tipo: 'union-creada', dependencia,
      sucesora: { tareaId: despuesId, titulo: despuesT.titulo, antes: fechasDe(despuesT), despues: fechasDe(sucesora), manualAntes: despuesT.programacionManual },
    });
    // La unión ya existe en OpenProject: se registra antes de seguir, así un fallo después igual se puede deshacer.
    pasos.push(pasoUnion(leida));
    const sucesora = despuesT.programacionManual ? await devolverManual(ctx, despuesT, leida, antesId, lista) : leida;
    pasos.splice(pasos.length - 1, 1, pasoUnion(sucesora));
    if (sucesora !== leida) lista = await releerTareas(cliente);
    const cascada = await correrCascada(ctx, despuesId, lista, pasos);
    const { corridas } = cascada;
    lista = cascada.lista;
    if (antesT.proyectoId === despuesT.proyectoId && antesT.madreId === despuesT.madreId) {
      const ids = idsDeContenedor(cliente, lista, antesT.proyectoId, antesT.madreId);
      const nuevo = bajarDetras(ids, antesId, despuesId);
      if (nuevo !== null) {
        const contenedor = claveContenedor(antesT.proyectoId, antesT.madreId);
        await guardarOrden(cliente, contenedor, nuevo);
        pasos.push({ tipo: 'orden', contenedor, antes: ids, despues: nuevo });
      }
    }
    const cambiadas = movidasEntre(previa, lista.tareas).filter((t) => t.id !== despuesId);
    const vacaciones = avisoVacaciones(ctx, [lista.tareas.find((t) => t.id === despuesId) ?? sucesora, ...cambiadas]);
    if (hayProblema(corridas)) return { pasos, texto: textoFrenada(corridas), error: true, vacaciones };
    const base = `Unidas: ${entre(despuesT.titulo)} ahora va detrás de ${entre(antesT.titulo)}.`;
    return { pasos, texto: cambiadas.length > 0 ? `${base} ${fraseCorridas(cambiadas.length)}` : base, error: false, vacaciones };
  } catch (error) {
    invalidar(cliente);
    return fallo(pasos, error);
  }
}

/** Suelta una unión: la sucesora se queda en sus fechas. */
export async function aplicarSoltar(ctx: ContextoCambios, dependencia: Dependencia): Promise<Resultado> {
  const { cliente } = ctx;
  const antesT = tareaDe(cliente, dependencia.predecesoraId);
  const despuesT = tareaDe(cliente, dependencia.sucesoraId);
  try {
    await borrarUnion(cliente, dependencia);
    await releerTareas(cliente);
  } catch (error) {
    invalidar(cliente);
    return fallo([], error);
  }
  const texto = `Listo: ${entre(despuesT?.titulo ?? 'la tarea')} ya no espera a ${entre(antesT?.titulo ?? 'la otra')}. Se queda en sus fechas y ahora la podés mover.`;
  return { pasos: [{ tipo: 'union-borrada', dependencia }], texto, error: false, vacaciones: null };
}

/** Guarda el orden nuevo de un contenedor. */
export async function aplicarOrden(ctx: ContextoCambios, contenedor: string, ids: number[]): Promise<Resultado> {
  const { cliente } = ctx;
  const lista = listaDe(cliente);
  const guardado = cliente.getQueryData<OrdenLinea>(CLAVES.ordenLinea)?.[contenedor];
  const [proyecto, madre] = contenedor.split(':').map(Number);
  const antes = guardado ?? (lista && proyecto !== undefined && madre !== undefined
    ? idsDeContenedor(cliente, lista, proyecto, madre === 0 ? null : madre)
    : []);
  try {
    await guardarOrden(cliente, contenedor, ids);
  } catch (error) {
    void cliente.invalidateQueries({ queryKey: CLAVES.ordenLinea });
    return fallo([], error);
  }
  return { pasos: [{ tipo: 'orden', contenedor, antes: [...antes], despues: ids }], texto: 'Orden cambiado: lo ven así todos.', error: false, vacaciones: null };
}

/**
 * Pausa la tarea en esas fechas: el servidor corre su fin (el trabajo no cambia) y acá se corren en cascada las
 * manuales que quedaron pisadas. «Deshacer» devuelve las corridas y quita la pausa.
 */
export async function aplicarPausar(ctx: ContextoCambios, tarea: Tarea, nueva: PausaNueva, fechas: { desde: string; hasta: string }): Promise<Resultado> {
  const { cliente } = ctx;
  const previa = listaDe(cliente)?.tareas ?? [];
  const pasos: Paso[] = [];
  let creada: { tarea: Tarea; pausa: Pausa };
  try {
    creada = await crearPausa(cliente, tarea, nueva);
  } catch (error) {
    invalidar(cliente, tarea.id);
    return fallo(pasos, error);
  }
  pasos.push({ tipo: 'pausa-creada', pausa: creada.pausa, titulo: tarea.titulo });
  try {
    const cascada = await correrCascada(ctx, tarea.id, await releerTareas(cliente), pasos);
    const { corridas, lista } = cascada;
    const pausada = lista.tareas.find((t) => t.id === tarea.id) ?? creada.tarea;
    const cambiadas = movidasEntre(previa, lista.tareas).filter((t) => t.id !== tarea.id);
    const vacaciones = avisoVacaciones(ctx, [pausada, ...cambiadas]);
    if (hayProblema(corridas)) return { pasos, texto: textoFrenada(corridas), error: true, vacaciones };
    const rango = fechas.desde === fechas.hasta ? `el ${diaMesCorto(fechas.desde)}` : `del ${diaMesCorto(fechas.desde)} al ${diaMesCorto(fechas.hasta)}`;
    const base = `En pausa ${rango}: ahora termina el ${diaMesCorto(pausada.fin ?? '')}.`;
    return { pasos, texto: cambiadas.length > 0 ? `${base} ${fraseCorridas(cambiadas.length)}` : base, error: false, vacaciones };
  } catch (error) {
    invalidar(cliente);
    return fallo(pasos, error);
  }
}

/** Quita la pausa: el servidor devuelve el fin. «Deshacer» la vuelve a poner en el mismo lugar del trabajo. */
export async function aplicarQuitarPausa(ctx: ContextoCambios, pausa: Pausa, titulo: string): Promise<Resultado> {
  const { cliente } = ctx;
  try {
    const tarea = await quitarPausa(cliente, pausa);
    await releerTareas(cliente);
    const texto = tarea?.fin ? `Pausa quitada: ${entre(titulo)} ahora termina el ${diaMesCorto(tarea.fin)}.` : `Pausa quitada de ${entre(titulo)}.`;
    return { pasos: [{ tipo: 'pausa-quitada', pausa, titulo }], texto, error: false, vacaciones: null };
  } catch (error) {
    invalidar(cliente, pausa.tareaId);
    return fallo([], error);
  }
}

export const MSG_SIN_PERMISO_CREAR = 'No tenés permiso para crear tareas en ese proyecto de OpenProject.';

/** Crea una tarea desde la línea; «Deshacer» la borra. */
export async function aplicarCrear(ctx: ContextoCambios, nueva: NuevaTarea): Promise<Resultado> {
  const { cliente } = ctx;
  let tarea: Tarea;
  try {
    tarea = await crearTarea(cliente, nueva);
  } catch (error) {
    if (esError(error, 'prohibido', 403)) return { pasos: [], texto: MSG_SIN_PERMISO_CREAR, error: true, vacaciones: null };
    return fallo([], error);
  }
  // Una madre automática se estira con su hija nueva: la lista fresca trae sus fechas nuevas.
  invalidar(cliente, tarea.madreId ?? undefined);
  const inicio = tarea.inicio ?? tarea.fin;
  const fin = tarea.fin ?? tarea.inicio;
  const rango = !inicio || !fin ? '' : inicio === fin ? ` el ${diaMesCorto(inicio)}` : ` del ${diaMesCorto(inicio)} al ${diaMesCorto(fin)}`;
  return {
    pasos: [{ tipo: 'tarea-creada', tareaId: tarea.id, titulo: tarea.titulo }],
    texto: `Creada ${entre(tarea.titulo)}${rango}. Movela, unila o abrila para completarla.`,
    error: false,
    vacaciones: avisoVacaciones(ctx, [tarea]),
    creada: tarea,
  };
}

const mismosIds = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Escribe las fechas viejas; si alguien la cambió justo (409/403), la deja como está y la nombra. */
async function escribirOSaltear(
  ctx: ContextoCambios, tarea: Tarea, fechas: FechasTarea, programacionManual: boolean | undefined, salteadas: string[],
): Promise<void> {
  try {
    await escribirFechas(ctx.cliente, tarea, fechas, esHitoDe(ctx.catalogo, tarea), programacionManual);
  } catch (error) {
    if (!esError(error, 'conflicto', 409) && !esError(error, 'prohibido', 403)) throw error;
    salteadas.push(entre(tarea.titulo));
  }
}

/** Devuelve cada paso, del último al primero, sobre la lista fresca; lo que cambió mientras tanto no se toca. */
export async function aplicarDeshacer(ctx: ContextoCambios, pasos: readonly Paso[]): Promise<Resultado> {
  const { cliente } = ctx;
  const salteadas: string[] = [];
  // Se deshace del último al primero: `restan` cuenta los pasos (desde el primero) que todavía no se deshicieron.
  let restan = pasos.length;
  let parcial: Paso | null = null;
  try {
    await releerTareas(cliente);
    for (let i = pasos.length - 1; i >= 0; i -= 1) {
      const paso = pasos[i]!;
      restan = i + 1;
      parcial = null;
      if (paso.tipo === 'fechas') {
        const actual = tareaDe(cliente, paso.tareaId);
        if (!actual || !mismasFechas(actual, paso.despues)) { salteadas.push(entre(paso.titulo)); continue; }
        await escribirOSaltear(ctx, actual, paso.antes, undefined, salteadas);
      } else if (paso.tipo === 'union-creada') {
        await borrarUnion(cliente, paso.dependencia);
        const { sucesora } = paso;
        // Con la unión ya borrada, lo que falta es devolverle las fechas a la sucesora.
        parcial = { tipo: 'fechas', tareaId: sucesora.tareaId, titulo: sucesora.titulo, antes: sucesora.antes, despues: sucesora.despues };
        await releerTareas(cliente);
        const actual = tareaDe(cliente, sucesora.tareaId);
        if (!actual || !mismasFechas(actual, sucesora.despues)) { salteadas.push(entre(sucesora.titulo)); continue; }
        await escribirOSaltear(ctx, actual, sucesora.antes, sucesora.manualAntes, salteadas);
      } else if (paso.tipo === 'union-borrada') {
        const { sucesoraId, predecesoraId, lag } = paso.dependencia;
        const previa = tareaDe(cliente, sucesoraId);
        await crearUnion(cliente, sucesoraId, predecesoraId, lag);
        // Al unirla OpenProject pasa a la sucesora manual a automática y la puede correr: se la deja como estaba.
        if (previa?.programacionManual) {
          await releerTareas(cliente);
          const actual = tareaDe(cliente, sucesoraId);
          if (actual && (!actual.programacionManual || !mismasFechas(actual, previa))) {
            await escribirOSaltear(ctx, actual, fechasDe(previa), true, salteadas);
          }
        }
      } else if (paso.tipo === 'tarea-creada') {
        await borrarTarea(cliente, paso.tareaId);
      } else if (paso.tipo === 'pausa-creada') {
        await quitarPausa(cliente, paso.pausa);
      } else if (paso.tipo === 'pausa-quitada') {
        const actual = tareaDe(cliente, paso.pausa.tareaId);
        if (!actual) { salteadas.push(entre(paso.titulo)); continue; }
        try {
          await crearPausa(cliente, actual, { despues: paso.pausa.despues, dias: paso.pausa.dias });
        } catch (error) {
          // Si la tarea cambió mientras tanto (o la pausa ya no entra), queda como está y se la nombra.
          if (!esError(error, 'conflicto', 409) && !esError(error, 'validacion', 422) && !esError(error, 'prohibido', 403)) throw error;
          salteadas.push(entre(paso.titulo));
        }
      } else {
        const actual = cliente.getQueryData<OrdenLinea>(CLAVES.ordenLinea)?.[paso.contenedor];
        if (actual === undefined || !mismosIds(actual, paso.despues)) { salteadas.push('el orden de la lista'); continue; }
        await guardarOrden(cliente, paso.contenedor, paso.antes);
      }
    }
    await releerTareas(cliente);
  } catch (error) {
    invalidar(cliente);
    return fallo(parcial ? [...pasos.slice(0, restan - 1), parcial] : pasos.slice(0, restan), error);
  }
  const texto = salteadas.length === 0
    ? 'Listo, quedó como estaba.'
    : `Se deshizo lo demás; ${salteadas.join(', ')} cambió mientras tanto y quedó como está.`;
  return { pasos: [], texto, error: false, vacaciones: null };
}
