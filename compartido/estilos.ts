export const TONOS = [
  'azul', 'rosa', 'violeta', 'verde', 'naranja', 'turquesa', 'indigo',
  'celeste', 'lima', 'fucsia', 'cobre', 'amarillo', 'coral',
] as const;
export type Tono = (typeof TONOS)[number];

/** Tono estable para un id (persona o proyecto). */
export function tonoPara(id: number): Tono {
  return TONOS[Math.abs(id) % TONOS.length]!;
}

/**
 * Reparte un tono a cada proyecto sin repetir mientras alcancen los colores.
 * Los ids se recorren de menor a mayor; los elegidos conservan su tono y nadie más lo recibe.
 * Si se acaban, el proyecto cae al tono estable de `tonoPara`.
 */
export function repartirTonos(proyectoIds: readonly number[], elegidos: ReadonlyMap<number, Tono>): Map<number, Tono> {
  const usados = new Set<Tono>(elegidos.values());
  const reparto = new Map<number, Tono>();
  for (const id of [...new Set(proyectoIds)].sort((a, b) => a - b)) {
    const elegido = elegidos.get(id);
    if (elegido) { reparto.set(id, elegido); continue; }
    const libre = TONOS.find((t) => !usados.has(t));
    if (libre) usados.add(libre);
    reparto.set(id, libre ?? tonoPara(id));
  }
  return reparto;
}

/** Íconos que se pueden elegir para un proyecto; la web traduce cada uno a su ícono de lucide. */
export const ICONOS_PROYECTO = [
  'carpeta', 'cohete', 'celular', 'cuadricula', 'hoja', 'llama', 'grafico', 'escudo', 'engranaje', 'maletin', 'globo', 'codigo',
] as const;
export type IconoProyecto = (typeof ICONOS_PROYECTO)[number];

export interface EstiloProyecto { color: Tono; icono: IconoProyecto }

/** El estilo de un proyecto al que nadie le eligió uno. */
export function estiloPorDefecto(proyectoId: number): EstiloProyecto {
  return { color: tonoPara(proyectoId), icono: 'carpeta' };
}
