import { useCallback, useState } from 'react';

const CLAVE = 'opendash.linea.plegados';

function leer(): Set<number> {
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    const lista: unknown = crudo === null ? [] : JSON.parse(crudo);
    return new Set(Array.isArray(lista) ? lista.filter((x): x is number => typeof x === 'number') : []);
  } catch {
    return new Set();
  }
}

function guardar(ids: ReadonlySet<number>): void {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify([...ids]));
  } catch {
    // Sin almacenamiento los grupos plegados valen solo mientras la pantalla está abierta.
  }
}

/** Grupos plegados de la línea; se recuerdan en este navegador. */
export function usePlegados(): { plegados: ReadonlySet<number>; alternar(id: number): void } {
  const [plegados, setPlegados] = useState<ReadonlySet<number>>(leer);
  const alternar = useCallback((id: number) => {
    setPlegados((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      guardar(nuevo);
      return nuevo;
    });
  }, []);
  return { plegados, alternar };
}
