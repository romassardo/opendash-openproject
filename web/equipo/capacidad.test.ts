import { describe, expect, it } from 'vitest';
import { capacidadDelPeriodo, diasDeVacaciones, feriadosDelPeriodo } from './capacidad.js';
import { intervaloCarga } from './carga.js';

const HOY = '2026-10-19'; // lunes
const SEMANA = intervaloCarga(HOY, 'semana'); // 19 a 25 oct
const MES = intervaloCarga(HOY, 'mes'); // 19 oct a 15 nov
const SIN = new Set<string>();
const nada = { vacaciones: [], reunionesPorSemana: null };

describe('feriadosDelPeriodo', () => {
  it('deja solo los hábiles del período, ordenados', () => {
    const feriados = new Set(['2026-10-24', '2026-10-21', '2026-10-19', '2026-11-30']);
    expect(feriadosDelPeriodo(feriados, SEMANA)).toEqual(['2026-10-19', '2026-10-21']);
  });
});

describe('capacidadDelPeriodo', () => {
  it('sin nada que descontar es la capacidad semanal por las semanas', () => {
    expect(capacidadDelPeriodo(40, SEMANA, SIN, nada).capacidad).toBe(40);
    expect(capacidadDelPeriodo(40, MES, SIN, nada).capacidad).toBe(160);
  });

  it('un feriado el lunes deja 32 h de 40', () => {
    const ajuste = capacidadDelPeriodo(40, SEMANA, new Set(['2026-10-19']), nada);
    expect(ajuste.capacidad).toBe(32);
    expect(ajuste.feriados).toEqual(['2026-10-19']);
  });

  it('un feriado en sábado no descuenta', () => {
    const ajuste = capacidadDelPeriodo(40, SEMANA, new Set(['2026-10-24']), nada);
    expect(ajuste.capacidad).toBe(40);
    expect(ajuste.feriados).toEqual([]);
  });

  it('las vacaciones de toda la semana dejan capacidad 0', () => {
    const vacaciones = [{ desde: '2026-10-17', hasta: '2026-10-26' }];
    const ajuste = capacidadDelPeriodo(40, SEMANA, SIN, { vacaciones, reunionesPorSemana: null });
    expect(ajuste.capacidad).toBe(0);
    expect(ajuste.vacaciones).toEqual(vacaciones);
  });

  it('un feriado dentro de las vacaciones no se descuenta dos veces', () => {
    const ajuste = capacidadDelPeriodo(40, SEMANA, new Set(['2026-10-20']), {
      vacaciones: [{ desde: '2026-10-19', hasta: '2026-10-21' }], reunionesPorSemana: null,
    });
    expect(ajuste.capacidad).toBe(16);
  });

  it('las vacaciones que no tocan el período no figuran', () => {
    const ajuste = capacidadDelPeriodo(40, SEMANA, SIN, { vacaciones: [{ desde: '2026-11-02', hasta: '2026-11-06' }], reunionesPorSemana: null });
    expect(ajuste.vacaciones).toEqual([]);
    expect(ajuste.capacidad).toBe(40);
  });

  it('resta las horas de reunión de cada semana del período', () => {
    const reuniones = { '2026-10-19': 6, '2026-10-26': 2, '2026-11-02': 0, '2026-11-09': 1.5 };
    const ajuste = capacidadDelPeriodo(40, MES, SIN, { vacaciones: [], reunionesPorSemana: reuniones });
    expect(ajuste.capacidad).toBe(160 - 9.5);
    expect(ajuste.horasReunion).toBe(9.5);
    expect(ajuste.sinCalendario).toBe(false);
  });

  it('en la semana solo resta la reunión de esa semana', () => {
    const ajuste = capacidadDelPeriodo(40, SEMANA, SIN, { vacaciones: [], reunionesPorSemana: { '2026-10-19': 6, '2026-10-26': 2 } });
    expect(ajuste.capacidad).toBe(34);
  });

  it('la capacidad nunca queda negativa', () => {
    const ajuste = capacidadDelPeriodo(40, SEMANA, new Set(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']), {
      vacaciones: [], reunionesPorSemana: { '2026-10-19': 20 },
    });
    expect(ajuste.capacidad).toBe(0);
    expect(ajuste.horasReunion).toBe(8);
  });

  it('sin-calendario no resta y lo avisa', () => {
    const ajuste = capacidadDelPeriodo(40, SEMANA, SIN, { vacaciones: [], reunionesPorSemana: 'sin-calendario' });
    expect(ajuste.capacidad).toBe(40);
    expect(ajuste.sinCalendario).toBe(true);
    expect(ajuste.horasReunion).toBeNull();
  });

  it('con la opción apagada no hay horas de reunión', () => {
    expect(capacidadDelPeriodo(40, SEMANA, SIN, nada).horasReunion).toBeNull();
  });

  it('quien no usa OpenDash solo descuenta feriados', () => {
    const ajuste = capacidadDelPeriodo(40, SEMANA, new Set(['2026-10-19']), undefined);
    expect(ajuste).toEqual({ capacidad: 32, feriados: ['2026-10-19'], vacaciones: [], horasReunion: null, sinCalendario: false });
  });
});

describe('diasDeVacaciones', () => {
  const ajusteCon = (vacaciones: { desde: string; hasta: string }[], feriados: string[] = []) =>
    ({ capacidad: 0, feriados, vacaciones, horasReunion: null, sinCalendario: false });

  it('cuenta de lunes a viernes y no cuenta el feriado del miércoles', () => {
    const ajuste = ajusteCon([{ desde: '2026-10-19', hasta: '2026-10-23' }], ['2026-10-21']);
    expect(diasDeVacaciones(ajuste, SEMANA)).toBe(4);
  });

  it('un fin de semana de vacaciones no cuenta', () => {
    expect(diasDeVacaciones(ajusteCon([{ desde: '2026-10-24', hasta: '2026-10-25' }]), SEMANA)).toBe(0);
  });

  it('recorta al intervalo y no cuenta dos veces los días superpuestos', () => {
    const ajuste = ajusteCon([{ desde: '2026-10-01', hasta: '2026-10-20' }, { desde: '2026-10-20', hasta: '2026-10-21' }]);
    expect(diasDeVacaciones(ajuste, SEMANA)).toBe(3);
  });
});
