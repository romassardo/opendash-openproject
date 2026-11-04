import { describe, expect, it } from 'vitest';
import { presenciaDe, VENTANA_CONECTADO_MS } from './presencia.js';

const AHORA = new Date('2026-10-19T12:00:00.000Z');
const hace = (min: number): string => new Date(AHORA.getTime() - min * 60_000).toISOString();

describe('presenciaDe', () => {
  it('la ventana de conectado es de dos minutos', () => {
    expect(VENTANA_CONECTADO_MS).toBe(120_000);
  });
  it('conectado con actividad de hace 1 minuto, ausente con 3 y trabajando con un tramo en marcha', () => {
    expect(presenciaDe(hace(1), false, AHORA)).toBe('conectado');
    expect(presenciaDe(hace(3), false, AHORA)).toBe('ausente');
    expect(presenciaDe(hace(3), true, AHORA)).toBe('trabajando');
  });
  it('sin actividad registrada está ausente', () => {
    expect(presenciaDe(null, false, AHORA)).toBe('ausente');
  });
  it('justo en el límite de la ventana ya está ausente', () => {
    expect(presenciaDe(hace(2), false, AHORA)).toBe('ausente');
  });
  it('trabajando gana sobre vacaciones y reunión, vacaciones a reunión y reunión a conectado', () => {
    const todo = { enReunion: true, deVacaciones: true };
    expect(presenciaDe(hace(1), true, AHORA, todo)).toBe('trabajando');
    // Una Daily que no se canceló no tapa las vacaciones (decisión de Ramiro, 2026-10-22).
    expect(presenciaDe(hace(1), false, AHORA, todo)).toBe('vacaciones');
    expect(presenciaDe(hace(1), false, AHORA, { enReunion: true, deVacaciones: false })).toBe('reunion');
    expect(presenciaDe(hace(1), false, AHORA, { enReunion: false, deVacaciones: false })).toBe('conectado');
    expect(presenciaDe(hace(5), false, AHORA, { enReunion: false, deVacaciones: true })).toBe('vacaciones');
  });
});
