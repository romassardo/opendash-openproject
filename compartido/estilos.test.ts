import { describe, expect, it } from 'vitest';
import { repartirTonos, TONOS, tonoPara, type Tono } from './estilos.js';

const IDS = [3, 9, 10, 11, 12, 13, 15, 16, 17, 20, 21, 22, 23];

describe('tonos de proyecto', () => {
  it('hay 13 tonos y los 7 de antes no cambian de lugar', () => {
    expect(TONOS.length).toBe(13);
    expect(TONOS.slice(0, 7)).toEqual(['azul', 'rosa', 'violeta', 'verde', 'naranja', 'turquesa', 'indigo']);
  });

  it('reparte sin repetir mientras alcanzan los colores', () => {
    const r = repartirTonos(IDS, new Map());
    expect(new Set(r.values()).size).toBe(13);
    expect(r.get(3)).toBe('azul');
    expect(r.get(9)).toBe('rosa');
    const invertida = repartirTonos([...IDS].reverse(), new Map());
    expect([...invertida.entries()].sort()).toEqual([...r.entries()].sort());
  });

  it('respeta lo elegido y no se lo da a otro', () => {
    const r = repartirTonos(IDS, new Map<number, Tono>([[10, 'azul']]));
    expect(r.get(10)).toBe('azul');
    expect([...r.entries()].filter(([id, t]) => t === 'azul' && id !== 10)).toEqual([]);
  });

  it('si se acaban los colores, repite con tonoPara', () => {
    const ids = [...IDS, 24];
    const r = repartirTonos(ids, new Map());
    expect(r.get(24)).toBe(tonoPara(24));
  });

  it('dos elegidos iguales se respetan', () => {
    const r = repartirTonos([10, 11], new Map<number, Tono>([[10, 'rosa'], [11, 'rosa']]));
    expect(r.get(10)).toBe('rosa');
    expect(r.get(11)).toBe('rosa');
  });
});
