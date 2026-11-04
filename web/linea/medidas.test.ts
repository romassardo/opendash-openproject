import { describe, expect, it } from 'vitest';
import { escalonadoDe } from './medidas.js';

describe('escalonadoDe', () => {
  it('con pocas barras conserva los 0,05 s de siempre', () => {
    expect(escalonadoDe(3)).toBe(0.05);
    expect(escalonadoDe(12)).toBeCloseTo(0.05);
  });

  it('con muchas barras el escalonado total no pasa de 0,6 s', () => {
    for (const n of [13, 36, 70, 400]) expect(escalonadoDe(n) * n).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(escalonadoDe(70)).toBeCloseTo(0.6 / 70);
  });

  it('sin barras no divide por cero', () => {
    expect(Number.isFinite(escalonadoDe(0))).toBe(true);
  });
});
