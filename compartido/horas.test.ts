import { describe, expect, it } from 'vitest';
import type { Pedazo } from './tipos.js';
import {
  duracionIso, duracionTexto, esDiaLaborable, finDelDia, instanteDelTope, msActivosUnion, msDeReloj, msPropios, relojTexto,
} from './horas.js';

const H = 3_600_000;
const MIN = 60_000;
const t = (h: number, m = 0): Date => new Date(Date.UTC(2026, 9, 26, h + 3, m));
const p = (tramoId: number, desde: Date, hasta: Date | null): Pedazo => ({ tramoId, desde: desde.toISOString(), hasta: hasta ? hasta.toISOString() : null });

describe('horas', () => {
  it('lunes a viernes sin feriado es laborable', () => {
    expect(esDiaLaborable('2026-10-26', new Set())).toBe(true);
    expect(esDiaLaborable('2026-10-24', new Set())).toBe(false);
    expect(esDiaLaborable('2026-11-23', new Set(['2026-11-23']))).toBe(false);
  });

  it('una sola tarea cuenta el tiempo entero', () => {
    expect(msPropios([p(1, t(9), t(12))], t(13)).get(1)).toBe(3 * H);
  });

  it('tres tareas a la vez cuentan cada una su tiempo entero; el reloj, una vez', () => {
    const ps = [p(1, t(9), t(12)), p(2, t(9), t(12)), p(3, t(9), t(12))];
    const r = msPropios(ps, t(13));
    expect([r.get(1), r.get(2), r.get(3)]).toEqual([3 * H, 3 * H, 3 * H]);
    expect(msActivosUnion(ps, t(13))).toBe(3 * H);
  });

  it('si una se frena a las 10, las otras siguen contando entero', () => {
    const ps = [p(1, t(9), t(12)), p(2, t(9), t(12)), p(3, t(9), t(10))];
    const r = msPropios(ps, t(13));
    expect([r.get(1), r.get(2), r.get(3)]).toEqual([3 * H, 3 * H, H]);
    expect(msActivosUnion(ps, t(13))).toBe(3 * H);
  });

  it('la pausa no cuenta', () => {
    const ps = [p(1, t(9), t(10)), p(1, t(11), t(12))];
    expect(msPropios(ps, t(13)).get(1)).toBe(2 * H);
    expect(msActivosUnion(ps, t(13))).toBe(2 * H);
  });

  it('un pedazo corriendo cuenta hasta ahora', () => {
    const ps = [p(1, t(9), null)];
    expect(msPropios(ps, t(9, 30)).get(1)).toBe(30 * MIN);
    expect(msActivosUnion(ps, t(9, 30))).toBe(30 * MIN);
  });

  it('el reloj suma lo corregido a mano en los cerrados, solo la diferencia con lo medido', () => {
    const ps = [p(1, t(9), t(11)), p(2, t(9), t(11))];
    const cerrado = (tramoId: number, segundos: number, medidos: number | null) => ({ tramoId, fin: t(11).toISOString(), segundos, medidos });
    // Sin corregir: dos tareas juntas de 9 a 11 son 2 h de reloj.
    expect(msDeReloj(ps, [cerrado(1, 7200, 7200), cerrado(2, 7200, 7200)], t(12))).toBe(2 * H);
    // Una sube a 3 h a mano: el reloj suma esa hora.
    expect(msDeReloj(ps, [cerrado(1, 3 * 3600, 7200), cerrado(2, 7200, 7200)], t(12))).toBe(3 * H);
    // Sin lo medido guardado, lo medido sale de los pedazos.
    expect(msDeReloj(ps, [cerrado(1, 1800, null)], t(12))).toBe(2 * H - 90 * MIN);
    // Antes de que cierre (con los pedazos recortados a las 10), la corrección todavía no pesa.
    expect(msDeReloj([p(1, t(9), t(10)), p(2, t(9), t(10))], [cerrado(1, 3 * 3600, 7200)], t(10))).toBe(H);
  });

  it('el tope llega a las 8 h del día', () => {
    expect(instanteDelTope(7.5 * H, t(15).getTime(), 8 * H, t(16))?.toISOString()).toBe(t(15, 30).toISOString());
    expect(instanteDelTope(7.5 * H, t(15).getTime(), 8 * H, t(15, 20))).toBeNull();
  });

  it('duraciones en texto e ISO', () => {
    expect(duracionTexto(12000)).toBe('3 h 20 m');
    expect(duracionTexto(2700)).toBe('45 m');
    expect(duracionTexto(7200)).toBe('2 h');
    expect(duracionTexto(0)).toBe('0 m');
    expect(duracionIso(5400)).toBe('PT1H30M');
    expect(duracionIso(20)).toBe('PT1M');
    expect(relojTexto(5050)).toBe('1:24:10');
  });

  it('finDelDia es la medianoche argentina', () => {
    expect(finDelDia('2026-10-26').toISOString()).toBe('2026-10-27T03:00:00.000Z');
  });
});
