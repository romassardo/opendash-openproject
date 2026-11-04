import { describe, expect, it } from 'vitest';
import type { Catalogo, Dependencia } from '../../compartido/tipos.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { calendarioDe } from '../../compartido/calendarioOp.js';
import { fechasDetras, inicioMinimo, minimoPorDependencia, planCascada, primeraQueSeMueve } from './cascada.js';

const dep = (id: number, predecesoraId: number, sucesoraId: number, lag = 0): Dependencia => ({ id, predecesoraId, sucesoraId, lag });
const cal = calendarioDe({ semanaNoLaborable: [0, 6], diasNoLaborables: [] });
const plan = (desde: number, tareas: ReturnType<typeof tareaDe>[], deps: Dependencia[], catalogo: Catalogo = CATALOGO, c = cal) =>
  planCascada(desde, tareas, deps, catalogo, c);

describe('planCascada', () => {
  it('una sucesora pisada se corre al día hábil siguiente y conserva su duración', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-21', fin: '2026-10-23' }), tareaDe(2, { titulo: 'Integración', inicio: '2026-10-19', fin: '2026-10-21' })];
    expect(plan(1, tareas, [dep(1, 1, 2)])).toEqual([
      { tareaId: 2, titulo: 'Integración', antes: { inicio: '2026-10-19', fin: '2026-10-21' }, despues: { inicio: '2026-10-26', fin: '2026-10-28' } },
    ]);
  });

  it('el corrimiento sigue en cadena', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { inicio: '2026-10-20', fin: '2026-10-21' }),
      tareaDe(3, { inicio: '2026-10-22', fin: '2026-10-22' }),
    ];
    expect(plan(1, tareas, [dep(1, 1, 2), dep(2, 2, 3)]).map((c) => [c.tareaId, c.despues])).toEqual([
      [2, { inicio: '2026-10-22', fin: '2026-10-23' }],
      [3, { inicio: '2026-10-26', fin: '2026-10-26' }],
    ]);
  });

  it('una manual que ya empieza después del mínimo no se mueve y la cadena no sigue por ella', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { inicio: '2026-10-27', fin: '2026-10-28' }),
      tareaDe(3, { inicio: '2026-10-29', fin: '2026-10-30' }),
    ];
    expect(plan(1, tareas, [dep(1, 1, 2), dep(2, 2, 3)])).toEqual([]);
  });

  it('con dos predecesoras manda la que termina más tarde', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { inicio: '2026-10-19', fin: '2026-10-30' }),
      tareaDe(3, { inicio: '2026-10-22', fin: '2026-10-23' }),
    ];
    expect(plan(1, tareas, [dep(1, 1, 3), dep(2, 2, 3)])[0]?.despues).toEqual({ inicio: '2026-11-02', fin: '2026-11-03' });
  });

  it('respeta el retraso', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { inicio: '2026-10-22', fin: '2026-10-22' })];
    expect(plan(1, tareas, [dep(1, 1, 2, 2)])[0]?.despues).toEqual({ inicio: '2026-10-26', fin: '2026-10-26' });
  });

  it('si el mínimo cae en un día no laborable de OpenProject salta al siguiente hábil', () => {
    const conFeriado = calendarioDe({ semanaNoLaborable: [0, 6], diasNoLaborables: ['2026-11-23'] });
    const tareas = [tareaDe(1, { inicio: '2026-11-19', fin: '2026-11-20' }), tareaDe(2, { inicio: '2026-11-20', fin: '2026-11-20' })];
    expect(plan(1, tareas, [dep(1, 1, 2)], CATALOGO, conFeriado)[0]?.despues).toEqual({ inicio: '2026-11-24', fin: '2026-11-24' });
  });

  it('conserva la duración en días hábiles', () => {
    const conFeriado = calendarioDe({ semanaNoLaborable: [0, 6], diasNoLaborables: ['2026-10-27'] });
    // Lun 19 a mié 21 = 3 hábiles; corrida a lun 26 ocupa lun 26, mié 28 y jue 29.
    const tareas = [tareaDe(1, { inicio: '2026-10-21', fin: '2026-10-23' }), tareaDe(2, { inicio: '2026-10-19', fin: '2026-10-21' })];
    expect(plan(1, tareas, [dep(1, 1, 2)], CATALOGO, conFeriado)[0]?.despues).toEqual({ inicio: '2026-10-26', fin: '2026-10-29' });
  });

  it('cadena manual, automática y manual: la tercera va detrás de la automática ya corrida', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }),
      tareaDe(2, { titulo: 'Automática', inicio: '2026-10-22', fin: '2026-10-23', programacionManual: false }),
      tareaDe(3, { titulo: 'Final', inicio: '2026-10-23', fin: '2026-10-23' }),
    ];
    const r = plan(1, tareas, [dep(1, 1, 2), dep(2, 2, 3)]);
    expect(r).toEqual([{ tareaId: 3, titulo: 'Final', antes: { inicio: '2026-10-23', fin: '2026-10-23' }, despues: { inicio: '2026-10-26', fin: '2026-10-26' } }]);
  });

  it('una sucesora sin fechas no se corre', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { titulo: 'Sin fechas' })];
    expect(plan(1, tareas, [dep(1, 1, 2)])).toEqual([]);
  });

  it('un hito se corre a su única fecha', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { tipoId: 2, inicio: '2026-10-21', fin: '2026-10-21' })];
    expect(plan(1, tareas, [dep(1, 1, 2)])[0]?.despues).toEqual({ inicio: '2026-10-22', fin: '2026-10-22' });
  });

  it('una cerrada no se corre pero sus sucesoras se evalúan contra sus fechas', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }),
      tareaDe(2, { estadoId: 12, inicio: '2026-10-22', fin: '2026-10-28' }),
      tareaDe(3, { titulo: 'Detrás', inicio: '2026-10-23', fin: '2026-10-23' }),
    ];
    const r = plan(1, tareas, [dep(1, 1, 2), dep(2, 2, 3)]);
    expect(r.map((c) => c.tareaId)).toEqual([3]);
    expect(r[0]?.despues).toEqual({ inicio: '2026-10-29', fin: '2026-10-29' });
  });

  it('termina con un ciclo', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { inicio: '2026-10-19', fin: '2026-10-20' }),
      tareaDe(3, { inicio: '2026-10-19', fin: '2026-10-20' }),
    ];
    const r = plan(1, tareas, [dep(1, 1, 2), dep(2, 2, 3), dep(3, 3, 1), dep(4, 3, 2)]);
    expect(r.map((c) => c.tareaId).sort()).toEqual([2, 3]);
  });
});

describe('fechasDetras', () => {
  it('fechasDetras conserva la duración hábil', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-21', fin: '2026-10-23' }), tareaDe(2, { inicio: '2026-10-22', fin: '2026-10-26' })];
    // 22 (jue) a 26 (lun) son 3 días hábiles; el mínimo es lun 26 → 26 a 28.
    expect(fechasDetras(2, tareas, [dep(1, 1, 2)], CATALOGO)).toEqual({ inicio: '2026-10-26', fin: '2026-10-28' });
  });

  it('fechasDetras con dos predecesoras usa la que termina más tarde', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-20' }), tareaDe(3, { inicio: '2026-10-19', fin: '2026-10-23' }),
      tareaDe(2, { inicio: '2026-10-21', fin: '2026-10-22' }),
    ];
    expect(fechasDetras(2, tareas, [dep(1, 1, 2), dep(2, 3, 2)], CATALOGO)).toEqual({ inicio: '2026-10-26', fin: '2026-10-27' });
  });

  it('fechasDetras de un hito da una sola fecha', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { tipoId: 2, inicio: '2026-10-20', fin: '2026-10-20' })];
    expect(fechasDetras(2, tareas, [dep(1, 1, 2)], CATALOGO)).toEqual({ inicio: '2026-10-22', fin: '2026-10-22' });
  });

  it('fechasDetras devuelve null si no está pisada', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { inicio: '2026-10-22', fin: '2026-10-23' })];
    expect(fechasDetras(2, tareas, [dep(1, 1, 2)], CATALOGO)).toBeNull();
  });

  it('fechasDetras devuelve null si la tarea está cerrada, aunque pise a la anterior', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-21', fin: '2026-10-23' }), tareaDe(2, { estadoId: 12, inicio: '2026-10-22', fin: '2026-10-26' })];
    expect(fechasDetras(2, tareas, [dep(1, 1, 2)], CATALOGO)).toBeNull();
  });

  it('fechasDetras ignora a la predecesora cerrada', () => {
    const tareas = [tareaDe(1, { estadoId: 12, inicio: '2026-10-21', fin: '2026-10-23' }), tareaDe(2, { inicio: '2026-10-22', fin: '2026-10-26' })];
    expect(fechasDetras(2, tareas, [dep(1, 1, 2)], CATALOGO)).toBeNull();
  });
});

describe('inicioMinimo y minimoPorDependencia', () => {
  it('minimoPorDependencia es el primer día hábil después del fin más el desfase', () => {
    // Viernes 23 + 0 → lunes 26; con 2 días de desfase, el miércoles 28.
    expect(minimoPorDependencia('2026-10-23', 0, cal)).toBe('2026-10-26');
    expect(minimoPorDependencia('2026-10-23', 2, cal)).toBe('2026-10-28');
    // Un desfase negativo no adelanta nada.
    expect(minimoPorDependencia('2026-10-23', -3, cal)).toBe('2026-10-26');
  });

  it('inicioMinimo no cuenta a las predecesoras cerradas', () => {
    const tareas = [
      tareaDe(1, { inicio: '2026-10-19', fin: '2026-10-30' }), tareaDe(3, { inicio: '2026-10-19', fin: '2026-10-21' }), tareaDe(2, { inicio: '2026-10-22' }),
    ];
    const deps = [dep(1, 1, 2), dep(2, 3, 2)];
    expect(inicioMinimo(2, tareas, deps, cal)).toBe('2026-11-02');
    expect(inicioMinimo(2, tareas, deps, cal, new Set([1]))).toBe('2026-10-22');
    expect(inicioMinimo(2, tareas, deps, cal, new Set([1, 3]))).toBeNull();
  });
});

describe('primeraQueSeMueve', () => {
  it('primeraQueSeMueve sube por las automáticas hasta la manual', () => {
    const tareas = [
      tareaDe(1, { programacionManual: true, fin: '2026-10-20' }),
      tareaDe(2, { programacionManual: false, fin: '2026-10-21' }),
      tareaDe(3, { programacionManual: false, fin: '2026-10-22' }),
    ];
    expect(primeraQueSeMueve(3, tareas, [dep(1, 1, 2), dep(2, 2, 3)])).toBe(1);
    expect(primeraQueSeMueve(1, tareas, [dep(1, 1, 2), dep(2, 2, 3)])).toBe(1);
  });

  it('con dos predecesoras sube por la que termina más tarde y no se cuelga con un ciclo', () => {
    const tareas = [
      tareaDe(1, { fin: '2026-10-20' }), tareaDe(4, { fin: '2026-10-23' }), tareaDe(2, { programacionManual: false, fin: '2026-10-26' }),
    ];
    expect(primeraQueSeMueve(2, tareas, [dep(1, 1, 2), dep(2, 4, 2)])).toBe(4);
    const ciclo = [tareaDe(1, { programacionManual: false }), tareaDe(2, { programacionManual: false })];
    // Da la vuelta una sola vez y corta al volver a una ya visitada: devuelve esa.
    expect(primeraQueSeMueve(1, ciclo, [dep(1, 1, 2), dep(2, 2, 1)])).toBe(1);
    expect(primeraQueSeMueve(2, ciclo, [dep(1, 1, 2), dep(2, 2, 1)])).toBe(2);
  });
});
