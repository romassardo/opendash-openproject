import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { gsap } from 'gsap';
import { useEntradaEscalonada } from './entradas.js';

const matchMediaOriginal = window.matchMedia;
const movimiento = (reducido: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reducido }) as unknown as typeof window.matchMedia;
};

function Pantalla({ clave = 0 }: { clave?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(ref, [clave]);
  return (
    <div ref={ref}>
      <section data-entra="vidrio" data-testid="vidrio">Panel</section>
      <p data-entra="pieza" data-testid="pieza">Pieza</p>
    </div>
  );
}

const elementos = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-entra]')];
const limpio = (el: HTMLElement) => {
  expect(el.style.opacity).toBe('');
  expect(el.style.visibility).toBe('');
  expect(el.style.clipPath).toBe('');
  expect(el.style.transform).toBe('');
};

describe('useEntradaEscalonada', () => {
  afterEach(() => {
    cleanup();
    window.matchMedia = matchMediaOriginal;
  });

  it('aplica el estado inicial antes de pintar (efecto de diseño)', () => {
    movimiento(false);
    const { container } = render(<Pantalla />);
    const [, pieza] = elementos(container);
    expect(pieza!.style.opacity).toBe('0');
  });

  it('al desmontar a mitad de la animación deja todo visible y sin recorte', () => {
    movimiento(false);
    const { container, unmount } = render(<Pantalla />);
    const els = elementos(container);
    expect(els[1]!.style.opacity).toBe('0');
    unmount();
    els.forEach(limpio);
  });

  it('al re-ejecutarse a mitad de la animación no deja nada a medio camino', () => {
    movimiento(false);
    const { container, rerender } = render(<Pantalla clave={1} />);
    const els = elementos(container);
    movimiento(true);
    rerender(<Pantalla clave={2} />);
    els.forEach(limpio);
  });

  it('con StrictMode queda una sola animación y al terminar todo está visible', () => {
    movimiento(false);
    const { container } = render(<StrictMode><Pantalla /></StrictMode>);
    const els = elementos(container);
    const tweens = gsap.getTweensOf(els);
    expect(tweens).toHaveLength(1);
    tweens[0]!.progress(1);
    els.forEach(limpio);
  });

  it('con movimiento reducido no anima ni deja estilos en línea', () => {
    movimiento(true);
    const { container } = render(<Pantalla />);
    const els = elementos(container);
    expect(gsap.getTweensOf(els)).toHaveLength(0);
    els.forEach((el) => expect(el.getAttribute('style')).toBeNull());
  });
});
