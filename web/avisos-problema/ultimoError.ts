const VENTANA_MS = 10 * 60_000;
const MAX_TEXTO = 1500;

interface ErrorAnotado { texto: string; en: number }

let ultimo: ErrorAnotado | null = null;

/** «Nombre: mensaje» corto de lo que se haya lanzado. */
export function describir(error: unknown): string {
  const texto = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return texto.slice(0, MAX_TEXTO);
}

/** Guarda el último error de la app para adjuntarlo a un aviso. */
export function anotarError(error: unknown, ahora: Date = new Date()): void {
  ultimo = { texto: describir(error), en: ahora.getTime() };
}

/** El último error de los 10 minutos anteriores, o `null`. */
export function errorReciente(ahora: Date = new Date()): string | null {
  if (ultimo === null || ahora.getTime() - ultimo.en > VENTANA_MS) return null;
  return ultimo.texto;
}

/** Para pruebas. */
export function olvidarError(): void {
  ultimo = null;
}
