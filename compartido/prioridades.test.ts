import { describe, expect, it } from 'vitest';
import { etiquetaPrioridad, nivelDePrioridad, NOMBRE_NIVEL } from './prioridades.js';

describe('prioridades', () => {
  it.each([
    ['Low', 'baja'], ['baja', 'baja'], ['Normal', 'normal'], ['High', 'alta'], ['  ALTA ', 'alta'],
    ['Immediate', 'inmediata'], ['Urgent', 'inmediata'], ['inmediata', 'inmediata'], ['Urgente', 'inmediata'],
  ])('nivelDePrioridad reconoce los nombres en inglés y en castellano: %s → %s', (nombre, nivel) => {
    expect(nivelDePrioridad(nombre)).toBe(nivel);
  });

  it('un nombre desconocido no tiene nivel', () => {
    expect(nivelDePrioridad('Crítica')).toBeNull();
    expect(nivelDePrioridad('')).toBeNull();
  });

  it('la inmediata se muestra como Urgente', () => {
    expect(NOMBRE_NIVEL.inmediata).toBe('Urgente');
  });

  it('una prioridad desconocida se muestra con su nombre de OpenProject', () => {
    expect(etiquetaPrioridad({ id: 1, nombre: 'Crítica', alta: false, nivel: null })).toBe('Crítica');
    expect(etiquetaPrioridad({ id: 2, nombre: 'Immediate', alta: true, nivel: 'inmediata' })).toBe('Urgente');
  });
});
