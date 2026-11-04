import type { Tarea } from '../../compartido/tipos.js';
import { Avatar } from '../ui/Avatar.js';
import type { ContextoLinea } from './contextoLinea.js';

/** A la izquierda del nombre: el avatar del responsable. En Por persona no hay marcador (la franja ya dice de quién es). */
export function MarcadorPersona({ tarea, ctx }: { tarea: Tarea; ctx: ContextoLinea }) {
  if (ctx.porPersona) return null;
  const responsable = tarea.responsableId === null ? null : (ctx.personas.get(tarea.responsableId) ?? null);
  return <Avatar persona={responsable} tamano={22} />;
}
