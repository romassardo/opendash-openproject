import { describe, expect, it } from 'vitest';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import { aplicarOrden, bajarDetras, moverEnLista, ordenInicial } from './ordenLista.js';

const t = (id: number, inicio: string | null): Tarea => ({ id, titulo: `T${id}`, inicio, fin: inicio, madreId: null } as Tarea);
const dep = (predecesoraId: number, sucesoraId: number): Dependencia => ({ id: predecesoraId * 100 + sucesoraId, predecesoraId, sucesoraId, lag: 0 });
const ids = (l: Tarea[]) => l.map((x) => x.id);

const A = t(1, '2026-10-20'), B = t(2, '2026-10-23'), C = t(3, '2026-10-21'), D = t(4, '2026-10-19');

describe('ordenInicial', () => {
  it('deja junta la cadena y ordena grupos y sueltas por su inicio más temprano', () => {
    expect(ids(ordenInicial([B, C, A, D], [dep(1, 2)]))).toEqual([4, 1, 2, 3]);
  });
  it('con el mismo inicio desempata por id, venga la lista como venga', () => {
    const p = t(7, '2026-10-20'), q = t(5, '2026-10-20'), r = t(6, '2026-10-20');
    expect(ids(ordenInicial([p, q, r], []))).toEqual([5, 6, 7]);
    expect(ids(ordenInicial([r, p, q], []))).toEqual([5, 6, 7]);
  });
  it('ordena la cadena en orden de espera aunque la sucesora empiece antes', () => {
    const x = t(10, '2026-10-25'), y = t(11, '2026-10-20');
    expect(ids(ordenInicial([y, x], [dep(10, 11)]))).toEqual([10, 11]);
  });
  it('ignora dependencias con tareas que no están en la lista y no se cuelga con un ciclo', () => {
    expect(ids(ordenInicial([A, C], [dep(1, 99)]))).toEqual([1, 3]);
    expect(ordenInicial([A, B], [dep(1, 2), dep(2, 1)])).toHaveLength(2);
  });
});

describe('aplicarOrden', () => {
  it('sin guardado es el orden inicial', () => {
    expect(ids(aplicarOrden([B, A], undefined, []))).toEqual([1, 2]);
  });
  it('mantiene lo guardado y ubica las nuevas por fecha', () => {
    expect(ids(aplicarOrden([A, B, C], [3, 1], []))).toEqual([3, 1, 2]);
    const E = t(5, '2026-10-20');
    expect(ids(aplicarOrden([A, C, E], [1, 3], []))).toEqual([1, 5, 3]);
    const F = t(6, '2026-10-19');
    expect(ids(aplicarOrden([A, C, F], [3, 1], []))).toEqual([6, 3, 1]);
  });
  it('ignora ids guardados que ya no están', () => {
    expect(ids(aplicarOrden([A, C], [99, 3, 1, 3], []))).toEqual([3, 1]);
  });
  it('una cerrada guardada ocupa su lugar', () => {
    const cerrada = { ...D, cerradaEl: '2026-10-22T10:00:00Z' } as Tarea;
    expect(ids(aplicarOrden([A, cerrada], [1, 4], []))).toEqual([1, 4]);
  });
});

describe('moverEnLista y bajarDetras', () => {
  it('mueve', () => {
    expect(moverEnLista([1, 2, 3, 4], 1, 2)).toEqual([2, 3, 1, 4]);
    expect(moverEnLista([1, 2], 9, 0)).toEqual([1, 2]);
    expect(moverEnLista([1, 2, 3], 1, 99)).toEqual([2, 3, 1]);
  });
  it('baja detrás', () => {
    expect(bajarDetras([3, 1, 2], 1, 3)).toEqual([1, 3, 2]);
    expect(bajarDetras([1, 3], 1, 3)).toBeNull();
    expect(bajarDetras([1, 3], 1, 9)).toBeNull();
    expect(bajarDetras([1, 3], 9, 3)).toBeNull();
  });
});
