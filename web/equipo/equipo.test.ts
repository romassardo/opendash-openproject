import { describe, expect, it } from 'vitest';
import { finDeVacaciones } from './equipo.js';

describe('finDeVacaciones', () => {
  it('encadena las vacaciones que empiezan al día siguiente', () => {
    const v = [{ desde: '2026-10-01', hasta: '2026-10-10' }, { desde: '2026-10-11', hasta: '2026-10-20' }];
    expect(finDeVacaciones(v, '2026-10-05')).toBe('2026-10-20');
  });

  it('encadena las que solo tienen sábado y domingo en el medio', () => {
    const v = [{ desde: '2026-11-02', hasta: '2026-11-06' }, { desde: '2026-11-09', hasta: '2026-11-13' }];
    expect(finDeVacaciones(v, '2026-11-03')).toBe('2026-11-13');
  });

  it('no encadena si hay días hábiles en el medio', () => {
    const v = [{ desde: '2026-10-01', hasta: '2026-10-10' }, { desde: '2026-10-13', hasta: '2026-10-20' }];
    expect(finDeVacaciones(v, '2026-10-05')).toBe('2026-10-10');
  });

  it('devuelve null si hoy no está de vacaciones', () => {
    const v = [{ desde: '2026-10-01', hasta: '2026-10-10' }];
    expect(finDeVacaciones(v, '2026-10-11')).toBeNull();
    expect(finDeVacaciones([], '2026-10-05')).toBeNull();
  });

  it('acepta las vacaciones desordenadas', () => {
    const v = [{ desde: '2026-10-11', hasta: '2026-10-20' }, { desde: '2026-10-01', hasta: '2026-10-10' }];
    expect(finDeVacaciones(v, '2026-10-05')).toBe('2026-10-20');
  });
});
