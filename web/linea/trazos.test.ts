import { describe, expect, it } from 'vitest';
import { puntoMedio, trazoLibre, trazoUnion } from './trazos.js';

/** Todos los puntos «x,y» del path, en orden. */
const puntosDe = (d: string): { x: number; y: number }[] =>
  [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

describe('trazos', () => {
  it('con hueco amplio la unión es una curva cúbica', () => {
    expect(trazoUnion({ x: 100, y: 17 }, { x: 160, y: 51 }, 34)).toContain('C');
  });

  it('con hueco medio es un codo con esquinas redondeadas y sin curvas cúbicas', () => {
    const d = trazoUnion({ x: 100, y: 17 }, { x: 125, y: 51 }, 34);
    expect(d).toContain('Q');
    expect(d).not.toContain('C');
  });

  it('con hueco mínimo es un escalón que pasa por el borde entre renglones', () => {
    const d = trazoUnion({ x: 100, y: 17 }, { x: 104, y: 51 }, 34);
    expect(d).toContain('Q');
    const entra = { x: 104, y: 51 };
    const puntos = puntosDe(d);
    // La esquina del escalón: sobre el borde entre renglones (y = entra.y - 17) y a entra.x - 12.
    expect(puntos).toContainEqual({ x: entra.x - 12, y: entra.y - 17 });
    expect(puntos.at(-1)).toEqual(entra);
  });

  it('con la sucesora arriba el escalón pasa por entra.y + 17', () => {
    const entra = { x: 104, y: 17 };
    const puntos = puntosDe(trazoUnion({ x: 100, y: 51 }, entra, 34));
    expect(puntos).toContainEqual({ x: entra.x - 12, y: entra.y + 17 });
    expect(puntos.at(-1)).toEqual(entra);
  });

  it('trazoLibre y puntoMedio', () => {
    expect(trazoLibre({ x: 0, y: 0 }, { x: 100, y: 34 })).toMatch(/^M0,0 C/);
    expect(puntoMedio({ x: 0, y: 0 }, { x: 100, y: 34 })).toEqual({ x: 50, y: 17 });
  });
});
