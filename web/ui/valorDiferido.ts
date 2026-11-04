import { useEffect, useRef, useState } from 'react';

const ESPERA_MS = 400;

/**
 * Valor de un `<select>` que se guarda al elegirlo. En Chrome y Edge de Windows las flechas sobre un select cerrado
 * disparan un cambio por paso: se muestra enseguida lo elegido y se guarda solo lo que queda tras `espera` ms,
 * sin los valores del medio. Si el valor guardado cambia (llegó la lista recargada) o el guardado termina, manda el guardado.
 */
export function useValorDiferido<T extends string | number>(
  guardado: T,
  guardar: (valor: string) => void,
  espera = ESPERA_MS,
): [valor: string, elegir: (valor: string) => void, soltar: () => void] {
  const [elegido, setElegido] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimoGuardar = useRef(guardar);
  ultimoGuardar.current = guardar;

  useEffect(() => {
    setElegido(null);
  }, [guardado]);
  useEffect(() => () => {
    if (temporizador.current !== null) clearTimeout(temporizador.current);
  }, []);

  const elegir = (valor: string): void => {
    setElegido(valor);
    if (temporizador.current !== null) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      temporizador.current = null;
      if (valor !== String(guardado)) ultimoGuardar.current(valor);
      else setElegido(null);
    }, espera);
  };
  // Al terminar de guardar (bien o mal) vuelve a mandar el valor guardado: si falló, el select no queda mintiendo.
  const soltar = (): void => setElegido(null);
  return [elegido ?? String(guardado), elegir, soltar];
}
