import { gsap } from 'gsap';
import { useLayoutEffect, type RefObject } from 'react';
import { movimientoReducido } from '../animaciones/entradas.js';

// Tiempos de entrada: cada tipo de trazo arranca
// y dura distinto, siempre después de que la tarjeta ya se abrió.
const TRAZOS = {
  anillo: { retraso: 0.86, duracion: 0.8, curva: 'power2.inOut' },
  dona: { retraso: 0.98, duracion: 0.75, curva: 'power2.inOut' },
  linea: { retraso: 0.7, duracion: 1.4, curva: 'power2.inOut' },
} as const;
const BARRAS = { retraso: 0.74, duracion: 0.75, curva: 'power3.out', escalonado: 0.015 };
// El área bajo la línea aparece mientras se dibuja: arranca con ella y llega a su valor al final.
const AREA = { retraso: TRAZOS.linea.retraso, duracion: TRAZOS.linea.duracion, curva: 'power2.inOut' };

type TipoTrazo = keyof typeof TRAZOS;

const esTipo = (valor: string | undefined): valor is TipoTrazo => valor !== undefined && valor in TRAZOS;

/**
 * Animación de entrada de un gráfico SVG, al montar y cuando cambia el valor de `dependencias` (no su identidad):
 * - `[data-trazo="anillo|dona|linea"]` se dibuja desde el inicio. Esos trazos llevan `pathLength="1"`,
 *   así que el largo total es 1 sin medir nada;
 * - `[data-barra]` crece con `scaleY` desde la base;
 * - `[data-area]` aparece.
 * Con `prefers-reduced-motion` no hace nada: el gráfico queda en su estado final. Al limpiar revierte.
 */
export function useAnimacionGrafico(ref: RefObject<SVGSVGElement | null>, dependencias: unknown[]): void {
  // Las dependencias se comparan por valor: un padre que arma los arrays inline en cada render no
  // debe repetir la entrada. Los datos de los gráficos son planos, así que JSON alcanza.
  const clave = JSON.stringify(dependencias);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg || movimientoReducido()) return;
    const contexto = gsap.context(() => {
      (Object.keys(TRAZOS) as TipoTrazo[]).forEach((tipo) => {
        const trazos = Array.from(svg.querySelectorAll<SVGElement>('[data-trazo]')).filter((t) => {
          const valor = t.dataset.trazo;
          return esTipo(valor) && valor === tipo;
        });
        if (trazos.length === 0) return;
        const { retraso, duracion, curva } = TRAZOS[tipo];
        gsap.fromTo(
          trazos,
          { strokeDasharray: '1 2', strokeDashoffset: 1 },
          { strokeDashoffset: 0, duration: duracion, delay: retraso, ease: curva, clearProps: 'strokeDasharray,strokeDashoffset' },
        );
      });
      const barras = svg.querySelectorAll('[data-barra]');
      if (barras.length > 0) {
        gsap.fromTo(
          barras,
          { scaleY: 0, transformOrigin: '50% 100%' },
          {
            scaleY: 1,
            duration: BARRAS.duracion,
            delay: BARRAS.retraso,
            ease: BARRAS.curva,
            stagger: BARRAS.escalonado,
            clearProps: 'transform,transformOrigin',
          },
        );
      }
      const areas = svg.querySelectorAll('[data-area]');
      if (areas.length > 0) {
        gsap.fromTo(areas, { opacity: 0 }, { opacity: 1, duration: AREA.duracion, delay: AREA.retraso, ease: AREA.curva, clearProps: 'opacity' });
      }
    }, svg);
    return () => contexto.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, clave]);
}
