import type { Dependencia, NuevaTarea, Tarea } from '../../compartido/tipos.js';
import type { ClienteOp } from '../openproject/cliente.js';

// Tras un alta cuyo resultado quedó incierto (el POST venció o dio 502/504) se pregunta a OpenProject si
// el alta llegó a guardarse, para no duplicarla. Cada búsqueda devuelve null/false si no lo encuentra y
// lanza si no puede preguntar: quien la llama decide qué responder en cada caso.

/** La tarea del mismo proyecto, título, autor y madre, creada desde `desde`; si hay varias, la creada más nueva. */
export async function buscarTareaCreada(
  cliente: ClienteOp, datos: NuevaTarea, autorId: number, desde: string,
): Promise<Tarea | null> {
  const { tareas } = await cliente.tareas({ actualizadasDesde: desde });
  const titulo = datos.titulo.trim();
  const limite = Date.parse(desde);
  const madreId = datos.madreId ?? null;
  const candidatas = tareas.filter((t) => t.proyectoId === datos.proyectoId && t.titulo.trim() === titulo && t.autorId === autorId
    && t.madreId === madreId && Date.parse(t.creada) >= limite);
  return candidatas.reduce<Tarea | null>(
    (mejor, t) => (mejor === null || Date.parse(t.creada) > Date.parse(mejor.creada) ? t : mejor),
    null,
  );
}

/** ¿Hay un comentario de ese autor, con ese texto, creado desde `desde`? */
export async function buscarComentario(
  cliente: ClienteOp, tareaId: number, autorId: number, texto: string, desde: string,
): Promise<boolean> {
  const actividades = await cliente.actividades(tareaId);
  const buscado = texto.trim();
  const limite = Date.parse(desde);
  return actividades.some((a) => a.comentario === buscado && a.autorId === autorId && Date.parse(a.creada) >= limite);
}

/** La dependencia que hace esperar a la sucesora por la predecesora, si existe. */
export async function buscarDependencia(
  cliente: ClienteOp, sucesoraId: number, predecesoraId: number,
): Promise<Dependencia | null> {
  const dependencias = await cliente.dependencias();
  return dependencias.find((d) => d.sucesoraId === sucesoraId && d.predecesoraId === predecesoraId) ?? null;
}
