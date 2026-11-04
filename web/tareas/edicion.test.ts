import { describe, expect, it } from 'vitest';
import type { Actividad, Catalogo } from '../../compartido/tipos.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { opcionesResponsable, ancestros, buscarTareas, descendientes, fechasValidas, leerHoras, mostrarHoras, sucesorasDe, ultimosCambios } from './edicion.js';

describe('horas', () => {
  it('acepta coma o punto decimal y vacío es «sin estimación»', () => {
    expect(leerHoras('1,5')).toEqual({ valida: true, horas: 1.5 });
    expect(leerHoras(' 8 ')).toEqual({ valida: true, horas: 8 });
    expect(leerHoras('0.25')).toEqual({ valida: true, horas: 0.25 });
    expect(leerHoras('')).toEqual({ valida: true, horas: null });
  });

  it('rechaza negativos y texto', () => {
    expect(leerHoras('-2').valida).toBe(false);
    expect(leerHoras('dos').valida).toBe(false);
    expect(leerHoras('1,5,2').valida).toBe(false);
  });

  it('se muestran con coma', () => {
    expect(mostrarHoras(1.5)).toBe('1,5');
    expect(mostrarHoras(null)).toBe('');
  });
});

describe('fechasValidas', () => {
  it('el fin no puede ser anterior al inicio; faltando una, vale', () => {
    expect(fechasValidas('2026-10-20', '2026-10-20')).toBe(true);
    expect(fechasValidas('2026-10-20', '2026-10-19')).toBe(false);
    expect(fechasValidas(null, '2026-10-19')).toBe(true);
    expect(fechasValidas('2026-10-20', null)).toBe(true);
  });
});

describe('ultimosCambios', () => {
  it('toma los últimos detalles en orden cronológico', () => {
    const actividades: Actividad[] = [
      { id: 2, creada: '2026-10-18T10:00:00Z', autorId: 1, comentario: '', detalles: ['c', 'd'] },
      { id: 1, creada: '2026-10-17T10:00:00Z', autorId: 1, comentario: '', detalles: ['a', 'b'] },
      { id: 3, creada: '2026-10-19T10:00:00Z', autorId: 1, comentario: 'hola', detalles: [] },
    ];
    expect(ultimosCambios(actividades, 3).map((c) => c.texto)).toEqual(['b', 'c', 'd']);
  });
});

describe('buscarTareas', () => {
  const tareas = [tareaDe(1, { titulo: 'Integración API banco' }), tareaDe(2, { titulo: 'Conciliación bancaria' }), tareaDe(3)];

  it('busca sin tildes por todas las palabras o por número', () => {
    expect(buscarTareas(tareas, 'integracion banco').map((t) => t.id)).toEqual([1]);
    expect(buscarTareas(tareas, 'BANC').map((t) => t.id)).toEqual([1, 2]);
    expect(buscarTareas(tareas, '#3').map((t) => t.id)).toEqual([3]);
    expect(buscarTareas(tareas, '   ')).toEqual([]);
  });

  it('corta en el máximo pedido', () => {
    const muchas = [10, 11, 12, 13, 14].map((id) => tareaDe(id));
    expect(buscarTareas(muchas, 't1', 2).map((t) => t.id)).toEqual([10, 11]);
  });
});

describe('ancestros y sucesoras', () => {
  it('ancestros sube por la madre hasta la raíz (y no se cuelga con un ciclo)', () => {
    const tareas = [tareaDe(1), tareaDe(2, { madreId: 1 }), tareaDe(3, { madreId: 2 }), tareaDe(4, { madreId: 3 })];
    expect([...ancestros(4, tareas)].sort()).toEqual([1, 2, 3]);
    expect(ancestros(1, tareas).size).toBe(0);
    const ciclo = [tareaDe(5, { madreId: 6 }), tareaDe(6, { madreId: 5 })];
    expect([...ancestros(5, ciclo)]).toEqual([6]);
  });

  it('sucesoras junta las que esperan a la tarea, directa o indirectamente', () => {
    const dependencias = [
      { id: 1, predecesoraId: 10, sucesoraId: 11, lag: 0 },
      { id: 2, predecesoraId: 11, sucesoraId: 12, lag: 0 },
      { id: 3, predecesoraId: 12, sucesoraId: 10, lag: 0 },
      { id: 4, predecesoraId: 20, sucesoraId: 10, lag: 0 },
    ];
    expect([...sucesorasDe(10, dependencias)].sort()).toEqual([11, 12]);
    expect(sucesorasDe(12, dependencias).has(20)).toBe(false);
  });
});

describe('descendientes', () => {
  it('junta hijas, nietas y más abajo', () => {
    const tareas = [tareaDe(1), tareaDe(2, { madreId: 1 }), tareaDe(3, { madreId: 2 }), tareaDe(4, { madreId: 3 }), tareaDe(5)];
    expect([...descendientes(1, tareas)].sort()).toEqual([2, 3, 4]);
    expect(descendientes(5, tareas).size).toBe(0);
  });
});

describe('opcionesResponsable', () => {
  const persona = (id: number, nombre: string) => ({ id, nombre, login: null, email: null, avatarUrl: null });
  const catalogo = {
    personas: [persona(1, 'Zoe'), persona(2, 'Álvaro'), persona(3, 'Beto'), persona(4, 'Carla')],
    asignables: { 11: [1, 2] },
  } as unknown as Catalogo;

  it('ofrece a los asignables del proyecto y conserva al responsable actual', () => {
    const opciones = opcionesResponsable(tareaDe(1, { proyectoId: 11, responsableId: 4 }), catalogo);
    expect(opciones).toEqual([
      { valor: '', texto: 'Sin asignar' },
      { valor: '2', texto: 'Álvaro' },
      { valor: '4', texto: 'Carla' },
      { valor: '1', texto: 'Zoe' },
    ]);
  });

  it('sin lista de asignables para el proyecto ofrece a todas las personas', () => {
    const opciones = opcionesResponsable(tareaDe(1, { proyectoId: 99, responsableId: null }), catalogo);
    expect(opciones.map((o) => o.texto)).toEqual(['Sin asignar', 'Álvaro', 'Beto', 'Carla', 'Zoe']);
  });

  it('un responsable que ya no figura en el catálogo se muestra sin datos', () => {
    const opciones = opcionesResponsable(tareaDe(1, { proyectoId: 11, responsableId: 77 }), catalogo);
    expect(opciones).toContainEqual({ valor: '77', texto: 'Persona sin datos' });
  });
});
