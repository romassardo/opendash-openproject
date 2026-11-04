import { useEffect, useState } from 'react';
import { movimientoReducido } from '../animaciones/entradas.js';

/** Cuánto dura la salida de una fila arreglada (el CSS de `.ordenar__fila--sale` usa la misma). */
export const MS_SALIDA = 260;

export interface ConSalida<T> { item: T; sale: boolean }

type Saliendo<T> = ReadonlyMap<string, { item: T; indice: number }>;

/**
 * Las filas de la lista, más las que acaban de irse: esas quedan un instante marcadas con `sale` para que el CSS las anime.
 * Se calcula al renderizar (no en un efecto), así la fila que se va nunca falta en ningún cuadro y no se vuelve a montar.
 * Con movimiento reducido las filas se van al instante. Si cambia `contexto` (por ejemplo el filtro), las filas que
 * desaparecen no se animan: no las arregló nadie, solo dejaron de corresponder.
 */
export function useConSalida<T>(items: readonly T[], clave: (item: T) => string, contexto = ''): ConSalida<T>[] {
  const [saliendo, setSaliendo] = useState<Saliendo<T>>(new Map());
  const [previas, setPrevias] = useState<readonly T[]>(items);
  const [contextoPrevio, setContextoPrevio] = useState(contexto);

  if (previas !== items || contextoPrevio !== contexto) {
    setPrevias(items);
    setContextoPrevio(contexto);
    const ahora = new Set(items.map(clave));
    const idas = previas
      .map((item, indice) => ({ item, indice }))
      .filter((x) => !ahora.has(clave(x.item)));
    const animar = contextoPrevio === contexto && idas.length > 0 && !movimientoReducido();
    setSaliendo((previo) => (animar ? new Map([...previo, ...idas.map((x): [string, typeof x] => [clave(x.item), x])]) : contextoPrevio === contexto ? previo : new Map()));
  }

  // Un solo reloj para todas las que están saliendo; se cancela al desmontar o si llega otra salida.
  useEffect(() => {
    if (saliendo.size === 0) return undefined;
    const reloj = window.setTimeout(() => setSaliendo(new Map()), MS_SALIDA);
    return () => window.clearTimeout(reloj);
  }, [saliendo]);

  const vivas = new Set(items.map(clave));
  const resultado: ConSalida<T>[] = items.map((item) => ({ item, sale: false }));
  [...saliendo.entries()]
    .filter(([id]) => !vivas.has(id))
    .sort((a, b) => a[1].indice - b[1].indice)
    .forEach(([, { item, indice }]) => resultado.splice(Math.min(indice, resultado.length), 0, { item, sale: true }));
  return resultado;
}
