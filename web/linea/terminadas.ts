import { useCallback, useState } from 'react';

const CLAVE = 'opendash.linea.terminadas';

function leer(): Set<string> {
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    const lista: unknown = crudo === null ? [] : JSON.parse(crudo);
    return new Set(Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function guardar(franjas: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify([...franjas]));
  } catch {
    // Sin almacenamiento las terminadas a la vista valen solo mientras la pantalla está abierta.
  }
}

/** Franjas con sus terminadas a la vista; se recuerdan en este navegador. Por defecto todas van plegadas. */
export function useTerminadasVisibles(): { terminadasVisibles: ReadonlySet<string>; alternar(franja: string): void } {
  const [terminadasVisibles, setVisibles] = useState<ReadonlySet<string>>(leer);
  const alternar = useCallback((franja: string) => {
    setVisibles((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(franja)) nuevo.delete(franja);
      else nuevo.add(franja);
      guardar(nuevo);
      return nuevo;
    });
  }, []);
  return { terminadasVisibles, alternar };
}
