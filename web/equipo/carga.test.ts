import { describe, expect, it } from 'vitest';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { cargaDePersona, esLarga, intervaloCarga, totalesCarga, type ParametrosCarga, type PeriodoCarga } from './carga.js';

const HOY = '2026-10-19'; // lunes; semana 2026-10-19 a 2026-10-25
const PARAMETROS: ParametrosCarga = { horasPorDefecto: 4, horasSemanaLargas: 6 };
const CURSO = 7;
const NUEVO = 1;
const CERRADO = 12;
const HITO = 2;

const carga = (tareas: ReturnType<typeof tareaDe>[], capacidad = 30) => cargaDePersona(9, tareas, CATALOGO, capacidad, PARAMETROS, HOY);

describe('esLarga', () => {
  it('es larga solo si dura más de 31 días corridos', () => {
    expect(esLarga(tareaDe(1, { inicio: '2026-09-01', fin: '2026-10-02' }))).toBe(false); // 31 días
    expect(esLarga(tareaDe(2, { inicio: '2026-09-01', fin: '2026-10-03' }))).toBe(true); // 32 días
    expect(esLarga(tareaDe(3, { inicio: null, fin: '2026-10-03' }))).toBe(false);
  });
});

describe('cargaDePersona', () => {
  it('una tarea larga con estimación suma su parte de la semana', () => {
    const larga = tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-09-07', fin: '2026-10-30', estimacionHoras: 80 });
    const resultado = carga([larga]);
    expect(resultado.horas).toBe(10);
    expect(resultado.largas).toEqual([
      { tareaId: 1, titulo: 'T1', inicio: '2026-09-07', fin: '2026-10-30', semanaActual: 7, semanasTotales: 8, horasSemana: 10 },
    ]);
    expect(resultado.abiertas).toBe(1);
  });

  it('una tarea larga sin estimación suma las horas por semana por defecto', () => {
    const larga = tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-09-07', fin: '2026-10-30' });
    const resultado = carga([larga]);
    expect(resultado.horas).toBe(6);
    expect(resultado.largas[0]?.horasSemana).toBe(6);
  });

  it('una larga que no cruza esta semana va en largas pero no suma', () => {
    const larga = tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-11-02', fin: '2027-01-29' });
    const resultado = carga([larga]);
    expect(resultado.horas).toBe(0);
    expect(resultado.largas).toHaveLength(1);
  });

  it('una tarea corta que cruza esta semana suma su estimación o las horas por defecto', () => {
    const conEstimacion = tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-10-22', fin: '2026-10-28', estimacionHoras: 5.5 });
    const sinEstimacion = tareaDe(2, { responsableId: 9, estadoId: NUEVO, fin: '2026-10-21' });
    expect(carga([conEstimacion]).horas).toBe(5.5);
    expect(carga([sinEstimacion]).horas).toBe(4);
  });

  it('una tarea en curso sin estimación ni fechas suma las horas por defecto', () => {
    expect(carga([tareaDe(1, { responsableId: 9, estadoId: CURSO })]).horas).toBe(4);
  });

  it('una tarea sin fechas y fuera de curso no suma', () => {
    const resultado = carga([tareaDe(1, { responsableId: 9, estadoId: NUEVO })]);
    expect(resultado.horas).toBe(0);
    expect(resultado.abiertas).toBe(1);
  });

  it('una tarea con fechas fuera de esta semana y no en curso no suma', () => {
    const resultado = carga([tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-10-26', fin: '2026-10-30' })]);
    expect(resultado.horas).toBe(0);
  });

  it('una tarea en curso suma aunque sus fechas estén fuera de la semana', () => {
    expect(carga([tareaDe(1, { responsableId: 9, estadoId: CURSO, inicio: '2026-10-01', fin: '2026-10-05' })]).horas).toBe(4);
  });

  it('una madre con hijas abiertas no suma, sus hijas sí', () => {
    const madre = tareaDe(1, { responsableId: 9, estadoId: CURSO, tipoId: 3, estimacionHoras: 40 });
    const hija = tareaDe(2, { responsableId: 9, estadoId: CURSO, madreId: 1, estimacionHoras: 3 });
    const resultado = carga([madre, hija]);
    expect(resultado.horas).toBe(3);
    expect(resultado.abiertas).toBe(2);
  });

  it('una madre cuyas hijas están cerradas sí suma', () => {
    const madre = tareaDe(1, { responsableId: 9, estadoId: CURSO, estimacionHoras: 8 });
    const hija = tareaDe(2, { responsableId: 9, estadoId: CERRADO, madreId: 1 });
    expect(carga([madre, hija]).horas).toBe(8);
  });

  it('los hitos, las cerradas y las ajenas no cuentan', () => {
    const resultado = carga([
      tareaDe(1, { responsableId: 9, tipoId: HITO, estadoId: CURSO }),
      tareaDe(2, { responsableId: 9, estadoId: CERRADO }),
      tareaDe(3, { responsableId: 5, estadoId: CURSO }),
      tareaDe(4, { responsableId: null, estadoId: CURSO }),
    ]);
    expect(resultado).toEqual({ personaId: 9, horas: 0, capacidad: 30, excedida: false, abiertas: 0, largas: [] });
  });

  it('se pasa de la capacidad y queda marcada como excedida', () => {
    const tareas = [1, 2, 3].map((id) => tareaDe(id, { responsableId: 9, estadoId: CURSO, estimacionHoras: 10 }));
    expect(carga(tareas, 30).excedida).toBe(false);
    expect(carga(tareas, 29).excedida).toBe(true);
  });

  it('semanaActual queda acotada entre 1 y semanasTotales', () => {
    const terminada = tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-06-01', fin: '2026-08-31' });
    const futura = tareaDe(2, { responsableId: 9, estadoId: NUEVO, inicio: '2026-12-01', fin: '2027-02-26' });
    const [a, b] = carga([terminada, futura]).largas;
    expect(a?.semanaActual).toBe(a?.semanasTotales);
    expect(b?.semanaActual).toBe(1);
  });
});

describe('intervaloCarga', () => {
  it('arranca el lunes de la semana de hoy y dura 1, 2 o 4 semanas', () => {
    expect(intervaloCarga('2026-10-21', 'semana')).toEqual({ desde: '2026-10-19', hasta: '2026-10-25' });
    expect(intervaloCarga('2026-10-21', 'quincena')).toEqual({ desde: '2026-10-19', hasta: '2026-11-01' });
    expect(intervaloCarga('2026-10-25', 'mes')).toEqual({ desde: '2026-10-19', hasta: '2026-11-15' });
  });
});

describe('cargaDePersona por período', () => {
  const cargaEn = (periodo: PeriodoCarga, tareas: ReturnType<typeof tareaDe>[], capacidad = 30) =>
    cargaDePersona(9, tareas, CATALOGO, capacidad, PARAMETROS, HOY, periodo);

  it('la capacidad semanal se multiplica por las semanas del período', () => {
    expect(cargaEn('semana', []).capacidad).toBe(30);
    expect(cargaEn('quincena', []).capacidad).toBe(60);
    expect(cargaEn('mes', []).capacidad).toBe(120);
  });

  it('una tarea de la semana que viene suma en la quincena pero no en la semana', () => {
    const proxima = [tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-10-26', fin: '2026-10-30', estimacionHoras: 7 })];
    expect(cargaEn('semana', proxima).horas).toBe(0);
    expect(cargaEn('quincena', proxima).horas).toBe(7);
  });

  it('una tarea corta que cruza dos semanas suma una sola vez en la quincena', () => {
    const cruza = [tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-10-22', fin: '2026-10-28', estimacionHoras: 5.5 })];
    expect(cargaEn('quincena', cruza).horas).toBe(5.5);
  });

  it('una tarea larga suma sus horas por cada semana del período en la que cae', () => {
    // 10 h por semana hasta el viernes 30 de octubre: cae en las dos primeras semanas.
    const termina = tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-09-07', fin: '2026-10-30', estimacionHoras: 80 });
    // 6 h por semana desde el lunes 2 de noviembre: cae en la tercera y la cuarta.
    const empieza = tareaDe(2, { responsableId: 9, estadoId: NUEVO, inicio: '2026-11-02', fin: '2027-01-29' });
    expect(cargaEn('semana', [termina, empieza]).horas).toBe(10);
    expect(cargaEn('quincena', [termina, empieza]).horas).toBe(20);
    expect(cargaEn('mes', [termina, empieza]).horas).toBe(32);
  });

  it('una tarea larga en curso que no cae en el período suma una semana, como en la vista semanal', () => {
    const atrasada = [tareaDe(1, { responsableId: 9, estadoId: CURSO, inicio: '2026-06-01', fin: '2026-08-31' })];
    expect(cargaEn('semana', atrasada).horas).toBe(6);
    expect(cargaEn('mes', atrasada).horas).toBe(6);
  });

  it('se excede contra la capacidad del período', () => {
    const tareas = [1, 2, 3].map((id) => tareaDe(id, { responsableId: 9, estadoId: CURSO, estimacionHoras: 10 }));
    expect(cargaEn('semana', tareas, 20).excedida).toBe(true);
    expect(cargaEn('quincena', tareas, 20).excedida).toBe(false);
  });
});

describe('cargaDePersona con capacidad del período', () => {
  it('quien está de vacaciones toda la semana con tareas queda con «X h de más»', () => {
    const tarea = tareaDe(1, { responsableId: 9, estadoId: CURSO, estimacionHoras: 6 });
    const resultado = cargaDePersona(9, [tarea], CATALOGO, 40, PARAMETROS, HOY, 'semana', 0);
    expect(resultado.capacidad).toBe(0);
    expect(resultado.horas).toBe(6);
    expect(resultado.excedida).toBe(true);
  });

  it('la capacidad del período reemplaza a la semanal por las semanas', () => {
    expect(cargaDePersona(9, [], CATALOGO, 40, PARAMETROS, HOY, 'mes', 150).capacidad).toBe(150);
  });
});

describe('totalesCarga', () => {
  it('suma horas y capacidad; las horas de más de uno no restan las libres de otro', () => {
    const cargas = [
      cargaDePersona(9, [tareaDe(1, { responsableId: 9, estadoId: CURSO, estimacionHoras: 30 })], CATALOGO, 40, PARAMETROS, HOY),
      cargaDePersona(5, [tareaDe(2, { responsableId: 5, estadoId: CURSO, estimacionHoras: 50 })], CATALOGO, 40, PARAMETROS, HOY),
    ];
    expect(totalesCarga(cargas)).toEqual({ horas: 80, capacidad: 80, libres: 10 });
  });

  it('sin personas da todo en cero', () => {
    expect(totalesCarga([])).toEqual({ horas: 0, capacidad: 0, libres: 0 });
  });
});

describe('cargaDePersona con pausas', () => {
  // La semana del lunes 19 al domingo 25 de octubre.
  const trabajoDe = (tramos: Record<number, { desde: string; hasta: string }[]>) => (t: ReturnType<typeof tareaDe>) => tramos[t.id] ?? null;

  it('una tarea que esta semana está toda en pausa no suma', () => {
    const tarea = tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-10-14', fin: '2026-10-28', estimacionHoras: 5 });
    const enPausa = trabajoDe({ 1: [{ desde: '2026-10-14', hasta: '2026-10-16' }, { desde: '2026-10-26', hasta: '2026-10-28' }] });
    expect(cargaDePersona(9, [tarea], CATALOGO, 30, PARAMETROS, HOY, 'semana', undefined, enPausa).horas).toBe(0);
    // Sin la pausa, la misma tarea cruza la semana y suma.
    expect(carga([tarea]).horas).toBe(5);
  });

  it('una tarea en curso suma aunque esta semana esté en pausa, como sin pausas', () => {
    const tarea = tareaDe(1, { responsableId: 9, estadoId: CURSO, inicio: '2026-10-14', fin: '2026-10-28', estimacionHoras: 5 });
    const enPausa = trabajoDe({ 1: [{ desde: '2026-10-14', hasta: '2026-10-16' }, { desde: '2026-10-26', hasta: '2026-10-28' }] });
    expect(cargaDePersona(9, [tarea], CATALOGO, 30, PARAMETROS, HOY, 'semana', undefined, enPausa).horas).toBe(5);
  });

  it('una tarea larga reparte sus horas solo entre las semanas en que se trabaja', () => {
    // Del 7 de septiembre al 30 de octubre son 8 semanas; con tres de pausa (21/9 al 9/10) quedan 5 de trabajo.
    const larga = tareaDe(1, { responsableId: 9, estadoId: NUEVO, inicio: '2026-09-07', fin: '2026-10-30', estimacionHoras: 50 });
    const enPausa = trabajoDe({ 1: [{ desde: '2026-09-07', hasta: '2026-09-18' }, { desde: '2026-10-12', hasta: '2026-10-30' }] });
    const resultado = cargaDePersona(9, [larga], CATALOGO, 30, PARAMETROS, HOY, 'semana', undefined, enPausa);
    expect(resultado.largas[0]).toMatchObject({ semanasTotales: 5, horasSemana: 10, semanaActual: 4 });
    expect(resultado.horas).toBe(10);
  });
});
