import { describe, expect, it } from 'vitest';
import type { Reunion } from '../../compartido/tipos.js';
import { enReunion, horasReunionPorSemana } from './horas.js';

// Lunes 2026-10-19; Argentina es UTC-3.
const LUNES = '2026-10-19';
const r = (inicio: string, fin: string, extra: Partial<Reunion> = {}): Reunion => ({
  id: `${inicio}-${fin}`, titulo: 'Daily', lugar: null, inicio: `${inicio}-03:00`, fin: `${fin}-03:00`,
  diaEntero: false, libre: false, enlace: null, plataforma: null, ...extra,
});
const NINGUNO: ReadonlySet<string> = new Set();

describe('horasReunionPorSemana', () => {
  it('suma una vez los tramos que se pisan', () => {
    const lista = [r('2026-10-19T09:00:00', '2026-10-19T11:00:00'), r('2026-10-19T10:00:00', '2026-10-19T12:00:00')];
    expect(horasReunionPorSemana(lista, LUNES, 1, 8, NINGUNO)).toEqual({ [LUNES]: 3 });
  });

  it('no pasa del valor del día', () => {
    const lista = [r('2026-10-19T08:00:00', '2026-10-19T18:00:00')];
    expect(horasReunionPorSemana(lista, LUNES, 1, 8, NINGUNO)).toEqual({ [LUNES]: 8 });
  });

  it('solo cuenta la parte del día hábil', () => {
    const guardia = r('2026-10-23T22:00:00', '2026-10-24T02:00:00');   // viernes 22:00 a sábado 02:00
    expect(horasReunionPorSemana([guardia], LUNES, 1, 8, NINGUNO)).toEqual({ [LUNES]: 2 });
  });

  it('una reunión que viene del domingo suma solo el lunes', () => {
    const lista = [r('2026-10-18T23:00:00', '2026-10-19T01:00:00')];
    expect(horasReunionPorSemana(lista, LUNES, 1, 8, NINGUNO)).toEqual({ [LUNES]: 1 });
  });

  it('los días libres no restan', () => {
    const lista = [r('2026-10-19T09:00:00', '2026-10-19T11:00:00'), r('2026-10-20T09:00:00', '2026-10-20T10:00:00')];
    expect(horasReunionPorSemana(lista, LUNES, 1, 8, new Set(['2026-10-19']))).toEqual({ [LUNES]: 1 });
  });

  it('deja afuera las libres y las de día entero', () => {
    const lista = [
      r('2026-10-19T09:00:00', '2026-10-19T11:00:00', { libre: true }),
      r('2026-10-19T00:00:00', '2026-10-20T00:00:00', { diaEntero: true }),
    ];
    expect(horasReunionPorSemana(lista, LUNES, 1, 8, NINGUNO)).toEqual({ [LUNES]: 0 });
  });

  it('el tope es por día, no por semana', () => {
    const lista = [r('2026-10-19T08:00:00', '2026-10-19T18:00:00'), r('2026-10-20T09:00:00', '2026-10-20T11:00:00')];
    expect(horasReunionPorSemana(lista, LUNES, 1, 8, NINGUNO)).toEqual({ [LUNES]: 10 });
  });

  it('devuelve una clave por semana, aun en cero', () => {
    const lista = [r('2026-10-27T09:00:00', '2026-10-27T10:30:00')];
    expect(horasReunionPorSemana(lista, LUNES, 3, 8, NINGUNO)).toEqual({ '2026-10-19': 0, '2026-10-26': 1.5, '2026-11-02': 0 });
  });
});

describe('enReunion', () => {
  const lista = [r('2026-10-19T09:00:00', '2026-10-19T10:00:00')];
  it('es verdadero solo entre el inicio y el fin', () => {
    expect(enReunion(lista, new Date('2026-10-19T08:59:59-03:00'))).toBe(false);
    expect(enReunion(lista, new Date('2026-10-19T09:00:00-03:00'))).toBe(true);
    expect(enReunion(lista, new Date('2026-10-19T09:59:59-03:00'))).toBe(true);
    expect(enReunion(lista, new Date('2026-10-19T10:00:00-03:00'))).toBe(false);
  });
  it('ignora las libres y las de día entero', () => {
    const ahora = new Date('2026-10-19T09:30:00-03:00');
    expect(enReunion([r('2026-10-19T09:00:00', '2026-10-19T10:00:00', { libre: true })], ahora)).toBe(false);
    expect(enReunion([r('2026-10-19T00:00:00', '2026-10-20T00:00:00', { diaEntero: true })], ahora)).toBe(false);
  });
});
