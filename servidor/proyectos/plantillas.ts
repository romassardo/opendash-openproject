/** Plantillas de OpenProject más las marcadas a mano, menos las desmarcadas a mano; solo proyectos visibles. */
export function plantillasVisibles(deOp: number[], manual: Record<number, boolean>, visibles: ReadonlySet<number>): number[] {
  const ids = new Set([...deOp, ...Object.keys(manual).map(Number)]);
  return [...ids].filter((id) => visibles.has(id) && (manual[id] ?? true)).sort((a, b) => a - b);
}
