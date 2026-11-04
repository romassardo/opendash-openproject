import type { Persona } from '../../compartido/tipos.js';

/** Ruta propia del avatar de una persona (el proxy de `personas/rutas.ts`). */
export const rutaAvatar = (personaId: number): string => `/api/personas/${personaId}/avatar`;

/** La persona como la ve el navegador: el avatar por el proxy propio, nunca la URL de OpenProject. */
export function conAvatarPropio(persona: Persona): Persona {
  return { ...persona, avatarUrl: persona.avatarUrl ? rutaAvatar(persona.id) : null };
}
