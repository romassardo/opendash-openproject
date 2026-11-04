import { describe, expect, it } from 'vitest';
import { fechasDeNueva } from './nuevaTarea.js';

const SEMANA = { semanaNoLaborable: [0, 6], diasNoLaborables: [] };
// Del lunes 19 de octubre al domingo 15 de noviembre de 2026.
const VENTANA = { desde: '2026-10-19', hasta: '2026-11-15' };

describe('fechasDeNueva', () => {
  it('un día hábil: empieza y vence hoy', () => {
    expect(fechasDeNueva('2026-10-28', VENTANA, SEMANA)).toEqual({ inicio: '2026-10-28', fin: '2026-10-28' });
  });

  it('un sábado queda en el lunes', () => {
    expect(fechasDeNueva('2026-10-24', VENTANA, SEMANA)).toEqual({ inicio: '2026-10-26', fin: '2026-10-26' });
  });

  it('saltea los días no laborables de OpenProject', () => {
    const conFeriado = { ...SEMANA, diasNoLaborables: ['2026-10-26'] };
    expect(fechasDeNueva('2026-10-26', VENTANA, conFeriado)).toEqual({ inicio: '2026-10-27', fin: '2026-10-27' });
  });

  it('con hoy fuera de la ventana queda al comienzo de la ventana', () => {
    expect(fechasDeNueva('2026-10-26', { desde: '2026-12-07', hasta: '2027-01-03' }, SEMANA)).toEqual({ inicio: '2026-12-07', fin: '2026-12-07' });
    expect(fechasDeNueva('2026-10-26', { desde: '2026-08-01', hasta: '2026-08-31' }, SEMANA)).toEqual({ inicio: '2026-08-03', fin: '2026-08-03' });
  });
});
