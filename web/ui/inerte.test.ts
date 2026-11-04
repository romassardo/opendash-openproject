import { afterEach, describe, expect, it } from 'vitest';
import { bloquearFondo } from './inerte.js';

afterEach(() => {
  document.body.replaceChildren();
});

function armar() {
  document.body.innerHTML = '<div id="raiz"><main id="app"></main><div id="a"></div></div><div id="b"></div><div id="c"></div>';
  const q = (id: string) => document.getElementById(id) as HTMLElement;
  return { raiz: q('raiz'), app: q('app'), a: q('a'), b: q('b'), c: q('c') };
}

describe('bloquearFondo', () => {
  it('vuelve inertes los hermanos de cada ancestro y deja a salvo al elemento y a lo que lo contiene', () => {
    const { raiz, app, a, b, c } = armar();
    const liberar = bloquearFondo(a);
    expect(app).toHaveAttribute('inert');
    expect(b).toHaveAttribute('inert');
    expect(c).toHaveAttribute('inert');
    expect(raiz).not.toHaveAttribute('inert');
    expect(a).not.toHaveAttribute('inert');
    liberar();
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });

  it('con dos bloqueos anidados, liberar el interno no reactiva el fondo', () => {
    const { app, a, b } = armar();
    const liberarA = bloquearFondo(a);
    const liberarB = bloquearFondo(b);
    // b queda inerte por el bloqueo de a; app por los dos
    expect(b).toHaveAttribute('inert');
    liberarB();
    expect(app).toHaveAttribute('inert');
    expect(b).toHaveAttribute('inert');
    liberarA();
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });

  it('lo que ya era inerte antes del primer bloqueo sigue inerte al liberar', () => {
    const { app, a, b, c } = armar();
    b.setAttribute('inert', '');
    const liberarA = bloquearFondo(a);
    const liberarC = bloquearFondo(c);
    liberarA();
    liberarC();
    expect(b).toHaveAttribute('inert');
    expect(app).not.toHaveAttribute('inert');
    expect(c).not.toHaveAttribute('inert');
    // Un bloqueo nuevo vuelve a mirar cómo estaba cada elemento.
    b.removeAttribute('inert');
    bloquearFondo(a)();
    expect(b).not.toHaveAttribute('inert');
  });

  it('se puede liberar en cualquier orden y liberar dos veces no resta de más', () => {
    const { app, a, b } = armar();
    const liberarA = bloquearFondo(a);
    const liberarB = bloquearFondo(b);
    liberarA();
    liberarA();
    expect(app).not.toHaveAttribute('inert');
    expect(document.getElementById('raiz')).toHaveAttribute('inert');
    expect(document.getElementById('c')).toHaveAttribute('inert');
    liberarB();
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });
});
