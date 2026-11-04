import { describe, expect, it } from 'vitest';
import type { Tarea } from '../../compartido/tipos.js';
import { CATALOGO as catalogo } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import {
  avanceSubtareas,
  contadores,
  esHitoDe,
  fechaAmigable,
  fechaArgentina,
  filtrarTareas,
  hoyArgentina,
  resumenAbiertas,
  tareasDeColumna,
  vencida,
  type FiltroTareas,
} from './logica.js';

// Estados: 1 New, 7 In progress, 4 On hold, 12 Closed, 14 Rejected. Tipos: 1 Task, 2 Milestone, 3 Summary task.
const hoy = '2026-10-19'; // lunes
const viejo = '2026-08-01T12:00:00Z';

const madre = tareaDe(10, { titulo: 'Lanzar el portal', tipoId: 3, estadoId: 7, fin: '2026-10-22' });
const tareasEjemplo: Tarea[] = [
  madre,
  // Hijas de 10: tres cerradas (una rechazada) hace tiempo, dos abiertas y un hito que no cuenta.
  tareaDe(21, { madreId: 10, estadoId: 12, cerradaEl: viejo }),
  tareaDe(22, { madreId: 10, estadoId: 12, cerradaEl: viejo, actualizada: '2026-10-18T12:00:00Z' }),
  tareaDe(23, { madreId: 10, estadoId: 14, cerradaEl: null, actualizada: viejo }),
  tareaDe(24, { madreId: 10, estadoId: 1 }),
  tareaDe(25, { madreId: 10, estadoId: 4, fin: '2026-10-26', prioridadId: 9, responsableId: 5 }),
  tareaDe(26, { madreId: 10, tipoId: 2, estadoId: 12, cerradaEl: '2026-10-19T12:00:00Z' }),
  // Abiertas con fecha: vencida y fin de semana.
  tareaDe(12, { titulo: 'Revisar la migración de datos', estadoId: 1, fin: '2026-10-15', responsableId: 9 }),
  tareaDe(13, { estadoId: 7, fin: '2026-10-25', responsableId: 5 }),
  // Cerradas: esta semana, hace 39 días, y un hito cerrado esta semana.
  tareaDe(40, { estadoId: 12, cerradaEl: '2026-10-19T13:00:00Z' }),
  tareaDe(41, { estadoId: 12, cerradaEl: '2026-09-10T12:00:00Z' }),
  tareaDe(51, { tipoId: 2, estadoId: 12, cerradaEl: '2026-10-19T12:00:00Z' }),
  // Hito abierto en «Migración del ERP»: nunca cuenta ni aparece.
  tareaDe(50, { titulo: 'Hito de migración', tipoId: 2, estadoId: 1, proyectoId: 12, fin: '2026-10-20' }),
];

const sinFiltro: FiltroTareas = { proyectoId: null, persona: 'todas', soloAltas: false, texto: '' };
const ids = (tareas: Tarea[]) => tareas.map((t) => t.id);

describe('fechaAmigable', () => {
  it.each([
    ['2026-10-19', 'Hoy'],
    ['2026-10-20', 'Mañana'],
    ['2026-10-18', 'Ayer'],
    ['2026-10-22', 'Jue'],
    ['2026-11-10', '10 nov'],
  ])('fechaAmigable %s → %s', (f, txt) => {
    expect(fechaAmigable(f, hoy)).toBe(txt);
  });

  it.each([
    ['2026-10-25', 'Dom'],
    ['2026-10-13', 'Mar'],
    ['2026-10-26', '26 oct'],
    ['2026-10-12', '12 oct'],
    ['2027-01-03', '3 ene 2027'],
  ])('en el borde de la semana y en otro año: %s → %s', (f, txt) => {
    expect(fechaAmigable(f, hoy)).toBe(txt);
  });
});

describe('fechas en hora argentina', () => {
  it('hoy se calcula en Buenos Aires', () => {
    expect(hoyArgentina(new Date('2026-10-20T02:30:00Z'))).toBe('2026-10-19');
    expect(hoyArgentina(new Date('2026-10-20T03:30:00Z'))).toBe('2026-10-20');
  });

  it('un instante se lee como fecha argentina', () => {
    expect(fechaArgentina('2026-10-19T01:00:00Z')).toBe('2026-10-18');
  });
});

describe('contadores', () => {
  it('contadores con semana de lunes a domingo', () => {
    expect(contadores(tareasEjemplo, catalogo, hoy)).toEqual({ abiertas: 5, vencenSemana: 2, vencidas: 1, cerradasSemana: 1 });
  });

  it('el cierre de la semana se cuenta en hora argentina', () => {
    // Domingo 18 a las 22 h en Buenos Aires: es de la semana anterior.
    const domingo = tareaDe(60, { estadoId: 12, cerradaEl: '2026-10-19T01:00:00Z' });
    // Sin fecha de cierre cuenta la última actualización.
    const sinCierre = tareaDe(61, { estadoId: 14, cerradaEl: null, actualizada: '2026-10-21T15:00:00Z' });
    expect(contadores([domingo, sinCierre], catalogo, '2026-10-21').cerradasSemana).toBe(1);
  });

  it('resume abiertas y proyectos con singular y plural', () => {
    expect(resumenAbiertas(tareasEjemplo, catalogo)).toBe('5 abiertas en 1 proyecto');
    const dos = [tareaDe(1, { estadoId: 1 }), tareaDe(2, { estadoId: 7, proyectoId: 12 })];
    expect(resumenAbiertas(dos, catalogo)).toBe('2 abiertas en 2 proyectos');
    expect(resumenAbiertas([tareaDe(1, { estadoId: 1 })], catalogo)).toBe('1 abierta en 1 proyecto');
    expect(resumenAbiertas([], catalogo)).toBe('Sin tareas abiertas');
  });
});

describe('tareasDeColumna', () => {
  it('Cerrado muestra solo lo cerrado en 30 días y nunca hitos', () => {
    expect(tareasDeColumna(tareasEjemplo, 'cerrado', catalogo, hoy).map((t) => t.id)).toEqual([40]);
  });

  it('cada estado va a su columna, sin hitos', () => {
    expect(ids(tareasDeColumna(tareasEjemplo, 'nuevo', catalogo, hoy))).toEqual([12, 24]);
    expect(ids(tareasDeColumna(tareasEjemplo, 'curso', catalogo, hoy))).toEqual([10, 13]);
    expect(ids(tareasDeColumna(tareasEjemplo, 'pausa', catalogo, hoy))).toEqual([25]);
  });

  it('ordena por fin ascendente con las vacías al final y después por id', () => {
    const tareas = [
      tareaDe(5, { fin: null }),
      tareaDe(4, { fin: '2026-11-02' }),
      tareaDe(3, { fin: null }),
      tareaDe(2, { fin: '2026-10-20' }),
      tareaDe(1, { fin: '2026-11-02' }),
    ];
    expect(ids(tareasDeColumna(tareas, 'nuevo', catalogo, hoy))).toEqual([2, 1, 4, 3, 5]);
  });

  it('Cerrado pone primero lo cerrado más recientemente (sin cierre, la última actualización) y desempata por id', () => {
    const tareas = [
      tareaDe(1, { estadoId: 12, fin: '2026-10-01', cerradaEl: '2026-10-10T12:00:00Z' }),
      tareaDe(2, { estadoId: 14, fin: null, cerradaEl: null, actualizada: '2026-10-18T09:00:00Z' }),
      tareaDe(3, { estadoId: 12, fin: '2026-12-01', cerradaEl: '2026-10-18T15:00:00Z' }),
      tareaDe(4, { estadoId: 12, fin: '2026-09-01', cerradaEl: '2026-10-10T12:00:00Z', actualizada: '2026-10-19T12:00:00Z' }),
    ];
    expect(ids(tareasDeColumna(tareas, 'cerrado', catalogo, hoy))).toEqual([3, 2, 1, 4]);
  });

  it('un estado que no está en el catálogo va a Nuevo', () => {
    expect(ids(tareasDeColumna([tareaDe(7, { estadoId: 999 })], 'nuevo', catalogo, hoy))).toEqual([7]);
  });
});

describe('filtrarTareas', () => {
  it('filtra por texto sin tildes ni mayúsculas', () => {
    expect(filtrarTareas(tareasEjemplo, { ...sinFiltro, texto: 'migracion' }, catalogo, 9).map((t) => t.id)).toEqual([12]);
  });

  it('el texto busca también en el proyecto y en el responsable, y todas las palabras tienen que estar', () => {
    const tareas = [tareaDe(1, { proyectoId: 12 }), tareaDe(2, { responsableId: 5 }), tareaDe(3)];
    expect(ids(filtrarTareas(tareas, { ...sinFiltro, texto: 'ERP' }, catalogo, 9))).toEqual([1]);
    expect(ids(filtrarTareas(tareas, { ...sinFiltro, texto: '  martin  GÓMEZ ' }, catalogo, 9))).toEqual([2]);
    expect(ids(filtrarTareas(tareas, { ...sinFiltro, texto: 'martin portal' }, catalogo, 9))).toEqual([2]);
    expect(ids(filtrarTareas(tareas, { ...sinFiltro, texto: 'martin erp' }, catalogo, 9))).toEqual([]);
  });

  it('sin filtros deja todo menos los hitos', () => {
    expect(ids(filtrarTareas(tareasEjemplo, sinFiltro, catalogo, 9))).not.toContain(50);
    expect(filtrarTareas(tareasEjemplo, sinFiltro, catalogo, 9)).toHaveLength(tareasEjemplo.length - 3);
  });

  it('filtra por proyecto, por mías, por persona y por prioridad alta', () => {
    const tareas = [
      tareaDe(1, { responsableId: 9 }),
      tareaDe(2, { responsableId: 5, proyectoId: 12, prioridadId: 9 }),
      tareaDe(3, { responsableId: null, prioridadId: 9 }),
    ];
    expect(ids(filtrarTareas(tareas, { ...sinFiltro, proyectoId: 12 }, catalogo, 9))).toEqual([2]);
    expect(ids(filtrarTareas(tareas, { ...sinFiltro, persona: 'mias' }, catalogo, 9))).toEqual([1]);
    expect(ids(filtrarTareas(tareas, { ...sinFiltro, persona: 5 }, catalogo, 9))).toEqual([2]);
    expect(ids(filtrarTareas(tareas, { ...sinFiltro, soloAltas: true }, catalogo, 9))).toEqual([2, 3]);
  });
});

describe('avanceSubtareas', () => {
  it('avance cuenta hijas cerradas sobre total', () => {
    expect(avanceSubtareas(madre, tareasEjemplo, catalogo)).toEqual({ hechas: 3, total: 5 });
  });

  it('sin hijas no hay avance', () => {
    expect(avanceSubtareas(tareaDe(13), tareasEjemplo, catalogo)).toBeNull();
  });
});

describe('esHitoDe', () => {
  it('reconoce las tareas de un tipo marcado como hito', () => {
    const esHito = esHitoDe(catalogo);
    expect(esHito(tareaDe(1, { tipoId: 2 }))).toBe(true);
    expect(esHito(tareaDe(2))).toBe(false);
  });
});

describe('vencida', () => {
  it('vencida: fin pasado', () => expect(vencida(tareaDe(1, { inicio: '2026-10-10', fin: '2026-10-15' }), hoy, catalogo)).toBe(true));
  it('vencida: solo inicio pasado', () => expect(vencida(tareaDe(1, { inicio: '2026-10-15' }), hoy, catalogo)).toBe(true));
  it('vencida: un hito pasado cuenta', () => expect(vencida(tareaDe(1, { tipoId: 2, fin: '2026-10-15' }), hoy, catalogo)).toBe(true));
  it('no vencida: cerrada', () => expect(vencida(tareaDe(1, { estadoId: 12, fin: '2026-10-15' }), hoy, catalogo)).toBe(false));
  it('no vencida: sin fechas', () => expect(vencida(tareaDe(1), hoy, catalogo)).toBe(false));
  it('no vencida: fin hoy', () => expect(vencida(tareaDe(1, { fin: hoy }), hoy, catalogo)).toBe(false));
});
