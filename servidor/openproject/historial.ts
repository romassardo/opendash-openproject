import type { Actividad } from '../../compartido/tipos.js';

// «Estado se cambió de X a Y», «Estado establecido al Y», «Status changed from X to Y»
const CAMBIO_DE_ESTADO = /^(Estado|Status)\b.*\s(?:a|al|to)\s(.+)$/;

export function fechaDeCierre(actividades: Actividad[], estadosCerrados: string[]): string | null {
  let masReciente: { ms: number; creada: string } | null = null;
  for (const actividad of actividades) {
    const cierra = actividad.detalles.some((d) => {
      const nuevo = CAMBIO_DE_ESTADO.exec(d)?.[2]?.trim();
      return nuevo !== undefined && estadosCerrados.includes(nuevo);
    });
    if (!cierra) continue;
    const ms = Date.parse(actividad.creada);
    if (masReciente === null || ms > masReciente.ms) masReciente = { ms, creada: actividad.creada };
  }
  return masReciente?.creada ?? null;
}

export function contarComentarios(actividades: Actividad[]): number {
  return actividades.filter((a) => a.comentario.trim() !== '').length;
}
