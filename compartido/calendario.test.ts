import { describe, expect, it } from 'vitest';
import { cuentaComoReunion, enCurso } from './calendario.js';
import { esFechaValida, instanteArgentino } from './fechas.js';
import type { Reunion } from './tipos.js';

const base: Reunion = { id: 'a:1', titulo: 'x', lugar: null, inicio: '2026-10-19T12:00:00.000Z', fin: '2026-10-19T13:00:00.000Z',
  diaEntero: false, libre: false, enlace: null, plataforma: null };

describe('cuentaComoReunion', () => {
  it('cuentaComoReunion deja afuera las libres y las de día entero', () => {
    expect(cuentaComoReunion(base)).toBe(true);
    expect(cuentaComoReunion({ ...base, libre: true })).toBe(false);
    expect(cuentaComoReunion({ ...base, diaEntero: true })).toBe(false);
  });
});

describe('enCurso', () => {
  it('va de inicio (incluido) a fin (excluido)', () => {
    expect(enCurso(base, new Date('2026-10-19T11:59:59.000Z'))).toBe(false);
    expect(enCurso(base, new Date('2026-10-19T12:00:00.000Z'))).toBe(true);
    expect(enCurso(base, new Date('2026-10-19T13:00:00.000Z'))).toBe(false);
  });
  it('no cuenta las libres ni las de día entero', () => {
    const medio = new Date('2026-10-19T12:30:00.000Z');
    expect(enCurso({ ...base, libre: true }, medio)).toBe(false);
    expect(enCurso({ ...base, diaEntero: true }, medio)).toBe(false);
  });
});

describe('fechas compartidas', () => {
  it('instanteArgentino da la medianoche de Buenos Aires', () => {
    expect(instanteArgentino('2026-10-19').toISOString()).toBe('2026-10-19T03:00:00.000Z');
  });
  it('esFechaValida acepta solo días que existen', () => {
    expect(esFechaValida('2026-10-19')).toBe(true);
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('2026-1-9')).toBe(false);
    expect(esFechaValida('hola')).toBe(false);
  });
});
