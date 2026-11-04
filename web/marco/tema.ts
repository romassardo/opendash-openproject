import { useSyncExternalStore } from 'react';

export type Tema = 'oscuro' | 'claro';

const CLAVE = 'od:tema';
const oyentes = new Set<() => void>();

const esTema = (valor: unknown): valor is Tema => valor === 'oscuro' || valor === 'claro';

function ponerAtributo(tema: Tema): void {
  if (document.documentElement.dataset.tema === tema) return;
  document.documentElement.dataset.tema = tema;
  oyentes.forEach((avisar) => avisar());
}

export function temaGuardado(): Tema | null {
  try {
    const valor = localStorage.getItem(CLAVE);
    return esTema(valor) ? valor : null;
  } catch {
    return null;
  }
}

/** Cambia el tema y lo recuerda en este navegador. */
export function aplicarTema(tema: Tema): void {
  ponerAtributo(tema);
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    // Sin almacenamiento (modo privado estricto): el tema vale hasta recargar.
  }
}

/** Al arrancar: el tema guardado en este navegador o, si no hay, oscuro. No guarda nada. */
export function prepararTema(): void {
  ponerAtributo(temaGuardado() ?? 'oscuro');
}

/**
 * Con los datos de la persona: si este navegador no tiene tema guardado, adopta el del servidor y
 * lo guarda, así la próxima carga arranca directo con ese tema (sin pasar por oscuro).
 */
export function adoptarTemaDelServidor(temaDelServidor: string): void {
  if (temaGuardado() !== null) {
    prepararTema();
    return;
  }
  if (esTema(temaDelServidor)) aplicarTema(temaDelServidor);
  else prepararTema();
}

export function temaActual(): Tema {
  return document.documentElement.dataset.tema === 'claro' ? 'claro' : 'oscuro';
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  return () => oyentes.delete(avisar);
}

export function useTema(): Tema {
  return useSyncExternalStore(suscribir, temaActual);
}
