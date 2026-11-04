import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import { ancestros, descendientes, sucesorasDe } from '../tareas/edicion.js';

// Reglas para unir dos tareas arrastrando: cuándo no se puede y qué decir.

export type MotivoNoUnir = 'misma' | 'ya-unidas' | 'circulo' | 'familia';

/** Por qué `despuesId` no puede esperar a `antesId`; `null` si se puede. */
export function motivoParaNoUnir(
  antesId: number, despuesId: number, tareas: readonly Tarea[], dependencias: readonly Dependencia[],
): MotivoNoUnir | null {
  if (antesId === despuesId) return 'misma';
  const lista = [...tareas];
  if (ancestros(antesId, lista).has(despuesId) || descendientes(antesId, lista).has(despuesId)) return 'familia';
  if (dependencias.some((d) => d.predecesoraId === antesId && d.sucesoraId === despuesId)) return 'ya-unidas';
  if (sucesorasDe(despuesId, [...dependencias]).has(antesId)) return 'circulo';
  return null;
}

export function textoNoUnir(motivo: MotivoNoUnir, antes: Tarea, despues: Tarea): string {
  switch (motivo) {
    case 'misma': return 'Una tarea no puede esperarse a sí misma.';
    case 'ya-unidas': return 'Esas dos ya estaban unidas.';
    case 'circulo': return `No se puede: «${despues.titulo}» ya va antes que «${antes.titulo}» y quedaría un círculo.`;
    case 'familia': return 'No se puede unir una tarea con su madre o sus hijas.';
  }
}
