import { describe, expect, it } from 'vitest';
import type { Dependencia } from '../../compartido/tipos.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { anterioresEnConflicto, anteriorEnConflicto, cadena, conflictos, esperaYFrena, textoCadena } from './cadena.js';

const dep = (id: number, predecesoraId: number, sucesoraId: number, lag = 0): Dependencia => ({ id, predecesoraId, sucesoraId, lag });

describe('cadena', () => {
  it('la cadena junta predecesoras y sucesoras transitivas', () => {
    // 1 → 2 → 3 → 4, y 5 → 3 (5 es predecesora de 3); 6 cuelga de 1 pero no es de la cadena de 3.
    const deps = [dep(1, 1, 2), dep(2, 2, 3), dep(3, 3, 4), dep(4, 5, 3), dep(5, 1, 6)];
    expect([...cadena(3, deps)].sort()).toEqual([1, 2, 3, 4, 5]);
    expect([...cadena(9, deps)]).toEqual([9]);
  });

  it('la cadena termina con un ciclo', () => {
    const deps = [dep(1, 1, 2), dep(2, 2, 3), dep(3, 3, 1)];
    expect([...cadena(1, deps)].sort()).toEqual([1, 2, 3]);
  });

  it('esperaYFrena devuelve solo las directas', () => {
    const deps = [dep(1, 1, 2), dep(2, 2, 3), dep(3, 5, 2)];
    expect(esperaYFrena(2, deps)).toEqual({ espera: [1, 5], frena: [3] });
  });

  it('una sucesora que empieza el día que termina la anterior está en conflicto', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }),
      tareaDe(2, { inicio: '2026-10-21', fin: '2026-10-23' }),
      tareaDe(3, { inicio: '2026-10-22', fin: '2026-10-23' }),
    ];
    expect([...conflictos(tareas, [dep(1, 1, 2), dep(2, 1, 3)], CATALOGO)]).toEqual([1]);
  });

  it('el lag corre el límite en días laborables y la falta de fechas no es conflicto', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-23' }),
      tareaDe(2, { inicio: '2026-10-27', fin: '2026-10-28' }),
      tareaDe(3, { inicio: null, fin: '2026-10-28' }),
    ];
    // fin 23 (vie) + 2 laborables = 27 (mar): empieza ese mismo día → conflicto; la 3 no tiene inicio.
    expect([...conflictos(tareas, [dep(1, 1, 2, 2), dep(2, 1, 3, 0)], CATALOGO)]).toEqual([1]);
    expect([...conflictos(tareas, [dep(1, 1, 2, 1)], CATALOGO)]).toEqual([]);
  });

  it('«!» con calendario de OpenProject', () => {
    const catalogo = { ...CATALOGO, diasNoLaborables: ['2026-10-26'] };
    const pred = tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-23' });
    const lunes = [pred, tareaDe(2, { inicio: '2026-10-26', fin: '2026-10-27' })];
    const martes = [pred, tareaDe(2, { inicio: '2026-10-27', fin: '2026-10-28' })];
    expect([...conflictos(lunes, [dep(1, 1, 2)], catalogo)]).toEqual([1]);
    expect([...conflictos(martes, [dep(1, 1, 2)], catalogo)]).toEqual([]);
  });

  it('sucesora cerrada no se marca', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-23' }), tareaDe(2, { estadoId: 12, inicio: '2026-10-20', fin: '2026-10-21' })];
    expect([...conflictos(tareas, [dep(1, 1, 2)], CATALOGO)]).toEqual([]);
  });

  it('predecesora cerrada no marca conflicto', () => {
    const tareas = [tareaDe(1, { estadoId: 12, inicio: '2026-10-19', fin: '2026-10-23' }), tareaDe(2, { inicio: '2026-10-20', fin: '2026-10-21' })];
    expect([...conflictos(tareas, [dep(1, 1, 2)], CATALOGO)]).toEqual([]);
  });

  it('predecesora sin fechas no marca', () => {
    const tareas = [tareaDe(1), tareaDe(2, { inicio: '2026-10-20', fin: '2026-10-21' })];
    expect([...conflictos(tareas, [dep(1, 1, 2)], CATALOGO)]).toEqual([]);
  });

  it('predecesora con solo inicio usa ese día como fin', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-21' }), tareaDe(2, { inicio: '2026-10-21', fin: '2026-10-23' })];
    expect([...conflictos(tareas, [dep(1, 1, 2)], CATALOGO)]).toEqual([1]);
  });

  it('el texto de la cadena dice a quién espera y a quién frena', () => {
    const tareas = [
      tareaDe(1, { titulo: 'Módulo de cobranzas', estadoId: 7, inicio: '2026-10-26', fin: '2026-11-03' }),
      tareaDe(2, { titulo: 'Integración', inicio: '2026-11-04', fin: '2026-11-10' }),
      tareaDe(3, { titulo: 'Pruebas con usuarios', inicio: '2026-11-11', fin: '2026-11-12' }),
    ];
    const deps = [dep(1, 1, 2), dep(2, 2, 3)];
    expect(textoCadena(2, tareas, deps, CATALOGO)).toBe('Espera a: Módulo de cobranzas (en curso, termina 3 nov) · Frena a: Pruebas con usuarios');
  });

  it('el texto marca la cerrada, el conflicto y la tarea sin nada', () => {
    const tareas = [
      tareaDe(1, { titulo: 'Base', estadoId: 12, inicio: '2026-10-19', fin: '2026-10-21' }),
      tareaDe(2, { titulo: 'Diseño', estadoId: 7, inicio: '2026-10-19', fin: '2026-10-30' }),
      tareaDe(3, { titulo: 'Armado', inicio: '2026-10-22', fin: '2026-10-23' }),
      tareaDe(4, { titulo: 'Suelta' }),
    ];
    const deps = [dep(1, 1, 3), dep(2, 2, 3)];
    expect(textoCadena(3, tareas, deps, CATALOGO)).toBe('Espera a: Base (✓ ya está cerrada), Diseño (⚠ empieza antes de que termine)');
    expect(textoCadena(4, tareas, deps, CATALOGO)).toBe('nada');
  });
});

describe('anterioresEnConflicto', () => {
  it('para cada sucesora pisada elige la anterior que termina más tarde, en una sola pasada', () => {
    const tareas = [
      tareaDe(1, { titulo: 'Corta', inicio: '2026-10-19', fin: '2026-10-20' }),
      tareaDe(2, { titulo: 'Larga', inicio: '2026-10-19', fin: '2026-10-23' }),
      tareaDe(3, { titulo: 'Pisada', inicio: '2026-10-21', fin: '2026-10-22' }),
      tareaDe(4, { titulo: 'Libre', inicio: '2026-11-02', fin: '2026-11-03' }),
    ];
    const deps = [dep(1, 1, 3), dep(2, 2, 3), dep(3, 2, 4)];
    const manda = anterioresEnConflicto(tareas, deps, CATALOGO);
    expect([...manda].map(([id, t]) => [id, t.titulo])).toEqual([[3, 'Larga']]);
    expect(anteriorEnConflicto(3, tareas, deps, CATALOGO)?.titulo).toBe('Larga');
    expect(anteriorEnConflicto(4, tareas, deps, CATALOGO)).toBeNull();
  });
});
