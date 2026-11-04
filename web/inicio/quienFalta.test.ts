import { describe, expect, it } from 'vitest';
import type { Feriado, MiembroEquipo, Persona } from '../../compartido/tipos.js';
import { quienFalta, textoAusencia } from './quienFalta.js';

// Semana del lunes 26/10/2026 al viernes 30/10/2026.
const HOY = '2026-10-27';
const personas: Persona[] = [
  { id: 1, nombre: 'Ana', login: null, email: null, avatarUrl: null },
  { id: 2, nombre: 'Pablo', login: null, email: null, avatarUrl: null },
  { id: 9, nombre: 'Ramiro', login: null, email: null, avatarUrl: null },
];
const miembro = (personaId: number, vacaciones: { desde: string; hasta: string }[]): MiembroEquipo => ({
  personaId, presencia: 'conectado' as MiembroEquipo['presencia'], rol: '', capacidadHoras: 40, trabajandoEn: [], vacaciones, reunionesPorSemana: null,
});
const textos = (miembros: MiembroEquipo[], feriados: Feriado[] = [], hoy = HOY, yo = 9) =>
  quienFalta(hoy, miembros, personas, feriados, yo).map(textoAusencia);

describe('quienFalta', () => {
  it('vacaciones que empezaron antes del lunes y siguen después del viernes: «toda la semana»', () => {
    expect(textos([miembro(1, [{ desde: '2026-10-19', hasta: '2026-11-06' }])])).toEqual(['Ana · toda la semana']);
  });

  it('empezaron antes y terminan el jueves: «de vacaciones hasta el jue 29/10»', () => {
    expect(textos([miembro(1, [{ desde: '2026-10-20', hasta: '2026-10-29' }])])).toEqual(['Ana · de vacaciones hasta el jue 29/10']);
  });

  it('empieza el miércoles: «desde el mié 28/10»', () => {
    expect(textos([miembro(2, [{ desde: '2026-10-28', hasta: '2026-11-10' }])])).toEqual(['Pablo · desde el mié 28/10']);
  });

  it('termina el jueves: «de vacaciones hasta el jue 29/10»', () => {
    expect(textos([miembro(1, [{ desde: '2026-10-26', hasta: '2026-10-29' }])])).toEqual(['Ana · de vacaciones hasta el jue 29/10']);
  });

  it('dos tramos seguidos se unen', () => {
    const r = quienFalta(HOY, [miembro(1, [{ desde: '2026-10-22', hasta: '2026-10-27' }, { desde: '2026-10-28', hasta: '2026-10-29' }])], personas, [], 9);
    expect(r).toHaveLength(1);
    expect(textoAusencia(r[0]!)).toBe('Ana · de vacaciones hasta el jue 29/10');
  });

  it('feriado del lunes', () => {
    expect(textos([], [{ fecha: '2026-10-26', nombre: 'Día de la Diversidad', puente: false, manual: false }])).toEqual(['lun 26/10 · feriado']);
  });

  it('feriados de otra semana no entran', () => {
    expect(textos([], [{ fecha: '2026-11-02', nombre: 'X', puente: false, manual: false }])).toEqual([]);
  });

  it('sábado muestra la semana siguiente', () => {
    const miembros = [miembro(1, [{ desde: '2026-11-02', hasta: '2026-11-03' }, { desde: '2026-10-26', hasta: '2026-10-27' }])];
    expect(textos(miembros, [], '2026-10-31')).toEqual(['Ana · de vacaciones hasta el mar 3/11']);
  });

  it('vos aparecés como «Vos»', () => {
    expect(textos([miembro(9, [{ desde: '2026-10-28', hasta: '2026-10-28' }])])).toEqual(['Vos · el mié 28/10']);
  });

  it('un tramo de varios días en el medio: «desde el … hasta el …»', () => {
    expect(textos([miembro(1, [{ desde: '2026-10-28', hasta: '2026-10-29' }])])).toEqual(['Ana · desde el mié 28/10 hasta el jue 29/10']);
  });

  it('tramos separados de una misma persona salen en una sola fila', () => {
    const r = quienFalta(HOY, [miembro(1, [{ desde: '2026-10-20', hasta: '2026-10-27' }, { desde: '2026-10-29', hasta: '2026-11-10' }])], personas, [], 9);
    expect(r).toHaveLength(1);
    expect(textoAusencia(r[0]!)).toBe('Ana · de vacaciones hasta el mar 27/10 y desde el jue 29/10');
  });

  it('el domingo muestra la semana que empieza mañana, sin el feriado de la que termina', () => {
    const feriados: Feriado[] = [
      { fecha: '2026-10-23', nombre: 'Viejo', puente: false, manual: false },
      { fecha: '2026-10-27', nombre: 'Nuevo', puente: false, manual: false },
    ];
    expect(textos([miembro(1, [{ desde: '2026-10-26', hasta: '2026-10-26' }])], feriados, '2026-10-25')).toEqual(['Ana · de vacaciones hasta el lun 26/10', 'mar 27/10 · feriado']);
  });

  it('ordena por el primer día que falta y después por nombre, con los feriados mezclados', () => {
    const r = textos(
      [miembro(2, [{ desde: '2026-10-28', hasta: '2026-11-10' }]), miembro(1, [{ desde: '2026-10-28', hasta: '2026-11-10' }]), miembro(9, [{ desde: '2026-10-20', hasta: '2026-10-26' }])],
      [{ fecha: '2026-10-27', nombre: 'F', puente: false, manual: false }],
    );
    expect(r).toEqual(['Vos · de vacaciones hasta el lun 26/10', 'mar 27/10 · feriado', 'Ana · desde el mié 28/10', 'Pablo · desde el mié 28/10']);
  });

  it('nadie: lista vacía', () => {
    expect(quienFalta(HOY, [miembro(1, [])], personas, [], 9)).toEqual([]);
  });
});
