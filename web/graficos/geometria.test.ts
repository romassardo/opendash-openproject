import { describe, expect, it } from 'vitest';
import { arco, barraRedondeada, caminoSuave, escalaLinda, indicesRotulos } from './geometria.js';

describe('arco', () => {
  it('de 0 a 90 grados parte arriba y termina a la derecha del centro', () => {
    const d = arco(50, 50, 40, 0, 90);
    expect(d.startsWith('M 50 10 ')).toBe(true);
    expect(d.endsWith('90 50')).toBe(true);
    expect(d).toContain('0 0 1'); // arco corto, sentido horario
  });

  it('de más de 180 grados usa el arco largo', () => {
    expect(arco(50, 50, 40, 0, 270)).toContain('A 40 40 0 1 1');
  });

  it('una vuelta completa se topa un pelo antes para no degenerar', () => {
    const d = arco(50, 50, 40, 0, 720);
    expect(d).not.toMatch(/50 10$/);
    expect(d).toContain('A 40 40 0 1 1');
  });
});

describe('caminoSuave', () => {
  const numeros = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // Los pares (x, y) siguen a la «M» y a cada «C»: las ordenadas son los valores impares.
  const ordenadas = (d: string) => numeros(d).filter((_, i) => i % 2 === 1);

  it('no baja de cero entre dos puntos en cero', () => {
    const puntos: [number, number][] = [[0, 0], [10, 6], [20, 0], [30, 0], [40, 5]];
    expect(Math.min(...ordenadas(caminoSuave(puntos)))).toBeGreaterThanOrEqual(0);
  });

  it('no pasa el máximo de los puntos vecinos', () => {
    const puntos: [number, number][] = [[0, 1], [10, 9], [20, 2]];
    expect(Math.max(...ordenadas(caminoSuave(puntos)))).toBeLessThanOrEqual(9);
  });

  it('con un solo punto, solo se posiciona; sin puntos, devuelve vacío', () => {
    expect(caminoSuave([[3, 4]])).toBe('M 3 4');
    expect(caminoSuave([])).toBe('');
  });

  it('con dos puntos traza una recta como cúbica', () => {
    expect(caminoSuave([[0, 0], [30, 0]]).startsWith('M 0 0 C')).toBe(true);
  });
});

describe('escalaLinda', () => {
  it('redondea 7 a 10 con marcas 0, 5 y 10', () => {
    expect(escalaLinda(7)).toEqual({ maximo: 10, marcas: [0, 5, 10] });
  });
  it('con máximo 0 devuelve 0 y 1', () => {
    expect(escalaLinda(0)).toEqual({ maximo: 1, marcas: [0, 1] });
  });
  it('redondea a 1, 2 o 5 por una potencia de diez', () => {
    expect(escalaLinda(11).maximo).toBe(20);
    expect(escalaLinda(21).maximo).toBe(50);
    expect(escalaLinda(0.3).maximo).toBe(0.5);
    expect(escalaLinda(100).maximo).toBe(100);
  });
  it('respeta la cantidad de tramos pedida', () => {
    expect(escalaLinda(40, 4)).toEqual({ maximo: 50, marcas: [0, 12.5, 25, 37.5, 50] });
  });
});

describe('indicesRotulos', () => {
  it('muestra todos si caben', () => {
    expect(indicesRotulos(4, 6)).toEqual([0, 1, 2, 3]);
  });
  it('espacia anclando en el último para que no se pisen', () => {
    expect(indicesRotulos(10, 4)).toEqual([0, 3, 6, 9]);
  });
  it('sin datos no hay rótulos', () => {
    expect(indicesRotulos(0, 5)).toEqual([]);
  });
});

describe('barraRedondeada', () => {
  it('redondea más arriba que abajo y no se pasa del ancho', () => {
    expect(barraRedondeada(0, 0, 10, 40)).toContain('A 5 5');
    expect(barraRedondeada(0, 0, 10, 0)).toBe('');
  });
});
