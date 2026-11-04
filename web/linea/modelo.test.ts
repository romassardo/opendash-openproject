import { describe, expect, it } from 'vitest';
import { calendarioDe } from '../../compartido/calendarioOp.js';
import { desdeParaVer, desdeTrasArrastre, marcasDe, moverVentana, noLaborablesEnVentana, ventanaDesde, ventanaInicial, type Ventana } from './modelo.js';

// Ventana de Mes de 1200 px: 75 días desde el 12 de octubre.
const MES = ventanaDesde('2026-10-12', 'mes', 1200);
const TRIMESTRE = ventanaDesde('2026-10-12', 'trimestre', 1200);

describe('ventana', () => {
  it('la ventana arranca un lunes con hoy hacia la mitad', () => {
    expect(MES).toEqual({ desde: '2026-10-12', hasta: '2026-12-25', pxPorDia: 16, dias: 75 });
    // 25 días a la vista: del lunes 12 al jueves 5, con el viernes 23 en el día 12.
    expect(ventanaInicial('semana', 1200, '2026-10-23').desde).toBe('2026-10-12');
    // Con dos semanas justas: la anterior y la actual.
    expect(ventanaInicial('semana', 48 * 14, '2026-10-23').desde).toBe('2026-10-12');
  });

  it('moverVentana corre media ventana', () => {
    const siguiente = moverVentana(MES, 1);
    expect(siguiente.desde).toBe('2026-11-18');
    expect(siguiente.dias).toBe(75);
    expect(siguiente.hasta).toBe('2027-01-31');
    expect(moverVentana(siguiente, -1)).toEqual(MES);
  });

  it('desdeParaVer deja la fecha a la vista, hacia la mitad y arrancando un lunes', () => {
    expect(desdeParaVer('2026-09-18', MES)).toBe('2026-08-10');
    const semana = ventanaDesde('2026-10-26', 'semana', 48 * 14);
    expect(desdeParaVer('2026-09-18', semana)).toBe('2026-09-14');
    const angosta = ventanaDesde('2026-10-26', 'semana', 48 * 3);
    expect(desdeParaVer('2026-09-20', angosta)).toBe('2026-09-20');
  });

  it('noLaborablesEnVentana: fines de semana y días de OpenProject, sin los feriados; en Trimestre ninguno', () => {
    const semana = ventanaDesde('2026-10-12', 'semana', 48 * 14);
    const cal = calendarioDe({ semanaNoLaborable: [0, 6], diasNoLaborables: ['2026-10-21'] });
    expect(noLaborablesEnVentana(semana, 'semana', cal, new Map([['2026-10-24', 'x']]))).toEqual(['2026-10-17', '2026-10-18', '2026-10-21', '2026-10-25']);
    expect(noLaborablesEnVentana(semana, 'trimestre', cal, new Map())).toEqual([]);
  });

  it('las marcas cambian con el zoom', () => {
    const semana: Ventana = ventanaDesde('2026-10-12', 'semana', 48 * 7);
    expect(marcasDe(semana, 'semana')).toHaveLength(7);
    expect(marcasDe(semana, 'semana')[0]).toEqual({ fecha: '2026-10-12', texto: 'lun 12' });
    expect(marcasDe(MES, 'mes').slice(0, 2)).toEqual([{ fecha: '2026-10-12', texto: '12 oct' }, { fecha: '2026-10-19', texto: '19 oct' }]);
    expect(marcasDe(TRIMESTRE, 'trimestre').map((m) => m.texto)).toEqual(['nov 2026', 'dic 2026', 'ene 2027', 'feb 2027', 'mar 2027', 'abr 2027', 'may 2027', 'jun 2027']);
  });

  it('arrastrar el fondo corre la ventana de a un día, al revés del puntero', () => {
    expect(desdeTrasArrastre('2026-10-12', 96, 48)).toBe('2026-10-10');
    expect(desdeTrasArrastre('2026-10-12', -100, 48)).toBe('2026-10-14');
    expect(desdeTrasArrastre('2026-10-12', 20, 48)).toBe('2026-10-12');
    expect(desdeTrasArrastre('2026-10-12', -52, 5)).toBe('2026-10-22');
  });
});
