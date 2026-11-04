import { gsap } from 'gsap';
import { useLayoutEffect, type RefObject } from 'react';

// Medido en la referencia: el vidrio se abre desde el centro con un recorte redondeado
// (36 % de cada lado), sube 30 px y crece desde 0,97; las piezas suben 12 px y aparecen.
const RECORTE_INICIAL = 0.36;
const DESBORDE_FINAL = 60;
const VIDRIO = { y: 30, escala: 0.97 };
const PIEZA = { y: 12 };

// Primera carga del marco: la barra lateral entra desde la izquierda con un recorte del 20 %, la de
// herramientas baja 0,1 s después (recorte 22,5 %) y los ítems del menú llegan desde x −10 px a los 0,19 s.
const LATERAL = { x: -30, escala: 0.97, recorte: 0.2 };
const HERRAMIENTAS = { y: -16, escala: 0.97, recorte: 0.225, retraso: 0.1 };
const MENU = { x: -10, escalonado: 0.035, retraso: 0.19 };
// Título: cada letra sube desde el 115 % de su alto, girada 6°, enmascarada por su palabra.
const LETRA = { desde: 115, giro: 6, duracion: 0.7, escalonado: 0.02 };
// Cambio de pantalla: los vidrios de la vista saliente se achican y suben antes de que entre la nueva.
const SALIDA = { y: -6, escala: 0.97, duracion: 0.18 };

export function movimientoReducido(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Lee un token de tiempo (`0.9s`, `60ms`) del contenedor; si falta, usa el valor medido. */
function segundos(elemento: HTMLElement, token: string, porDefecto: number): number {
  const texto = getComputedStyle(elemento).getPropertyValue(token).trim();
  const numero = Number.parseFloat(texto);
  if (!Number.isFinite(numero)) return porDefecto;
  return texto.endsWith('ms') ? numero / 1000 : numero;
}

const esVidrio = (elemento: Element) => (elemento as HTMLElement).dataset.entra === 'vidrio';

function recorte(elemento: Element, inicio: boolean, fraccion = RECORTE_INICIAL): string {
  const el = elemento as HTMLElement;
  const radio = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  if (!inicio) return `inset(${-DESBORDE_FINAL}px ${-DESBORDE_FINAL}px round ${radio + DESBORDE_FINAL}px)`;
  return `inset(${el.offsetHeight * fraccion}px ${el.offsetWidth * fraccion}px round ${radio}px)`;
}

function recorteAlBorde(elemento: Element): string {
  const radio = Number.parseFloat(getComputedStyle(elemento as HTMLElement).borderTopLeftRadius) || 0;
  return `inset(0px 0px round ${radio}px)`;
}

/**
 * Entrada escalonada de los elementos marcados con `data-entra` dentro del contenedor.
 * `data-entra="vidrio"` se abre con recorte; el resto aparece subiendo.
 * Devuelve `null` si la persona pidió movimiento reducido o si no hay nada que animar.
 */
export function entradaEscalonada(contenedor: HTMLElement, selector = '[data-entra]'): gsap.core.Tween | null {
  if (movimientoReducido()) return null;
  const elementos = Array.from(contenedor.querySelectorAll<HTMLElement>(selector));
  if (elementos.length === 0) return null;
  return gsap.fromTo(
    elementos,
    {
      autoAlpha: (_i: number, el: Element) => (esVidrio(el) ? 1 : 0),
      y: (_i: number, el: Element) => (esVidrio(el) ? VIDRIO.y : PIEZA.y),
      scale: (_i: number, el: Element) => (esVidrio(el) ? VIDRIO.escala : 1),
      clipPath: (_i: number, el: Element) => (esVidrio(el) ? recorte(el, true) : 'none'),
    },
    {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      clipPath: (_i: number, el: Element) => (esVidrio(el) ? recorte(el, false) : 'none'),
      duration: segundos(contenedor, '--dur-entrada', 0.9),
      stagger: segundos(contenedor, '--escalonado', 0.06),
      // Para piezas que esperan a que se abra su panel (las tarjetas del tablero).
      delay: segundos(contenedor, '--retraso-entrada', 0),
      ease: 'expo.out',
      clearProps: 'opacity,visibility,transform,clipPath',
    },
  );
}

/**
 * Corre la entrada escalonada al montar (y cuando cambian `dependencias`, de largo fijo) en un
 * efecto de diseño, así el estado inicial se aplica antes del primer cuadro. Al limpiar revierte
 * la animación: los elementos quedan en su estado final visible, nunca a medio camino.
 */
export function useEntradaEscalonada(
  ref: RefObject<HTMLElement | null>,
  dependencias: unknown[] = [],
  selector = '[data-entra]',
): void {
  useLayoutEffect(() => {
    const contenedor = ref.current;
    if (!contenedor) return;
    const entrada = entradaEscalonada(contenedor, selector);
    return () => {
      entrada?.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, selector, ...dependencias]);
}

/**
 * Entrada del marco en la primera carga: `data-entra="lateral"` (vidrio desde la izquierda),
 * `data-entra="herramientas"` (vidrio desde arriba) y `data-entra="menu"` (ítems que aparecen).
 */
export function entradaMarco(contenedor: HTMLElement): gsap.core.Timeline | null {
  if (movimientoReducido()) return null;
  const buscar = (tipo: string) => Array.from(contenedor.querySelectorAll<HTMLElement>(`[data-entra="${tipo}"]`));
  const [lateral, herramientas, menu] = [buscar('lateral'), buscar('herramientas'), buscar('menu')];
  if (lateral.length + herramientas.length + menu.length === 0) return null;

  const duracion = segundos(contenedor, '--dur-entrada', 0.9);
  const linea = gsap.timeline();
  const abrir = (elementos: HTMLElement[], desde: gsap.TweenVars, fraccion: number, posicion: number) => {
    if (elementos.length === 0) return;
    linea.fromTo(
      elementos,
      { ...desde, clipPath: (_i: number, el: Element) => recorte(el, true, fraccion) },
      {
        x: 0,
        y: 0,
        scale: 1,
        clipPath: (_i: number, el: Element) => recorte(el, false),
        duration: duracion,
        ease: 'expo.out',
        clearProps: 'transform,clipPath',
      },
      posicion,
    );
  };
  abrir(lateral, { x: LATERAL.x, scale: LATERAL.escala }, LATERAL.recorte, 0);
  abrir(herramientas, { y: HERRAMIENTAS.y, scale: HERRAMIENTAS.escala }, HERRAMIENTAS.recorte, HERRAMIENTAS.retraso);
  if (menu.length > 0) {
    linea.fromTo(
      menu,
      { autoAlpha: 0, x: MENU.x },
      {
        autoAlpha: 1,
        x: 0,
        duration: segundos(contenedor, '--dur-pieza', 0.55),
        ease: 'power4.out',
        stagger: MENU.escalonado,
        clearProps: 'opacity,visibility,transform',
      },
      MENU.retraso,
    );
  }
  return linea;
}

/** Título letra por letra: anima los `[data-letra]` del contenedor. */
export function entradaTitulo(contenedor: HTMLElement): gsap.core.Tween | null {
  if (movimientoReducido()) return null;
  const letras = Array.from(contenedor.querySelectorAll<HTMLElement>('[data-letra]'));
  if (letras.length === 0) return null;
  return gsap.fromTo(
    letras,
    { yPercent: LETRA.desde, rotation: LETRA.giro },
    { yPercent: 0, rotation: 0, duration: LETRA.duracion, ease: 'power4.out', stagger: LETRA.escalonado, clearProps: 'transform' },
  );
}

/**
 * Salida de una vista: los vidrios se achican hasta su borde y suben; al terminar llama a `alTerminar`.
 * Devuelve `null` (sin llamar a nada) con movimiento reducido o si no hay vidrios.
 */
export function salidaVista(contenedor: HTMLElement, alTerminar: () => void): gsap.core.Tween | null {
  if (movimientoReducido()) return null;
  const vidrios = Array.from(contenedor.querySelectorAll<HTMLElement>('[data-entra="vidrio"]'));
  if (vidrios.length === 0) return null;
  return gsap.fromTo(
    vidrios,
    { clipPath: (_i: number, el: Element) => recorte(el, false) },
    {
      y: SALIDA.y,
      scale: SALIDA.escala,
      clipPath: (_i: number, el: Element) => recorteAlBorde(el),
      duration: SALIDA.duracion,
      ease: 'power2.in',
      onComplete: alTerminar,
    },
  );
}

// Corre una animación en un efecto de diseño y la revierte al limpiar, como useEntradaEscalonada.
function useAnimacion(
  ref: RefObject<HTMLElement | null>,
  crear: (contenedor: HTMLElement) => gsap.core.Animation | null,
  dependencias: unknown[],
): void {
  useLayoutEffect(() => {
    const contenedor = ref.current;
    if (!contenedor) return;
    const animacion = crear(contenedor);
    return () => {
      animacion?.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...dependencias]);
}

// Cajón de detalle: entra desde la derecha y aparece, con la curva de las piezas.
const CAJON = { x: 28 };

export function entradaCajon(cajon: HTMLElement): gsap.core.Tween | null {
  if (movimientoReducido()) return null;
  // Solo opacidad (no visibility): el foco tiene que poder entrar al cajón desde el primer cuadro.
  return gsap.fromTo(
    cajon,
    { x: CAJON.x, opacity: 0 },
    { x: 0, opacity: 1, duration: segundos(cajon, '--dur-pieza', 0.55), ease: 'power4.out', clearProps: 'opacity,transform' },
  );
}

/** Entrada del cajón de detalle al montar. */
export function useEntradaCajon(ref: RefObject<HTMLElement | null>): void {
  useAnimacion(ref, entradaCajon, []);
}

/** Entrada del marco (barra lateral, herramientas y menú) al montar. */
export function useEntradaMarco(ref: RefObject<HTMLElement | null>): void {
  useAnimacion(ref, entradaMarco, []);
}

/** Entrada del título letra por letra al montar y cuando cambian `dependencias`. */
export function useEntradaTitulo(ref: RefObject<HTMLElement | null>, dependencias: unknown[] = []): void {
  useAnimacion(ref, entradaTitulo, dependencias);
}
