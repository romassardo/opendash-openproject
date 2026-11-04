import { describe, expect, it } from 'vitest';
import type { Catalogo, Tarea } from '../../../compartido/tipos.js';
import type { IntegranteEquipo } from '../../equipo/equipo.js';
import { calcularMetricas } from '../logica.js';
import { hojaAbiertas, hojaCompletadas } from './hojasTareas.js';
import { hojaCarga, hojaPorDia, hojaResumen } from './hojasResumen.js';
import { libroMetricas, nombreExcel, type DatosLibro } from './libro.js';
import type { Celda, Hoja } from './modelo.js';

const HOY = '2026-10-22';
const catalogo: Catalogo = {
  estados: [
    { id: 1, nombre: 'Nuevo', cerrado: false, color: '#000' },
    { id: 2, nombre: 'Cerrado', cerrado: true, color: '#000' },
  ],
  tipos: [
    { id: 1, nombre: 'Tarea', esHito: false, color: '#000' },
    { id: 2, nombre: 'Hito', esHito: true, color: '#000' },
  ],
  prioridades: [{ id: 1, nombre: 'Normal', alta: false, nivel: null }],
  proyectos: [{ id: 10, nombre: 'Alfa', identificador: 'alfa', activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' }],
  versiones: [],
  personas: [{ id: 5, nombre: 'Ana', login: null, email: null, avatarUrl: null }],
  asignables: {},
  semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [], plantillas: [],
  tablero: { nuevo: 1, curso: null, pausa: null, cerrado: 2 },
};

const tarea = (id: number, resto: Partial<Tarea> = {}): Tarea => ({
  id, lockVersion: 1, titulo: `Tarea ${id}`, descripcion: '', proyectoId: 10, tipoId: 1, estadoId: 2, prioridadId: 1,
  responsableId: 5, autorId: null, inicio: null, fin: null, estimacionHoras: null, horasReales: null, restanteHoras: null, porcentaje: null, madreId: null,
  versionId: null, programacionManual: false, creada: '2026-10-10T12:00:00-03:00', actualizada: '2026-10-20T12:00:00-03:00',
  cerradaEl: '2026-10-20T12:00:00-03:00', comentarios: null, ...resto,
});

const valores = (hoja: Hoja): Celda['valor'][][] => hoja.filas.map((fila) => fila.map((c) => c.valor));
const nombres = (hojas: Hoja[]): string[] => hojas.map((h) => h.nombre);

describe('hojaCompletadas', () => {
  it('ordena por cierre, deja vacío lo que falta y no convierte un título en fórmula', () => {
    const tareas = [
      tarea(2, { cerradaEl: '2026-10-21T12:00:00-03:00', responsableId: null, proyectoId: 99, titulo: '=SUMA(A1)', fin: '2026-10-21' }),
      tarea(1, { cerradaEl: '2026-10-20T12:00:00-03:00', fin: '2026-10-19', estimacionHoras: 3 }),
    ];
    const hoja = hojaCompletadas(tareas, catalogo, 30, HOY);
    const filas = valores(hoja);
    expect(hoja.nombre).toBe('Completadas');
    expect(hoja.filasFijas).toBe(1);
    expect(filas[0]).toEqual(['Tarea', 'Título', 'Proyecto', 'Tipo', 'Responsable', 'Creada', 'Cerrada', 'Fin', 'Horas estimadas', 'A tiempo', 'Ciclo (días)']);
    expect(filas.map((f) => f[0])).toEqual(['Tarea', 1, 2]);
    expect(filas[1]?.[9]).toBe('No');
    expect(filas[2]?.[1]).toBe('=SUMA(A1)');
    expect(typeof filas[2]?.[1]).toBe('string');
    expect(filas[2]?.[2]).toBeNull();
    expect(filas[2]?.[4]).toBeNull();
    expect(filas[2]?.[9]).toBe('Sí');
    expect(filas[1]?.[8]).toBe(3);
    expect(filas[1]?.[10]).toBe(10);
    expect(hoja.filtro).toEqual({ fila: 1, columnas: 11 });
  });

  it('sin fin deja «A tiempo» vacío y deja fuera hitos, abiertas y las de otro período', () => {
    const tareas = [
      tarea(1),
      tarea(2, { tipoId: 2 }),
      tarea(3, { estadoId: 1, cerradaEl: null }),
      tarea(4, { cerradaEl: '2026-01-01T12:00:00-03:00' }),
    ];
    const filas = valores(hojaCompletadas(tareas, catalogo, 30, HOY));
    expect(filas).toHaveLength(2);
    expect(filas[1]?.[9]).toBeNull();
  });

  it('sin cerradas queda solo el encabezado', () => {
    expect(hojaCompletadas([], catalogo, 30, HOY).filas).toHaveLength(1);
  });
});

describe('hojaAbiertas', () => {
  it('incluye hitos abiertos, excluye cerradas y ordena por atraso', () => {
    const tareas = [
      tarea(1, { estadoId: 1, cerradaEl: null }),
      tarea(2, { estadoId: 1, cerradaEl: null, fin: '2026-10-21' }),
      tarea(3, { estadoId: 1, cerradaEl: null, tipoId: 2, fin: '2026-10-30' }),
      tarea(4),
    ];
    const hoja = hojaAbiertas(tareas, catalogo, HOY);
    const filas = valores(hoja);
    expect(filas[0]).toEqual(['Tarea', 'Título', 'Proyecto', 'Tipo', 'Estado', 'Prioridad', 'Responsable', 'Inicio', 'Fin', 'Horas estimadas', '% hecho', 'Días de atraso']);
    expect(filas.map((f) => f[0])).toEqual(['Tarea', 2, 3, 1]);
    expect(filas[1]?.[11]).toBe(1);
    expect(filas[2]?.[11]).toBeNull();
    expect(filas[3]?.[8]).toBeNull();
    expect(filas[2]?.[3]).toBe('Hito');
    expect(hoja.filtro).toEqual({ fila: 1, columnas: 12 });
  });
});

const integrante = (resto: Partial<IntegranteEquipo['ajuste']> = {}, capacidad = 40, horas = 20): IntegranteEquipo => ({
  persona: catalogo.personas[0]!, presencia: 'conectado', rol: 'Dev', capacidad,
  carga: { personaId: 5, horas, capacidad, excedida: horas > capacidad, abiertas: 2, largas: [] },
  ajuste: { capacidad, feriados: ['2026-10-21'], vacaciones: [{ desde: '2026-10-19', hasta: '2026-10-20' }], horasReunion: 4, sinCalendario: false, ...resto },
  vacaciones: [], trabajandoEn: [], esYo: false,
});

describe('hojaCarga', () => {
  it('arma título, intervalo y fila de la persona', () => {
    const hoja = hojaCarga([integrante()], 'quincena', HOY, true);
    const filas = valores(hoja);
    expect(hoja.filasFijas).toBe(4);
    expect(filas[0]?.[0]).toBe('Carga de esta semana y la próxima');
    expect(filas[3]).toHaveLength(11);
    expect(filas[4]).toEqual(['Ana', 'Dev', 40, 40, 1, 2, 4, 20, 50, 2, 'No']);
    expect(hoja.filtro).toEqual({ fila: 4, columnas: 11 });
  });

  it('capacidad 0 deja Carga (%) vacía', () => {
    const sinCapacidad = integrante();
    const filas = valores(hojaCarga([{ ...sinCapacidad, carga: { ...sinCapacidad.carga, capacidad: 0 } }], 'semana', HOY, true));
    expect(filas[4]?.[8]).toBeNull();
  });

  it('reuniones: apagado, sin calendario y con horas', () => {
    expect(valores(hojaCarga([integrante()], 'semana', HOY, false))[4]?.[6]).toBeNull();
    expect(valores(hojaCarga([integrante({ sinCalendario: true, horasReunion: null })], 'semana', HOY, true))[4]?.[6]).toBe('Sin calendario');
  });
});

describe('hojaResumen y hojaPorDia', () => {
  const ahora = new Date('2026-10-22T15:00:00Z');
  const metricas = calcularMetricas(
    [tarea(1), tarea(2), tarea(3, { cerradaEl: '2026-09-20T12:00:00-03:00' })], catalogo, [], 30, HOY,
  );

  it('indicadores con diferencia y sin foco', () => {
    const hoja = hojaResumen(metricas, 30, HOY, ahora, (id) => `P${id}`);
    const filas = valores(hoja);
    expect(hoja.filasFijas).toBe(0);
    expect(filas[0]?.[0]).toBe('Métricas de OpenDash');
    expect(filas[1]).toEqual(['Período', 'Últimos 30 días']);
    expect(filas).toContainEqual(['Completadas', 2, 1, 1]);
    expect(filas.find((f) => f[0] === 'A tiempo (%)')?.[3]).toBeNull();
    expect(filas).toContainEqual(['P10', 2, 100]);
    expect(JSON.stringify(filas).toLowerCase()).not.toContain('foco');
  });

  it('Por día tiene una fila por día más el encabezado', () => {
    const hoja = hojaPorDia(metricas);
    expect(hoja.filas).toHaveLength(metricas.ritmo.length + 1);
    expect(valores(hoja)[0]).toEqual(['Día', 'Cerradas', 'Cerradas en el período anterior']);
    expect(hoja.filtro).toEqual({ fila: 1, columnas: 3 });
  });
});

describe('libroMetricas', () => {
  const datos = (tareas: Tarea[]): DatosLibro => ({
    metricas: calcularMetricas(tareas, catalogo, [], 30, HOY),
    tareas, catalogo, integrantes: [integrante()], periodo: 30, periodoCarga: 'semana', restarReuniones: true,
    hoy: HOY, generado: new Date('2026-10-22T15:00:00Z'), nombreProyecto: (id) => `P${id}`,
  });

  it('devuelve las cinco hojas en orden, también sin cerradas', () => {
    const hojas = libroMetricas(datos([]));
    expect(nombres(hojas)).toEqual(['Resumen', 'Completadas', 'Abiertas', 'Carga', 'Por día']);
    expect(hojas[1]?.filas).toHaveLength(1);
  });

  it('nombra el archivo con período y día', () => {
    expect(nombreExcel(30, HOY)).toBe('opendash-metricas-30d-2026-10-22.xlsx');
  });
});
