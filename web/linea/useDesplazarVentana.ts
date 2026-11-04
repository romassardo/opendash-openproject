import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { desdeTrasArrastre, type Ventana } from './modelo.js';

/** Desplazamiento mínimo (px) para que tocar el fondo cuente como arrastre. */
const UMBRAL_ARRASTRE = 3;
/** Lo que se agarra para correr la ventana: el fondo de las pistas y la fila de fechas. */
const FONDO = '.renglon__pista, .linea__marcas';
/** Lo que tiene su propio gesto o se toca: barras y sus bordes, el puntito de unir, las flechas y los botones. */
const CON_GESTO_PROPIO = 'button, a, [data-tarea-id], [data-unir], [data-gesto], .flecha__zona';

interface Arrastre { puntero: number; x0: number; desde: string; pxPorDia: number; movio: boolean; ultimo: string }

/** El desde nuevo mientras se arrastra (`final: false`) y al soltar (`final: true`). */
export type AlDesplazar = (desde: string, final: boolean) => void;

/** Arrastrar el fondo de la línea a los costados corre la ventana de a un día; devuelve los manejadores del lienzo. */
export function useDesplazarVentana(ventana: Ventana, alDesplazar: AlDesplazar | undefined) {
  const arrastre = useRef<Arrastre | null>(null);
  const [desplazando, setDesplazando] = useState(false);
  const aviso = useRef(alDesplazar);
  useLayoutEffect(() => {
    aviso.current = alDesplazar;
  });
  // Si la línea se desmonta en pleno arrastre (por ejemplo, una falla al recargar), lo corrido se guarda igual.
  useEffect(() => () => {
    const a = arrastre.current;
    if (a?.movio) aviso.current?.(a.ultimo, true);
  }, []);

  const terminar = () => {
    const a = arrastre.current;
    arrastre.current = null;
    if (!a?.movio) return;
    setDesplazando(false);
    aviso.current?.(a.ultimo, true);
  };

  const manejadores = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!alDesplazar || e.button !== 0 || arrastre.current) return;
      const objetivo = e.target as Element;
      if (!objetivo.closest(FONDO) || objetivo.closest(CON_GESTO_PROPIO)) return;
      // Sin esto el arrastre empieza a seleccionar texto.
      e.preventDefault();
      arrastre.current = { puntero: e.pointerId, x0: e.clientX, desde: ventana.desde, pxPorDia: ventana.pxPorDia, movio: false, ultimo: ventana.desde };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const a = arrastre.current;
      if (!a || e.pointerId !== a.puntero) return;
      const dx = e.clientX - a.x0;
      if (!a.movio) {
        if (Math.abs(dx) < UMBRAL_ARRASTRE) return;
        a.movio = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDesplazando(true);
      }
      const nuevo = desdeTrasArrastre(a.desde, dx, a.pxPorDia);
      if (nuevo === a.ultimo) return;
      a.ultimo = nuevo;
      aviso.current?.(nuevo, false);
    },
    onPointerUp: terminar,
    onPointerCancel: terminar,
    onLostPointerCapture: terminar,
  };

  return { desplazando, manejadores: alDesplazar ? manejadores : undefined };
}
