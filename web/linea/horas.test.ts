import { describe, expect, it } from 'vitest';
import { horasDe, horasDeBarra } from './horas.js';

const texto = (estimacionHoras: number | null, horasReales: number | null, cerrada: boolean) =>
  horasDeBarra({ estimacionHoras, horasReales }, cerrada)?.texto ?? null;

describe('horas de una tarea', () => {
  it('abierta sin nada trabajado muestra la estimación', () => expect(texto(5, null, false)).toBe('~5 h'));
  it('abierta con horas trabajadas y estimación muestra las dos', () => {
    expect(horasDe({ estimacionHoras: 5, horasReales: 2 }, false)).toEqual({ texto: '2 h / ~5 h', pasada: false, descripcion: '2 h trabajadas de 5 h estimadas' });
  });
  it('usa el formato de horas y minutos de la app', () => {
    expect(horasDe({ estimacionHoras: 8, horasReales: 7 + 8 / 60 }, false)?.texto).toBe('7 h 8 m / ~8 h');
    expect(texto(0.75, null, false)).toBe('~45 m');
  });
  it('abierta pasada de lo estimado lo marca', () => expect(horasDe({ estimacionHoras: 1, horasReales: 7.07 }, false)).toMatchObject({ texto: '7 h 4 m / ~1 h', pasada: true }));
  it('abierta con horas trabajadas y sin estimación muestra lo trabajado', () => {
    expect(horasDe({ estimacionHoras: null, horasReales: 6 + 10 / 60 }, false)).toEqual({ texto: '6 h 10 m', pasada: false, descripcion: '6 h 10 m trabajadas' });
  });
  it('cerrada muestra las trabajadas', () => expect(texto(5, 6.5, true)).toBe('6 h 30 m ✓'));
  it('cerrada sin trabajadas usa la estimación', () => expect(texto(3, 0, true)).toBe('3 h ✓'));
  it('en Tareas la cerrada va sin «✓» (la tarjeta ya lo tiene)', () => expect(horasDe({ estimacionHoras: 3, horasReales: 4 }, true)?.texto).toBe('4 h'));
  it('sin horas da null', () => {
    expect(texto(null, null, false)).toBeNull();
    expect(texto(null, null, true)).toBeNull();
  });
  it('menos de medio minuto no se muestra', () => {
    expect(texto(0.005, null, false)).toBeNull();
    expect(texto(0.005, 0.005, true)).toBeNull();
    expect(texto(5, 0.005, false)).toBe('~5 h');
    expect(texto(1 / 60, null, false)).toBe('~1 m');
  });
});
