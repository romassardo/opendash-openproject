import { describe, expect, it } from 'vitest';
import { diaMesCorto, diasEntre, diasLaborables, hoyArgentina, mesDe, rangoDias, semanaDe, siguienteLaborable, sumarDias, sumarLaborables } from './fechas.js';

describe('fechas', () => {
  it('hoyArgentina usa la hora de Buenos Aires', () => {
    expect(hoyArgentina(new Date('2026-10-20T01:30:00Z'))).toBe('2026-10-19');
  });

  it('semanaDe da lunes y domingo', () => {
    expect(semanaDe('2026-10-21')).toEqual({ lunes: '2026-10-19', domingo: '2026-10-25' });
    expect(semanaDe('2026-10-25')).toEqual({ lunes: '2026-10-19', domingo: '2026-10-25' });
  });

  it('sumarDias y diasEntre son corridos', () => {
    expect(sumarDias('2026-10-30', 3)).toBe('2026-11-02');
    expect(sumarDias('2026-10-01', -1)).toBe('2026-09-30');
    expect(diasEntre('2026-10-19', '2026-10-30')).toBe(11);
    expect(diasEntre('2026-10-30', '2026-10-19')).toBe(-11);
  });

  it('diasLaborables cuenta lunes a viernes con ambos extremos', () => {
    expect(diasLaborables('2026-10-19', '2026-10-25')).toBe(5);
    expect(diasLaborables('2026-10-19', '2026-10-19')).toBe(1);
    expect(diasLaborables('2026-10-24', '2026-10-25')).toBe(0);
    expect(diasLaborables('2026-09-07', '2026-10-30')).toBe(40);
  });

  it('diasLaborables da 0 si hasta es anterior a desde', () => {
    expect(diasLaborables('2026-10-25', '2026-10-19')).toBe(0);
  });

  it('rangoDias lista todos los días con extremos y queda vacío al revés', () => {
    expect(rangoDias('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(rangoDias('2026-11-02', '2026-10-30')).toEqual([]);
  });

  it('mesDe devuelve YYYY-MM', () => {
    expect(mesDe('2026-10-19')).toBe('2026-10');
  });

  it('siguienteLaborable salta el fin de semana', () => {
    expect(siguienteLaborable('2026-10-19')).toBe('2026-10-20');
    expect(siguienteLaborable('2026-10-23')).toBe('2026-10-26');
    expect(siguienteLaborable('2026-10-24')).toBe('2026-10-26');
    expect(siguienteLaborable('2026-10-25')).toBe('2026-10-26');
  });

  it('sumarLaborables cuenta desde el lunes si arranca en sábado', () => {
    expect(sumarLaborables('2026-10-24', 0)).toBe('2026-10-26');
    expect(sumarLaborables('2026-10-24', 1)).toBe('2026-10-27');
    expect(sumarLaborables('2026-10-25', 0)).toBe('2026-10-26');
  });

  it('sumarLaborables pasa por encima de los fines de semana', () => {
    expect(sumarLaborables('2026-10-19', 0)).toBe('2026-10-19');
    expect(sumarLaborables('2026-10-22', 2)).toBe('2026-10-26');
    expect(sumarLaborables('2026-10-23', 5)).toBe('2026-10-30');
  });

  it('diaMesCorto da «19 oct» sin punto', () => {
    expect(diaMesCorto('2026-10-19')).toBe('19 oct');
  });
});
