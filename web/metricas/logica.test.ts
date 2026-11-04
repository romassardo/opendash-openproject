import { describe, expect, it } from 'vitest';
import type { HorasPorDia } from '../../compartido/tipos.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { calcularMetricas, cierresDe, diasDelPeriodo } from './logica.js';

const HOY = '2026-10-19';
const CERRADO = 12;
const HITO = 2;

const cerrada = (id: number, cerradaEl: string, extra = {}) => tareaDe(id, { estadoId: CERRADO, cerradaEl, ...extra });
const calcular = (tareas: ReturnType<typeof tareaDe>[], horas: HorasPorDia[] = [], periodo: 7 | 30 | 90 = 7) =>
  calcularMetricas(tareas, CATALOGO, horas, periodo, HOY);

const dia = (usuarioId: number, fecha: string, segundos: number): HorasPorDia => ({ usuarioId, dia: fecha, segundos });

describe('calcularMetricas', () => {
  it('un cierre a las 23:30 de Argentina cuenta en ese día', () => {
    // 02:30Z del 19 = 23:30 del 18 en Buenos Aires
    const m = calcular([cerrada(1, '2026-10-19T02:30:00Z')]);
    expect(m.completadas.valor).toBe(1);
    expect(m.ritmo.find((d) => d.fecha === '2026-10-18')?.actual).toBe(1);
    expect(m.ritmo.find((d) => d.fecha === HOY)?.actual).toBe(0);
  });

  it('completadas excluye hitos y cerradas sin fecha de cierre', () => {
    const m = calcular([
      cerrada(1, '2026-10-17T15:00:00Z'),
      cerrada(2, '2026-10-17T15:00:00Z', { tipoId: HITO }),
      tareaDe(3, { estadoId: CERRADO, cerradaEl: null }),
      cerrada(4, '2026-10-12T15:00:00Z'), // fuera del período de 7 días (13 al 19)
    ]);
    expect(m.completadas.valor).toBe(1);
    expect(m.completadas.anterior).toBe(1);
  });

  it('sin cierres en el período anterior la variación es null', () => {
    const m = calcular([cerrada(1, '2026-10-17T15:00:00Z')]);
    expect(m.completadas).toEqual({ valor: 1, anterior: 0, variacion: null });
  });

  it('la variación de completadas es el porcentaje contra el período anterior', () => {
    const m = calcular([
      cerrada(1, '2026-10-17T15:00:00Z'), cerrada(2, '2026-10-18T15:00:00Z'), cerrada(3, '2026-10-18T16:00:00Z'),
      cerrada(4, '2026-10-10T15:00:00Z'), cerrada(5, '2026-10-11T15:00:00Z'),
    ]);
    expect(m.completadas).toEqual({ valor: 3, anterior: 2, variacion: 50 });
  });

  it('a tiempo solo mira las completadas con fecha de fin', () => {
    const m = calcular([
      cerrada(1, '2026-10-17T15:00:00Z', { fin: '2026-10-17' }), // a tiempo
      cerrada(2, '2026-10-18T15:00:00Z', { fin: '2026-10-17' }), // tarde
      cerrada(3, '2026-10-18T15:00:00Z'), // sin fin: no entra
      cerrada(4, '2026-10-10T15:00:00Z', { fin: '2026-10-12' }), // anterior: a tiempo
    ]);
    expect(m.aTiempo.valor).toBe(50);
    expect(m.aTiempo.anterior).toBe(100);
    expect(m.aTiempo.variacion).toBe(-50);
  });

  it('a tiempo es null si ninguna completada tiene fin', () => {
    const m = calcular([cerrada(1, '2026-10-17T15:00:00Z')]);
    expect(m.aTiempo).toEqual({ valor: null, anterior: null, variacion: null });
  });

  it('Métricas: horas trabajadas por día desde las horas del equipo', () => {
    const m = calcular([], [
      dia(9, '2026-10-19', 4800), // 1,333 h
      dia(5, '2026-10-19', 3600), // 1 h de otra persona el mismo día
      dia(9, '2026-10-15', 1800), // 0,5 h
      dia(9, '2026-10-10', 3600), // período anterior: 1 h
    ]);
    expect(m.horasTrabajadas).toEqual({ valor: 2.8, anterior: 1, variacion: 180 });
    expect(m.horasPorDia).toHaveLength(7);
    expect(m.horasPorDia.at(-1)).toEqual({ fecha: HOY, horas: 8400 / 3600 });
    expect(m.horasPorDia[0]?.fecha).toBe('2026-10-13');
  });

  it('el ciclo es el promedio de días entre creación y cierre, con la resta como variación', () => {
    const m = calcular([
      cerrada(1, '2026-10-17T10:00:00Z', { creada: '2026-10-15T10:00:00Z' }), // 2 d
      cerrada(2, '2026-10-18T22:00:00Z', { creada: '2026-10-16T10:00:00Z' }), // 2,5 d
      cerrada(3, '2026-10-10T10:00:00Z', { creada: '2026-10-05T10:00:00Z' }), // anterior: 5 d
    ]);
    expect(m.cicloDias).toEqual({ valor: 2.3, anterior: 5, variacion: -2.7 });
  });

  it('el ritmo tiene un elemento por día del período alineado con el anterior', () => {
    const m = calcular([cerrada(1, '2026-10-19T15:00:00Z'), cerrada(2, '2026-10-12T15:00:00Z'), cerrada(3, '2026-10-12T16:00:00Z')]);
    expect(m.ritmo).toHaveLength(7);
    expect(m.ritmo[0]).toEqual({ fecha: '2026-10-13', actual: 0, anterior: 0 });
    expect(m.ritmo[6]).toEqual({ fecha: HOY, actual: 1, anterior: 2 }); // anterior del último = 12/10
  });

  it('los períodos de 30 y 90 días tienen esa cantidad de días', () => {
    expect(calcular([], [], 30).ritmo).toHaveLength(30);
    expect(calcular([], [], 90).horasPorDia).toHaveLength(90);
  });

  it('por proyecto va de mayor a menor con porcentajes redondeados', () => {
    const m = calcular([
      cerrada(1, '2026-10-17T15:00:00Z', { proyectoId: 12 }),
      cerrada(2, '2026-10-17T15:00:00Z', { proyectoId: 11 }),
      cerrada(3, '2026-10-17T15:00:00Z', { proyectoId: 11 }),
    ]);
    expect(m.porProyecto).toEqual([
      { proyectoId: 11, cantidad: 2, porcentaje: 67 },
      { proyectoId: 12, cantidad: 1, porcentaje: 33 },
    ]);
  });
});

describe('cierresDe y diasDelPeriodo (compartidos con el CSV)', () => {
  it('cierresDe deja fuera hitos, abiertas y sin fecha, y da el día argentino', () => {
    const cierres = cierresDe([
      cerrada(1, '2026-10-19T02:30:00Z'),
      cerrada(2, '2026-10-17T15:00:00Z', { tipoId: HITO }),
      tareaDe(3, { estadoId: CERRADO, cerradaEl: null }),
    ], CATALOGO);
    expect(cierres.map((c) => [c.tarea.id, c.dia])).toEqual([[1, '2026-10-18']]);
  });

  it('diasDelPeriodo son los N días que terminan hoy', () => {
    const dias = diasDelPeriodo(HOY, 7);
    expect(dias.size).toBe(7);
    expect(dias.has('2026-10-13')).toBe(true);
    expect(dias.has('2026-10-12')).toBe(false);
  });
});

describe('real contra estimado', () => {
  const con = (id: number, extra: object) => cerrada(id, '2026-10-17T15:00:00Z', extra);

  it('real contra estimado por persona y proyecto', () => {
    const m = calcular([
      con(1, { responsableId: 9, proyectoId: 11, estimacionHoras: 2, horasReales: 3 }),
      con(2, { responsableId: 9, proyectoId: 12, estimacionHoras: 4, horasReales: 4 }),
      con(3, { responsableId: 5, proyectoId: 11, estimacionHoras: 5, horasReales: 2.5 }),
    ]);
    expect(m.realEstimado.porPersona).toEqual([
      { id: 9, real: 7, estimado: 6, cociente: 1.17, tareas: 2 },
      { id: 5, real: 2.5, estimado: 5, cociente: 0.5, tareas: 1 },
    ]);
    expect(m.realEstimado.porProyecto).toEqual([
      { id: 11, real: 5.5, estimado: 7, cociente: 0.79, tareas: 2 },
      { id: 12, real: 4, estimado: 4, cociente: 1, tareas: 1 },
    ]);
  });

  it('deja fuera lo abierto, lo de otro período y lo que no tiene estimación u horas trabajadas', () => {
    const m = calcular([
      tareaDe(1, { estadoId: 7, estimacionHoras: 2, horasReales: 3 }),
      cerrada(2, '2026-09-01T15:00:00Z', { estimacionHoras: 2, horasReales: 3 }),
      con(3, { estimacionHoras: null, horasReales: 3 }),
      con(4, { estimacionHoras: 2, horasReales: null }),
      con(5, { estimacionHoras: 2, horasReales: 0 }),
      con(6, { responsableId: null, estimacionHoras: 2, horasReales: 1 }),
    ]);
    expect(m.realEstimado.porPersona).toEqual([]);
    expect(m.realEstimado.porProyecto).toEqual([{ id: 11, real: 1, estimado: 2, cociente: 0.5, tareas: 1 }]);
  });
});
