import { describe, expect, it } from 'vitest';
import { tiempoRelativo } from './tiempo.js';

const AHORA = new Date('2026-10-19T12:00:00Z');
const antes = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();

describe('tiempoRelativo', () => {
  it('dice «ahora» bajo un minuto y la fecha corta pasados 14 días', () => {
    expect(tiempoRelativo(antes(20_000), AHORA)).toBe('ahora');
    expect(tiempoRelativo(antes(5 * 60_000), AHORA)).toBe('hace 5 minutos');
    expect(tiempoRelativo(antes(3 * 3_600_000), AHORA)).toBe('hace 3 horas');
    expect(tiempoRelativo(antes(26 * 3_600_000), AHORA)).toBe('ayer');
    expect(tiempoRelativo(antes(4 * 86_400_000), AHORA)).toBe('hace 4 días');
    expect(tiempoRelativo(antes(13 * 86_400_000), AHORA)).toBe('hace 13 días');
    expect(tiempoRelativo('2026-09-04T15:00:00Z', AHORA)).toBe('4 sept');
  });

  it('devuelve vacío si no es una fecha', () => {
    expect(tiempoRelativo('no es fecha', AHORA)).toBe('');
  });
});
