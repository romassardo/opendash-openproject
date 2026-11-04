import { afterEach, describe, expect, it, vi } from 'vitest';
import { entradaEscalonada, entradaMarco, entradaTitulo, salidaVista } from './entradas.js';

const matchMediaOriginal = window.matchMedia;

function contenedorCon(...tipos: string[]): HTMLElement {
  const div = document.createElement('div');
  for (const tipo of tipos) {
    const hijo = document.createElement('div');
    hijo.dataset.entra = tipo;
    div.append(hijo);
  }
  document.body.append(div);
  return div;
}

describe('entradaEscalonada', () => {
  afterEach(() => {
    window.matchMedia = matchMediaOriginal;
    document.body.innerHTML = '';
  });

  it('sin animación si el usuario pide movimiento reducido', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as any;
    expect(entradaEscalonada(document.createElement('div'))).toBeNull();
  });

  it('anima en orden los elementos marcados del contenedor', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    const contenedor = contenedorCon('vidrio', 'pieza', 'pieza');
    const tween = entradaEscalonada(contenedor);
    expect(tween).not.toBeNull();
    expect(tween!.targets()).toHaveLength(3);
    tween!.kill();
  });

  it('acepta otro selector y no hace nada si no hay elementos', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    const contenedor = contenedorCon('pieza');
    expect(entradaEscalonada(contenedor, '.no-existe')).toBeNull();
  });

  it('las piezas arrancan invisibles y el vidrio recortado, sin fundido', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    const contenedor = contenedorCon('vidrio', 'pieza');
    const tween = entradaEscalonada(contenedor)!;
    tween.pause(0);
    const [vidrio, pieza] = [...contenedor.children] as HTMLElement[];
    expect(pieza!.style.opacity).toBe('0');
    expect(vidrio!.style.opacity).not.toBe('0');
    expect(vidrio!.style.clipPath).toContain('inset(');
    tween.kill();
  });

  it('espera el retraso del token --retraso-entrada del contenedor (sin token, ninguno)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    const sinRetraso = entradaEscalonada(contenedorCon('pieza'))!;
    expect(sinRetraso.delay()).toBe(0);
    sinRetraso.kill();
    const contenedor = contenedorCon('pieza');
    contenedor.style.setProperty('--retraso-entrada', '0.3s');
    const tween = entradaEscalonada(contenedor)!;
    expect(tween.delay()).toBeCloseTo(0.3);
    expect((contenedor.firstElementChild as HTMLElement).style.opacity).toBe('0');
    tween.kill();
  });
});

describe('entradas del marco y del título, y salida de la vista', () => {
  afterEach(() => {
    window.matchMedia = matchMediaOriginal;
    document.body.innerHTML = '';
  });

  it('nada se anima con movimiento reducido', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as any;
    const contenedor = contenedorCon('lateral', 'menu', 'vidrio');
    const alTerminar = vi.fn();
    expect(entradaMarco(contenedor)).toBeNull();
    expect(entradaTitulo(contenedor)).toBeNull();
    expect(salidaVista(contenedor, alTerminar)).toBeNull();
    expect(alTerminar).not.toHaveBeenCalled();
  });

  it('el marco arranca con la barra recortada y los ítems del menú invisibles, y al revertir queda limpio', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    const contenedor = contenedorCon('lateral', 'herramientas', 'menu', 'menu');
    const [lateral, herramientas, menu] = [...contenedor.children] as HTMLElement[];
    const linea = entradaMarco(contenedor)!;
    expect(lateral!.style.clipPath).toContain('inset(');
    expect(lateral!.style.transform).toContain('translate');
    expect(herramientas!.style.clipPath).toContain('inset(');
    expect(menu!.style.opacity).toBe('0');
    linea.revert();
    for (const el of [lateral!, herramientas!, menu!]) {
      expect(el.style.opacity).toBe('');
      expect(el.style.clipPath).toBe('');
      expect(el.style.transform).toBe('');
    }
  });

  it('el título mueve cada letra y sin letras no hace nada', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    const titulo = document.createElement('h1');
    for (const letra of 'Hola') {
      const span = document.createElement('span');
      span.dataset.letra = '';
      span.textContent = letra;
      titulo.append(span);
    }
    document.body.append(titulo);
    const tween = entradaTitulo(titulo)!;
    expect(tween.targets()).toHaveLength(4);
    expect((titulo.firstElementChild as HTMLElement).style.transform).toContain('translate');
    tween.kill();
    expect(entradaTitulo(document.createElement('div'))).toBeNull();
  });

  it('la salida achica los vidrios y avisa al terminar', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    const contenedor = contenedorCon('vidrio', 'pieza');
    const alTerminar = vi.fn();
    const tween = salidaVista(contenedor, alTerminar)!;
    expect(tween.targets()).toHaveLength(1);
    tween.progress(1);
    expect(alTerminar).toHaveBeenCalledOnce();
    expect(salidaVista(contenedorCon('pieza'), alTerminar)).toBeNull();
  });
});
