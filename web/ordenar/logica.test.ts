import { describe, expect, it } from 'vitest';
import type { Catalogo, Dependencia, MiembroEquipo, Tarea } from '../../compartido/tipos.js';
import { AJUSTES, CATALOGO } from '../../pruebas/fabricas/web.js';
import { armarEquipo } from '../equipo/equipo.js';
import type { PeriodoCarga } from '../equipo/carga.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { armarParaOrdenar, cuentaMia, type EntradaOrdenar, type FiltroOrdenar } from './logica.js';

const YO = 9;
const HOY = '2026-10-26';
const MIAS: FiltroOrdenar = { persona: 'mias', proyectoId: null };
const TODAS: FiltroOrdenar = { persona: 'todas', proyectoId: null };
const dep = (id: number, predecesoraId: number, sucesoraId: number, lag = 0): Dependencia => ({ id, predecesoraId, sucesoraId, lag });
const entrada = (tareas: Tarea[], extra: Partial<EntradaOrdenar> = {}, catalogo: Catalogo = CATALOGO): EntradaOrdenar => ({
  tareas, dependencias: [], catalogo, miembros: [], metricas: AJUSTES.metricas, feriados: new Set(), yoId: YO, hoy: HOY, ...extra,
});
const ids = (filas: { tarea: Tarea }[]): number[] => filas.map((f) => f.tarea.id);

describe('armarParaOrdenar', () => {
  it('pisan: la sucesora en conflicto con su anterior y el motivo', () => {
    const tareas = [
      tareaDe(1, { titulo: 'Relevamiento', inicio: '2026-10-26', fin: '2026-10-30', responsableId: 5 }),
      tareaDe(2, { titulo: 'Diseño', inicio: '2026-10-28', fin: '2026-11-03', responsableId: YO }),
    ];
    const r = armarParaOrdenar(entrada(tareas, { dependencias: [dep(1, 1, 2)] }), MIAS);
    expect(r.pisan).toHaveLength(1);
    expect(r.pisan[0]).toMatchObject({ seccion: 'pisan', anteriorId: 1, motivo: 'empieza antes de que termine «Relevamiento»' });
    expect(r.pisan[0]?.tarea.id).toBe(2);
    expect(armarParaOrdenar(entrada(tareas, { dependencias: [dep(1, 1, 2)] }), { persona: 5, proyectoId: null }).pisan).toEqual([]);
  });

  it('vencidas y sin fechas filtradas por Mías', () => {
    const tareas = [
      tareaDe(1, { responsableId: YO, fin: '2026-10-20' }),
      tareaDe(2, { responsableId: 5, fin: '2026-10-21' }),
      tareaDe(3, { responsableId: YO }),
      tareaDe(4, { responsableId: 5 }),
    ];
    const mias = armarParaOrdenar(entrada(tareas), MIAS);
    expect(ids(mias.vencidas)).toEqual([1]);
    expect(mias.vencidas[0]?.motivo).toBe('venció el 20/10');
    expect(ids(mias.sinFechas)).toEqual([3]);
    expect(mias.sinFechas[0]?.motivo).toBe('no tiene fechas');
    const todas = armarParaOrdenar(entrada(tareas), TODAS);
    expect(ids(todas.vencidas)).toEqual([1, 2]);
    expect(ids(todas.sinFechas)).toEqual([3, 4]);
    expect(ids(armarParaOrdenar(entrada(tareas), { persona: 5, proyectoId: null }).vencidas)).toEqual([2]);
  });

  it('sin asignar aparece con cualquier filtro de persona y respeta el de proyecto', () => {
    const tareas = [
      tareaDe(1, { proyectoId: 12, titulo: 'B', inicio: '2026-11-02' }),
      tareaDe(2, { proyectoId: 11, titulo: 'Z', inicio: '2026-11-02' }),
      tareaDe(3, { proyectoId: 11, titulo: 'A', inicio: '2026-11-02' }),
      tareaDe(4, { proyectoId: 11, tipoId: 2, inicio: '2026-11-02' }),
    ];
    const r = armarParaOrdenar(entrada(tareas), MIAS);
    expect(ids(r.sinAsignar)).toEqual([1, 3, 2]);
    expect(r.sinAsignar[0]?.motivo).toBe('sin responsable');
    expect(ids(armarParaOrdenar(entrada(tareas), { persona: 5, proyectoId: 11 }).sinAsignar)).toEqual([3, 2]);
  });

  it('excluye plantillas, archivados, cerradas y madres con hijas abiertas', () => {
    const catalogo: Catalogo = {
      ...CATALOGO,
      proyectos: [...CATALOGO.proyectos, { id: 13, nombre: 'Viejo', identificador: 'v', activo: false, estadoOp: null, estadoOpClave: null, descripcion: '' }],
      plantillas: [12],
    };
    const tareas = [
      tareaDe(1, { responsableId: YO, proyectoId: 12 }),
      tareaDe(2, { responsableId: YO, proyectoId: 13 }),
      tareaDe(3, { responsableId: YO, estadoId: 12 }),
      tareaDe(4, { responsableId: YO }),
      tareaDe(5, { responsableId: YO, madreId: 4 }),
      tareaDe(6, { responsableId: YO, fin: '2026-10-20', tipoId: 3 }),
      tareaDe(7, { responsableId: YO, fin: '2026-10-20', madreId: 6 }),
    ];
    const r = armarParaOrdenar(entrada(tareas, {}, catalogo), TODAS);
    expect(ids(r.sinFechas)).toEqual([5]);
    expect(ids(r.vencidas)).toEqual([7]);
    expect(r.sinAsignar).toEqual([]);
  });

  it('sobrecarga usa el primer período excedido y los mismos números que armarEquipo', () => {
    // Semana 26/10 al 1/11: entran 40 h (80 h la quincena, 160 h el mes); 5 tareas de 10 h suman 50 h y pasan la semana.
    const tareas = Array.from({ length: 5 }, (_, i) => tareaDe(i + 1, { responsableId: YO, estimacionHoras: 10, inicio: '2026-10-27', fin: '2026-10-27' }));
    const miembros: MiembroEquipo[] = [];
    const r = armarParaOrdenar(entrada(tareas, { miembros }), MIAS);
    expect(r.sobrecarga).toEqual([{ personaId: YO, periodo: 'semana', horas: 50, capacidad: 40 }]);
    const otra = armarParaOrdenar(entrada([tareaDe(1, { responsableId: 5, estimacionHoras: 10, inicio: '2026-10-27', fin: '2026-10-27' })]), TODAS);
    expect(otra.sobrecarga).toEqual([]);
  });

  it('sobrecarga: vos primero y después por nombre', () => {
    const grande = (id: number, quien: number): Tarea => tareaDe(id, { responsableId: quien, estimacionHoras: 50, inicio: '2026-10-27', fin: '2026-10-27' });
    const r = armarParaOrdenar(entrada([grande(1, 5), grande(2, YO)]), TODAS);
    expect(r.sobrecarga.map((s) => s.personaId)).toEqual([YO, 5]);
  });

  it('sucesora automática vencida apunta a la primera que se mueve', () => {
    const tareas = [
      tareaDe(1, { titulo: 'Relevamiento', programacionManual: true, inicio: '2026-10-05', fin: '2026-10-09' }),
      tareaDe(2, { programacionManual: false, responsableId: YO, inicio: '2026-10-12', fin: '2026-10-16' }),
    ];
    const r = armarParaOrdenar(entrada(tareas, { dependencias: [dep(1, 1, 2)] }), MIAS);
    expect(r.vencidas[0]).toMatchObject({ moverId: 1, motivo: 'se corre sola: mové «Relevamiento»' });
    const manual = armarParaOrdenar(entrada([tareaDe(3, { responsableId: YO, fin: '2026-10-20' })]), MIAS);
    expect(manual.vencidas[0]).toMatchObject({ moverId: null, motivo: 'venció el 20/10' });
  });

  it('cuentaMia no cuenta sin asignar ni repite una tarea que está en dos secciones', () => {
    const tareas = [
      tareaDe(1, { titulo: 'A', inicio: '2026-10-05', fin: '2026-10-09', responsableId: 5 }),
      tareaDe(2, { responsableId: YO, inicio: '2026-10-06', fin: '2026-10-08' }),
      tareaDe(3, { responsableId: YO }),
      tareaDe(4, { responsableId: null, inicio: '2026-11-02' }),
    ];
    const e = entrada(tareas, { dependencias: [dep(1, 1, 2)] });
    const r = armarParaOrdenar(e, MIAS);
    expect(ids(r.pisan)).toEqual([2]);
    expect(ids(r.vencidas)).toEqual([2]);
    expect(cuentaMia(e)).toBe(2);
    const cargada = entrada([...tareas, tareaDe(5, { responsableId: YO, estimacionHoras: 90, inicio: '2026-10-27', fin: '2026-10-27' })], { dependencias: [dep(1, 1, 2)] });
    expect(cuentaMia(cargada)).toBe(3);
  });
});

describe('armarParaOrdenar: casos de borde', () => {
  const cargaDe = (tareas: Tarea[], periodo: PeriodoCarga, persona = YO) =>
    armarEquipo(CATALOGO, tareas, [], AJUSTES.metricas, YO, HOY, null, periodo, new Set()).find((i) => i.persona.id === persona)?.carga;
  const horas = (id: number, h: number, dia: string, extra: Partial<Tarea> = {}): Tarea =>
    tareaDe(id, { responsableId: YO, estimacionHoras: h, inicio: dia, fin: dia, ...extra });

  it('sobrecarga salta a la quincena cuando la semana entra, con los números de Equipo', () => {
    // Semana 1 (26/10 al 1/11): 30 h de 40. Semana 2 (2/11 al 8/11): 60 h. Quincena: 90 h de 80.
    const tareas = [horas(1, 10, '2026-10-27'), horas(2, 10, '2026-10-28'), horas(3, 10, '2026-10-29'), horas(4, 60, '2026-11-03')];
    const carga = cargaDe(tareas, 'quincena')!;
    expect(cargaDe(tareas, 'semana')!.excedida).toBe(false);
    expect(carga.excedida).toBe(true);
    expect(armarParaOrdenar(entrada(tareas), MIAS).sobrecarga).toEqual([
      { personaId: YO, periodo: 'quincena', horas: carga.horas, capacidad: carga.capacidad },
    ]);
  });

  it('sobrecarga salta al mes cuando la semana y la quincena entran, con los números de Equipo', () => {
    // 10 h en la semana 1 y 170 h en la semana 3 (10/11): la quincena suma 10 h de 80 y el mes 180 h de 160.
    const tareas = [horas(1, 10, '2026-10-27'), horas(2, 170, '2026-11-10')];
    const carga = cargaDe(tareas, 'mes')!;
    expect(cargaDe(tareas, 'quincena')!.excedida).toBe(false);
    expect(carga.excedida).toBe(true);
    expect(armarParaOrdenar(entrada(tareas), MIAS).sobrecarga).toEqual([
      { personaId: YO, periodo: 'mes', horas: carga.horas, capacidad: carga.capacidad },
    ]);
  });

  it('los hitos no suman carga ni piden responsable', () => {
    const hito = tareaDe(1, { responsableId: YO, tipoId: 2, estimacionHoras: 500, inicio: '2026-10-27', fin: '2026-10-27' });
    const sinDueño = tareaDe(2, { tipoId: 2, inicio: '2026-10-27', fin: '2026-10-27' });
    const r = armarParaOrdenar(entrada([hito, sinDueño]), TODAS);
    expect(r.sobrecarga).toEqual([]);
    expect(r.sinAsignar).toEqual([]);
  });

  it('pisan: moverId solo en una sucesora automática, y orden por fecha', () => {
    const tareas = [
      tareaDe(1, { titulo: 'Base', inicio: '2026-10-26', fin: '2026-10-30', responsableId: 5 }),
      tareaDe(2, { titulo: 'Manual', inicio: '2026-10-29', fin: '2026-11-03', responsableId: YO }),
      tareaDe(3, { titulo: 'Automática', inicio: '2026-10-28', fin: '2026-11-03', responsableId: YO, programacionManual: false }),
    ];
    const r = armarParaOrdenar(entrada(tareas, { dependencias: [dep(1, 1, 2), dep(2, 1, 3)] }), MIAS);
    expect(ids(r.pisan)).toEqual([3, 2]);
    expect(r.pisan.map((f) => f.moverId)).toEqual([1, null]);
  });

  it('una madre con hija abierta no pide responsable, aunque la hija esté en otro proyecto', () => {
    const tareas = [
      tareaDe(1, { proyectoId: 11, inicio: '2026-11-02' }),
      tareaDe(2, { proyectoId: 12, madreId: 1, inicio: '2026-11-02' }),
    ];
    expect(ids(armarParaOrdenar(entrada(tareas), TODAS).sinAsignar)).toEqual([2]);
    expect(ids(armarParaOrdenar(entrada(tareas), { persona: 'todas', proyectoId: 11 }).sinAsignar)).toEqual([]);
  });
});
