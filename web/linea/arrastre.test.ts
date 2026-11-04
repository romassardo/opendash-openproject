import { describe, expect, it } from 'vitest';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { deltaDiasDe, fechasTrasGesto } from './arrastre.js';

describe('fechasTrasGesto', () => {
  const tarea = tareaDe(1, { inicio: '2026-10-20', fin: '2026-10-23' });

  it('mover corre inicio y fin los mismos días', () => {
    expect(fechasTrasGesto(tarea, 'mover', 3)).toEqual({ inicio: '2026-10-23', fin: '2026-10-26' });
    expect(fechasTrasGesto(tarea, 'mover', -2)).toEqual({ inicio: '2026-10-18', fin: '2026-10-21' });
  });

  it('estirar el fin no deja la tarea en menos de un día', () => {
    expect(fechasTrasGesto(tarea, 'fin', 2)).toEqual({ inicio: '2026-10-20', fin: '2026-10-25' });
    expect(fechasTrasGesto(tarea, 'fin', -10)).toEqual({ inicio: '2026-10-20', fin: '2026-10-20' });
  });

  it('estirar el inicio tampoco pasa del fin', () => {
    expect(fechasTrasGesto(tarea, 'inicio', -2)).toEqual({ inicio: '2026-10-18', fin: '2026-10-23' });
    expect(fechasTrasGesto(tarea, 'inicio', 10)).toEqual({ inicio: '2026-10-23', fin: '2026-10-23' });
  });

  it('un hito solo se mueve', () => {
    const hito = tareaDe(2, { inicio: '2026-11-12', fin: '2026-11-12' });
    expect(fechasTrasGesto(hito, 'mover', 2, true)).toEqual({ inicio: '2026-11-14', fin: '2026-11-14' });
    expect(fechasTrasGesto(hito, 'fin', 2, true)).toEqual({ inicio: '2026-11-12', fin: '2026-11-12' });
    expect(fechasTrasGesto(hito, 'inicio', -2, true)).toEqual({ inicio: '2026-11-12', fin: '2026-11-12' });
  });

  it('con una sola fecha, mover corre esa y estirar completa la que falta', () => {
    const soloFin = tareaDe(3, { inicio: null, fin: '2026-10-22' });
    expect(fechasTrasGesto(soloFin, 'mover', 2)).toEqual({ inicio: null, fin: '2026-10-24' });
    expect(fechasTrasGesto(soloFin, 'inicio', -3)).toEqual({ inicio: '2026-10-19', fin: '2026-10-22' });
    const soloInicio = tareaDe(4, { inicio: '2026-10-22', fin: null });
    expect(fechasTrasGesto(soloInicio, 'mover', -1)).toEqual({ inicio: '2026-10-21', fin: null });
    expect(fechasTrasGesto(soloInicio, 'fin', 4)).toEqual({ inicio: '2026-10-22', fin: '2026-10-26' });
  });

  it('si el gesto no cambia nada, devuelve las fechas como estaban', () => {
    const soloInicio = tareaDe(4, { inicio: '2026-10-22', fin: null });
    expect(fechasTrasGesto(soloInicio, 'fin', -3)).toEqual({ inicio: '2026-10-22', fin: null });
    expect(fechasTrasGesto(tarea, 'mover', 0)).toEqual({ inicio: '2026-10-20', fin: '2026-10-23' });
  });

  it('sin fechas no hace nada', () => {
    expect(fechasTrasGesto(tareaDe(5, { inicio: null, fin: null }), 'mover', 3)).toEqual({ inicio: null, fin: null });
  });
});

describe('deltaDiasDe', () => {
  it('redondea al día más cercano', () => {
    expect(deltaDiasDe(47, 16)).toBe(3);
    expect(deltaDiasDe(39, 16)).toBe(2);
    expect(deltaDiasDe(-25, 16)).toBe(-2);
    expect(deltaDiasDe(3, 16)).toBe(0);
    expect(Object.is(deltaDiasDe(-3, 16), 0)).toBe(true);
  });
});
