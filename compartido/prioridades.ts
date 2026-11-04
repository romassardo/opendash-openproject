import type { Prioridad } from './tipos.js';

export type NivelPrioridad = 'baja' | 'normal' | 'alta' | 'inmediata';

export const NOMBRE_NIVEL: Record<NivelPrioridad, string> = { baja: 'Baja', normal: 'Normal', alta: 'Alta', inmediata: 'Urgente' };

const NIVEL_POR_NOMBRE: Record<string, NivelPrioridad> = {
  low: 'baja', baja: 'baja',
  normal: 'normal',
  high: 'alta', alta: 'alta',
  immediate: 'inmediata', urgent: 'inmediata', inmediata: 'inmediata', urgente: 'inmediata',
};

/** Nivel de una prioridad de OpenProject por su nombre (en inglés o en castellano); `null` si no se reconoce. */
export function nivelDePrioridad(nombre: string): NivelPrioridad | null {
  return NIVEL_POR_NOMBRE[nombre.trim().toLowerCase()] ?? null;
}

/** Lo que se ve de una prioridad: su nivel en castellano o, si no se reconoce, el nombre que le puso OpenProject. */
export function etiquetaPrioridad(p: Prioridad): string {
  // Un catálogo guardado antes de existir `nivel` no lo trae: se muestra el nombre hasta la próxima sincronización.
  return p.nivel ? NOMBRE_NIVEL[p.nivel] : p.nombre;
}
