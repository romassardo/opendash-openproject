/** Orden compartido de la lista de la línea de tiempo: clave del contenedor → ids de tareas en orden. */
export type OrdenLinea = Record<string, number[]>;

export const PATRON_CONTENEDOR = /^\d{1,9}:\d{1,9}$/;

/** Un contenedor es un proyecto (madre 0) o una tarea madre dentro de un proyecto. */
export function claveContenedor(proyectoId: number, madreId: number | null): string {
  return `${proyectoId}:${madreId ?? 0}`;
}

export function proyectoDeContenedor(clave: string): number | null {
  if (!PATRON_CONTENEDOR.test(clave)) return null;
  return Number(clave.split(':')[0]);
}
