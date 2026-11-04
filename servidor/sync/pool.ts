// Procesa `items` con a lo sumo `limite` trabajos a la vez. Ante el primer error no lanza
// trabajos nuevos, espera a los que están en vuelo y propaga ese error.
export async function conLimite<T, R>(items: readonly T[], limite: number, trabajo: (item: T) => Promise<R>): Promise<R[]> {
  const resultados = new Array<R>(items.length);
  let siguiente = 0;
  let fallo: { error: unknown } | null = null;

  async function operario(): Promise<void> {
    while (fallo === null && siguiente < items.length) {
      const indice = siguiente++;
      try {
        resultados[indice] = await trabajo(items[indice] as T);
      } catch (error) {
        fallo ??= { error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, operario));
  if (fallo !== null) throw (fallo as { error: unknown }).error;
  return resultados;
}
