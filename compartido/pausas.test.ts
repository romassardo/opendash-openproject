import { describe, expect, it } from 'vitest';
import { calendarioDe } from './calendarioOp.js';
import { finConPausa, finSinPausa, motivoPausaInvalida, partesDe, pausaDesdeFechas, type Pausa } from './pausas.js';

// Lunes 2 a viernes 13 de noviembre de 2026: diez días hábiles. El lunes 9 es feriado en el segundo calendario.
const cal = calendarioDe({ semanaNoLaborable: [0, 6], diasNoLaborables: [] });
const conFeriado = calendarioDe({ semanaNoLaborable: [0, 6], diasNoLaborables: ['2026-11-09'] });
const pausa = (id: number, despues: number, dias: number): Pausa => ({ id, tareaId: 1, despues, dias });

describe('partesDe', () => {
  it('sin pausas es un solo tramo de trabajo, con el fin de semana adentro', () => {
    expect(partesDe('2026-11-02', '2026-11-13', [], cal)).toEqual({
      trabajo: [{ desde: '2026-11-02', hasta: '2026-11-13' }], pausas: [], trabajados: 10,
    });
  });

  it('una pausa de dos días después de tres de trabajo parte la tarea en dos', () => {
    // Trabajo lun 2 a mié 4, pausa jue 5 y vie 6, trabajo de lun 9 a vie 13.
    expect(partesDe('2026-11-02', '2026-11-13', [pausa(7, 3, 2)], cal)).toEqual({
      trabajo: [{ desde: '2026-11-02', hasta: '2026-11-04' }, { desde: '2026-11-09', hasta: '2026-11-13' }],
      pausas: [{ id: 7, desde: '2026-11-05', hasta: '2026-11-06', dias: 2 }],
      trabajados: 8,
    });
  });

  it('una pausa que empieza el lunes deja el fin de semana en el tramo de trabajo anterior', () => {
    const partes = partesDe('2026-11-02', '2026-11-13', [pausa(1, 5, 1)], cal);
    expect(partes.trabajo[0]).toEqual({ desde: '2026-11-02', hasta: '2026-11-06' });
    expect(partes.pausas[0]).toMatchObject({ desde: '2026-11-09', hasta: '2026-11-09' });
    expect(partes.trabajo[1]).toEqual({ desde: '2026-11-10', hasta: '2026-11-13' });
  });

  it('varias pausas, en el orden en que caen aunque vengan desordenadas', () => {
    const partes = partesDe('2026-11-02', '2026-11-13', [pausa(2, 6, 1), pausa(1, 2, 1)], cal);
    expect(partes.pausas.map((p) => [p.id, p.desde])).toEqual([[1, '2026-11-04'], [2, '2026-11-11']]);
    expect(partes.trabajo).toHaveLength(3);
    expect(partes.trabajados).toBe(8);
  });

  it('los días no laborables de OpenProject no cuentan como pausa ni como trabajo', () => {
    const partes = partesDe('2026-11-02', '2026-11-13', [pausa(1, 5, 2)], conFeriado);
    // Trabajo lun 2 a vie 6; el feriado del lunes 9 no cuenta: la pausa es mar 10 y mié 11.
    expect(partes.pausas[0]).toMatchObject({ desde: '2026-11-10', hasta: '2026-11-11', dias: 2 });
    expect(partes.trabajo[1]).toEqual({ desde: '2026-11-12', hasta: '2026-11-13' });
  });

  it('una pausa que pasa el fin se corta ahí, y una que ya no entra no aparece', () => {
    const cortada = partesDe('2026-11-02', '2026-11-06', [pausa(1, 3, 5)], cal);
    expect(cortada.pausas).toEqual([{ id: 1, desde: '2026-11-05', hasta: '2026-11-06', dias: 2 }]);
    expect(partesDe('2026-11-02', '2026-11-04', [pausa(1, 3, 2)], cal).pausas).toEqual([]);
  });
});

describe('pausaDesdeFechas', () => {
  const pedir = (desde: string, hasta: string, pausas: Pausa[] = []) => pausaDesdeFechas('2026-11-02', '2026-11-13', pausas, desde, hasta, cal);

  it('pasa las fechas a días de trabajo antes y días hábiles de pausa', () => {
    expect(pedir('2026-11-05', '2026-11-06')).toEqual({ despues: 3, dias: 2 });
    // Un fin de semana entero cuenta cero: del sábado 7 al martes 10 son dos días hábiles.
    expect(pedir('2026-11-07', '2026-11-10')).toEqual({ despues: 5, dias: 2 });
  });

  it('con otra pausa antes, cuenta solo los días trabajados', () => {
    expect(pedir('2026-11-11', '2026-11-11', [pausa(1, 2, 1)])).toEqual({ despues: 6, dias: 1 });
  });

  it('dice por qué no se puede', () => {
    expect(pedir('2026-11-06', '2026-11-05')).toBe('La pausa no puede terminar antes de empezar.');
    expect(pedir('2026-11-02', '2026-11-03')).toBe('La pausa tiene que empezar después del primer día de la tarea.');
    expect(pedir('2026-11-16', '2026-11-17')).toBe('La pausa tiene que empezar antes de que termine la tarea.');
    expect(pedir('2026-11-07', '2026-11-08')).toBe('Entre esas fechas no hay días hábiles.');
    expect(pedir('2026-11-04', '2026-11-05', [pausa(1, 3, 2)])).toBe('Se cruza con otra pausa de la tarea.');
    // El último día sí se puede: queda un día de trabajo para después.
    expect(pedir('2026-11-13', '2026-11-13')).toEqual({ despues: 9, dias: 1 });
    // Una tarea que termina un domingo: desde el sábado ya no queda trabajo.
    expect(pausaDesdeFechas('2026-11-02', '2026-11-15', [], '2026-11-14', '2026-11-16', cal)).toBe('Desde esa fecha ya no queda trabajo en la tarea.');
    expect(pausaDesdeFechas('2026-11-06', '2026-11-13', [], '2026-11-09', '2026-11-09', calendarioDe({ semanaNoLaborable: [0, 5, 6], diasNoLaborables: [] })))
      .toBe('La pausa tiene que empezar después del primer día de trabajo.');
    expect(pedir('2026-11-05', '2028-11-05')).toBe('Una pausa puede durar hasta 366 días hábiles.');
  });
});

describe('validar y correr el fin', () => {
  it('el servidor rechaza una pausa sin trabajo después o en el mismo lugar que otra', () => {
    expect(motivoPausaInvalida('2026-11-02', '2026-11-13', [], { despues: 3, dias: 2 }, cal)).toBeNull();
    expect(motivoPausaInvalida('2026-11-02', '2026-11-13', [], { despues: 10, dias: 2 }, cal)).toBe('Desde ahí ya no queda trabajo en la tarea.');
    expect(motivoPausaInvalida('2026-11-02', '2026-11-13', [pausa(1, 3, 1)], { despues: 3, dias: 2 }, cal)).toBe('Ya hay una pausa en ese lugar de la tarea.');
  });

  it('pausar corre el fin los días hábiles de la pausa y quitarla lo devuelve', () => {
    expect(finConPausa('2026-11-13', 2, cal)).toBe('2026-11-17');
    const pausas = [pausa(1, 3, 2)];
    expect(finSinPausa('2026-11-02', '2026-11-17', pausas, 1, cal)).toBe('2026-11-13');
  });

  it('quitar una pausa cortada por el fin devuelve solo lo que ocupaba; una que ya no entra no toca nada', () => {
    expect(finSinPausa('2026-11-02', '2026-11-06', [pausa(1, 3, 5)], 1, cal)).toBe('2026-11-04');
    expect(finSinPausa('2026-11-02', '2026-11-04', [pausa(1, 3, 2)], 1, cal)).toBeNull();
  });
});
