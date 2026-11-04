import { describe, expect, it } from 'vitest';
import { anteriorHabil, calendarioDe, habilesEntre, restarHabiles, siguienteHabil, sumarHabiles } from './calendarioOp.js';

const cal = calendarioDe({ semanaNoLaborable: [0, 6], diasNoLaborables: ['2026-11-23'] });

describe('calendario de OpenProject', () => {
  it('salta fines de semana y feriados de OpenProject', () => {
    expect(siguienteHabil('2026-11-20', cal)).toBe('2026-11-24');
    expect(sumarHabiles('2026-11-19', 2, cal)).toBe('2026-11-24');
    expect(sumarHabiles('2026-11-21', 0, cal)).toBe('2026-11-24');
    expect(sumarHabiles('2026-11-19', 0, cal)).toBe('2026-11-19');
  });
  it('resta hábiles hacia atrás, saltando fines de semana y feriados', () => {
    expect(anteriorHabil('2026-11-24', cal)).toBe('2026-11-20');
    expect(restarHabiles('2026-11-24', 2, cal)).toBe('2026-11-19');
    expect(restarHabiles('2026-11-22', 0, cal)).toBe('2026-11-20');
    expect(restarHabiles('2026-11-19', 0, cal)).toBe('2026-11-19');
    expect(() => anteriorHabil('2026-11-20', calendarioDe({ semanaNoLaborable: [0, 1, 2, 3, 4, 5, 6], diasNoLaborables: [] }))).toThrow(/ningún día hábil/);
  });
  it('cuenta hábiles con ambos bordes', () => {
    expect(habilesEntre('2026-11-20', '2026-11-24', cal)).toBe(2);
    expect(habilesEntre('2026-11-24', '2026-11-20', cal)).toBe(0);
  });
  it('un feriado que OpenProject no tiene sigue siendo hábil', () => {
    expect(cal.esHabil('2026-11-09')).toBe(true);
    expect(cal.esHabil('2026-11-23')).toBe(false);
  });
  it('con los siete días no laborables falla con un error claro en lugar de colgarse', () => {
    const sinHabiles = calendarioDe({ semanaNoLaborable: [0, 1, 2, 3, 4, 5, 6], diasNoLaborables: [] });
    expect(() => siguienteHabil('2026-11-20', sinHabiles)).toThrow(/ningún día hábil/);
    expect(() => sumarHabiles('2026-11-20', 3, sinHabiles)).toThrow(/ningún día hábil/);
  });
});
