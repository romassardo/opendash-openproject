import { describe, expect, it } from 'vitest';
import type { Dependencia } from '../../compartido/tipos.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { tonoPara } from '../ui/tonos.js';
import { armarFilas, type Fila, type OpcionesFilas } from './filas.js';
import { topesDeFilas } from './medidas.js';
import { ventanaDesde } from './modelo.js';

// Ventana de Mes de 1200 px: 75 días desde el 12 de octubre.
const MES = ventanaDesde('2026-10-12', 'mes', 1200);
const OPCIONES: OpcionesFilas = { vista: 'proyecto', soloConDependencias: false, proyectoId: null, personaId: null, plegados: new Set(), orden: {}, yoId: null, terminadasVisibles: new Set() };
const dep = (id: number, predecesoraId: number, sucesoraId: number): Dependencia => ({ id, predecesoraId, sucesoraId, lag: 0 });
const f = (inicio: string, fin: string) => ({ inicio, fin });
const ids = (filas: Fila[]): Array<number | string> => filas.map((x) => ('tarea' in x ? x.tarea.id : x.clave));

describe('armarFilas por proyecto', () => {
  it('un encabezado y una fila por tarea, con su contenedor', () => {
    const filas = armarFilas([tareaDe(1, f('2026-10-19', '2026-10-20')), tareaDe(2, f('2026-10-21', '2026-10-22'))], [], CATALOGO, MES, OPCIONES);
    expect(filas[0]).toMatchObject({ tipo: 'encabezado', titulo: 'Portal de clientes', resumen: '2 abiertas' });
    expect(filas.slice(1)).toMatchObject([
      { tipo: 'tarea', nivel: 0, contenedor: '11:0', indice: 0, barra: { x: 7 * 16, ancho: 32 } },
      { tipo: 'tarea', nivel: 0, contenedor: '11:0', indice: 1 },
    ]);
  });

  it('los proyectos van por nombre y el resumen cuenta las sin fechas', () => {
    const filas = armarFilas([
      tareaDe(1, f('2026-10-19', '2026-10-20')), tareaDe(2),
      tareaDe(3, { proyectoId: 12, ...f('2026-10-19', '2026-10-20') }),
    ], [], CATALOGO, MES, OPCIONES);
    const enc = filas.filter((x) => x.tipo === 'encabezado');
    expect(enc.map((e) => [e.titulo, e.resumen])).toEqual([['Migración del ERP', '1 abierta'], ['Portal de clientes', '1 abierta · 1 sin fechas']]);
  });

  it('una madre con hijas es un grupo con avance y sus hijas bajan un nivel', () => {
    const filas = armarFilas([
      tareaDe(10, f('2026-10-19', '2026-10-30')),
      tareaDe(11, { madreId: 10, estadoId: 12, ...f('2026-10-19', '2026-10-21') }),
      tareaDe(12, { madreId: 10, ...f('2026-10-22', '2026-10-30') }),
    ], [], CATALOGO, MES, { ...OPCIONES, terminadasVisibles: new Set(['proyecto-11']) });
    expect(filas[1]).toMatchObject({ tipo: 'grupo', nivel: 0, abierto: true, avance: { hechas: 1, total: 2 }, contenedor: '11:0' });
    expect(filas.slice(2, 4)).toMatchObject([{ nivel: 1, contenedor: '11:10', indice: 0 }, { nivel: 1, contenedor: '11:10', indice: 1 }]);
  });

  it('con la madre plegada no salen las hijas', () => {
    const filas = armarFilas([
      tareaDe(10, f('2026-10-19', '2026-10-30')), tareaDe(11, { madreId: 10, ...f('2026-10-19', '2026-10-21') }),
    ], [], CATALOGO, MES, { ...OPCIONES, plegados: new Set([10]) });
    expect(filas).toHaveLength(2);
    expect(filas[1]).toMatchObject({ tipo: 'grupo', abierto: false });
  });

  it('una nieta tiene nivel 2', () => {
    const filas = armarFilas([
      tareaDe(10, f('2026-10-19', '2026-10-30')), tareaDe(11, { madreId: 10, ...f('2026-10-19', '2026-10-25') }),
      tareaDe(12, { madreId: 11, ...f('2026-10-19', '2026-10-21') }),
    ], [], CATALOGO, MES, OPCIONES);
    expect(filas.map((x) => ('nivel' in x ? x.nivel : 0))).toEqual([0, 0, 1, 2]);
    expect(filas[3]).toMatchObject({ tipo: 'tarea', contenedor: '11:11' });
  });

  it('con la madre sin fechas y la hija visible hay grupo sin barra', () => {
    const filas = armarFilas([tareaDe(10), tareaDe(11, { madreId: 10, ...f('2026-10-19', '2026-10-21') })], [], CATALOGO, MES, OPCIONES);
    expect(filas[1]).toMatchObject({ tipo: 'grupo', barra: null });
    expect(filas[2]).toMatchObject({ tipo: 'tarea', nivel: 1 });
  });

  it('una madre sin nada que dibujar no sale', () => {
    expect(armarFilas([tareaDe(10), tareaDe(11, { madreId: 10 })], [], CATALOGO, MES, OPCIONES)).toEqual([]);
  });

  it('usa el orden guardado e ignora ids que ya no están', () => {
    const tareas = [tareaDe(1, f('2026-10-19', '2026-10-20')), tareaDe(2, f('2026-10-21', '2026-10-22'))];
    const filas = armarFilas(tareas, [], CATALOGO, MES, { ...OPCIONES, orden: { '11:0': [99, 2, 1] } });
    expect(ids(filas.slice(1))).toEqual([2, 1]);
  });

  it('marca el conflicto en la sucesora', () => {
    const tareas = [tareaDe(1, f('2026-10-19', '2026-10-22')), tareaDe(2, f('2026-10-22', '2026-10-23'))];
    const filas = armarFilas(tareas, [dep(1, 1, 2)], CATALOGO, MES, OPCIONES);
    const conflictos = filas.flatMap((x) => (x.tipo === 'tarea' ? [x.barra.conflicto] : []));
    expect(conflictos).toEqual([false, true]);
  });
});

const persona = (id: number, nombre: string) => ({ id, nombre, login: nombre.toLowerCase(), email: null, avatarUrl: null });
const CAT = {
  ...CATALOGO,
  personas: [persona(5, 'Santiago'), persona(9, 'Ramiro'), persona(10, 'Pablo')],
  proyectos: CATALOGO.proyectos.map((p) => (p.id === 11 ? { ...p, nombre: 'Kiosco/Turnos' } : p.id === 12 ? { ...p, nombre: 'Intranet' } : p)),
};
const POR_PERSONA: OpcionesFilas = { ...OPCIONES, vista: 'persona', yoId: 9 };
const tipos = (filas: Fila[]) => filas.map((x) => x.tipo);
const claves = (filas: Fila[]) => filas.map((x) => x.clave);
const MADRE_AJENA = [
  tareaDe(87, { responsableId: 10, ...f('2026-10-19', '2026-10-30') }),
  tareaDe(88, { responsableId: 9, madreId: 87, ...f('2026-10-20', '2026-10-22') }),
];

describe('armarFilas por persona', () => {
  it('persona, proyecto, summary task, tarea, con la madre ajena', () => {
    const filas = armarFilas(MADRE_AJENA, [], CAT, MES, POR_PERSONA);
    const ramiro = filas.slice(0, filas.findIndex((x) => x.clave === 'persona-10'));
    expect(tipos(ramiro)).toEqual(['encabezado', 'proyecto', 'grupo', 'tarea']);
    expect(ramiro[2]).toMatchObject({ ajena: true, nivel: 0, tarea: { id: 87 } });
    expect(ramiro[3]).toMatchObject({ nivel: 1 });
    expect(claves(ramiro)).toEqual(['persona-9', 'persona-9:p11', 'persona-9:t87', 'persona-9:t88']);
  });

  it('la misma madre en dos franjas tiene claves distintas', () => {
    const filas = armarFilas(MADRE_AJENA, [], CAT, MES, POR_PERSONA);
    expect(claves(filas)).toContain('persona-9:t87');
    expect(claves(filas)).toContain('persona-10:t87');
    expect(new Set(claves(filas)).size).toBe(filas.length);
    expect(filas.find((x) => x.clave === 'persona-10:t87')).toMatchObject({ ajena: false });
  });

  it('plegar una madre la pliega en las dos franjas', () => {
    const tareas = [...MADRE_AJENA, tareaDe(89, { responsableId: 10, madreId: 87, ...f('2026-10-21', '2026-10-23') })];
    const abiertas = claves(armarFilas(tareas, [], CAT, MES, POR_PERSONA));
    expect(abiertas).toEqual(expect.arrayContaining(['persona-9:t88', 'persona-10:t89']));
    const filas = armarFilas(tareas, [], CAT, MES, { ...POR_PERSONA, plegados: new Set([87]) });
    expect(claves(filas)).not.toContain('persona-9:t88');
    expect(claves(filas)).not.toContain('persona-10:t89');
    expect(filas.filter((x) => x.tipo === 'grupo').map((x) => x.abierto)).toEqual([false, false]);
  });

  it('quien mira va primero y lleva esYo', () => {
    const tareas = [
      tareaDe(1, { responsableId: 5, ...f('2026-10-19', '2026-10-20') }), tareaDe(2, { responsableId: 9, ...f('2026-10-19', '2026-10-20') }),
      tareaDe(3, { responsableId: 10, ...f('2026-10-19', '2026-10-20') }), tareaDe(4, f('2026-10-19', '2026-10-20')),
    ];
    const enc = armarFilas(tareas, [], CAT, MES, POR_PERSONA).filter((x) => x.tipo === 'encabezado');
    expect(enc.map((e) => e.clave)).toEqual(['persona-9', 'persona-10', 'persona-5', 'sin-asignar']);
    expect(enc.map((e) => e.esYo)).toEqual([true, false, false, false]);
  });

  it('proyectos por nombre dentro de la franja', () => {
    const tareas = [
      tareaDe(1, { responsableId: 9, proyectoId: 11, ...f('2026-10-19', '2026-10-20') }),
      tareaDe(2, { responsableId: 9, proyectoId: 12, ...f('2026-10-19', '2026-10-20') }),
    ];
    const proyectos = armarFilas(tareas, [], CAT, MES, POR_PERSONA).filter((x) => x.tipo === 'proyecto');
    expect(proyectos.map((p) => p.titulo)).toEqual(['Intranet', 'Kiosco/Turnos']);
  });

  it('sin el asa de ordenar', () => {
    const filas = armarFilas(MADRE_AJENA, [], CAT, MES, POR_PERSONA);
    expect(filas.every((x) => !('contenedor' in x) || x.contenedor === null)).toBe(true);
  });

  it('con filtro de persona la madre ajena aparece con su barra', () => {
    const filas = armarFilas(MADRE_AJENA, [], CAT, MES, { ...POR_PERSONA, personaId: 9 });
    const madre = filas.find((x) => x.clave === 'persona-9:t87');
    expect(madre).toMatchObject({ tipo: 'grupo', ajena: true });
    expect(madre?.tipo === 'grupo' && madre.barra).not.toBeNull();
  });
});

describe('armarFilas: terminadas, resumen y Todas', () => {
  const cerrada = tareaDe(1, { responsableId: 9, estadoId: 12, ...f('2026-10-19', '2026-10-20') });
  const abierta = tareaDe(2, { responsableId: 9, ...f('2026-10-21', '2026-10-22') });

  it('plegadas no se dibujan y hay un renglón al final; con mostrar aparecen', () => {
    const plegadas = armarFilas([cerrada, abierta], [], CAT, MES, POR_PERSONA);
    expect(plegadas.some((x) => 'tarea' in x && x.tarea.id === 1)).toBe(false);
    expect(plegadas.at(-1)).toEqual({ tipo: 'terminadas', clave: 'terminadas:persona-9', franja: 'persona-9', cantidad: 1, visibles: false });
    const visibles = armarFilas([cerrada, abierta], [], CAT, MES, { ...POR_PERSONA, terminadasVisibles: new Set(['persona-9']) });
    expect(visibles.some((x) => 'tarea' in x && x.tarea.id === 1)).toBe(true);
    expect(visibles.at(-1)).toMatchObject({ tipo: 'terminadas', visibles: true });
  });

  it('una madre cerrada con algo abierto adentro sigue apareciendo', () => {
    const tareas = [
      tareaDe(10, { responsableId: 9, estadoId: 12, ...f('2026-10-19', '2026-10-30') }),
      tareaDe(11, { responsableId: 9, madreId: 10, ...f('2026-10-20', '2026-10-22') }),
    ];
    const filas = armarFilas(tareas, [], CAT, MES, OPCIONES);
    expect(filas.map((x) => x.tipo)).toEqual(['encabezado', 'grupo', 'tarea', 'terminadas']);
  });

  it('sin terminadas no hay renglón', () => {
    expect(armarFilas([abierta], [], CAT, MES, POR_PERSONA).some((x) => x.tipo === 'terminadas')).toBe(false);
  });

  it('las cerradas fuera de la ventana cuentan y, con mostrar, aparecen con una marca en el borde en vez de barra', () => {
    const tareas = [
      abierta,
      tareaDe(5, { responsableId: 9, estadoId: 12, ...f('2026-08-03', '2026-08-07') }),
      tareaDe(7, { responsableId: 9, estadoId: 12, ...f('2027-02-01', '2027-02-05') }),
      tareaDe(8, { responsableId: 9, estadoId: 12 }),
    ];
    const plegadas = armarFilas([...tareas, cerrada], [], CAT, MES, POR_PERSONA);
    expect(plegadas.at(-1)).toMatchObject({ tipo: 'terminadas', cantidad: 3 });
    expect(plegadas.some((x) => 'tarea' in x && x.tarea.estadoId === 12)).toBe(false);
    const visibles = armarFilas([...tareas, cerrada], [], CAT, MES, { ...POR_PERSONA, terminadasVisibles: new Set(['persona-9']) });
    const barraDe = (id: number) => visibles.flatMap((x) => (x.tipo === 'tarea' && x.tarea.id === id ? [x.barra] : []))[0];
    expect(barraDe(2)?.fuera).toBeNull();
    expect(barraDe(1)?.fuera).toBeNull();
    expect(barraDe(5)?.fuera).toEqual({ lado: 'antes', fecha: '2026-08-07' });
    expect(barraDe(7)?.fuera).toEqual({ lado: 'despues', fecha: '2027-02-01' });
    expect(barraDe(8)).toBeUndefined();
  });

  it('con mostrar, un proyecto que solo tiene terminadas fuera de la ventana también aparece en la franja de la persona', () => {
    const vieja = tareaDe(5, { proyectoId: 12, responsableId: 9, estadoId: 12, ...f('2026-08-03', '2026-08-07') });
    const filas = armarFilas([abierta, vieja], [], CAT, MES, { ...POR_PERSONA, terminadasVisibles: new Set(['persona-9']) });
    expect(filas.filter((x) => x.tipo === 'proyecto')).toHaveLength(2);
    expect(filas.some((x) => x.tipo === 'tarea' && x.tarea.id === 5)).toBe(true);
  });

  it('todas: con mostrar entran también las terminadas fuera de la ventana', () => {
    const vieja = tareaDe(5, { estadoId: 12, ...f('2026-08-03', '2026-08-07') });
    const filas = armarFilas([abierta, vieja], [], CAT, MES, { ...OPCIONES, vista: 'todas', terminadasVisibles: new Set(['todas']) });
    expect(ids(filas)).toEqual(['todas', 5, 2, 'terminadas:todas']);
  });

  it('el total respeta los filtros de arriba', () => {
    const deOtro = tareaDe(5, { responsableId: 3, estadoId: 12, ...f('2026-09-21', '2026-10-02') });
    const filas = armarFilas([abierta, deOtro], [], CAT, MES, { ...OPCIONES, personaId: 9 });
    expect(filas.some((x) => x.tipo === 'terminadas')).toBe(false);
  });

  it('resumen: abiertas y sin fechas', () => {
    const tareas = [abierta, tareaDe(3, { responsableId: 9, ...f('2026-10-21', '2026-10-22') }), tareaDe(4, { responsableId: 9 })];
    expect(armarFilas(tareas, [], CAT, MES, POR_PERSONA)[0]).toMatchObject({ resumen: '2 abiertas · 1 sin fechas' });
    expect(armarFilas([abierta], [], CAT, MES, POR_PERSONA)[0]).toMatchObject({ resumen: '1 abierta' });
  });

  it('por proyecto: el encabezado lleva proyectoId y tono, y la franja termina con sus terminadas', () => {
    const filas = armarFilas([cerrada, abierta], [], CAT, MES, OPCIONES, { 11: { color: 'rosa', icono: 'cohete' } });
    expect(filas[0]).toMatchObject({ tipo: 'encabezado', proyectoId: 11, tono: 'rosa', personaId: null });
    expect(filas.at(-1)).toMatchObject({ tipo: 'terminadas', franja: 'proyecto-11', cantidad: 1 });
  });

  it('todas: una sola franja, por fecha, con terminadas al final', () => {
    const filas = armarFilas([abierta, tareaDe(3, f('2026-10-19', '2026-10-20')), cerrada], [], CAT, MES, { ...OPCIONES, vista: 'todas' });
    expect(filas.filter((x) => x.tipo === 'encabezado')).toHaveLength(1);
    expect(ids(filas)).toEqual(['todas', 3, 2, 'terminadas:todas']);
  });

  it('Solo con dependencias deja las que tienen dependencias', () => {
    const tareas = [tareaDe(1, f('2026-10-21', '2026-10-22')), tareaDe(2, f('2026-10-23', '2026-10-24')), tareaDe(3, f('2026-10-19', '2026-10-20'))];
    const filas = armarFilas(tareas, [dep(1, 1, 2)], CAT, MES, { ...OPCIONES, vista: 'todas', soloConDependencias: true });
    expect(ids(filas.slice(1))).toEqual([1, 2]);
  });
});

describe('medidas: topesDeFilas', () => {
  it('suma los altos de cada tipo', () => {
    const t = tareaDe(1);
    const barra = { x: 0, ancho: 1, esHito: false, columna: 'nuevo', empiezaAntes: false, sigueHasta: null, sinInicio: false, sinFin: false, conflicto: false, fuera: null } as const;
    const filas: Fila[] = [
      { tipo: 'encabezado', clave: 'e', titulo: '', tono: null, personaId: null, proyectoId: null, esYo: false, resumen: '' },
      { tipo: 'proyecto', clave: 'p', proyectoId: 1, titulo: '', tono: 'azul' },
      { tipo: 'grupo', clave: 'g', tarea: t, nivel: 0, abierto: true, avance: { hechas: 0, total: 0 }, barra: null, contenedor: null, indice: 0, ajena: false },
      { tipo: 'tarea', clave: 't', tarea: t, nivel: 0, barra, contenedor: null, indice: 0 },
      { tipo: 'terminadas', clave: 'x', franja: 'f', cantidad: 1, visibles: false },
    ];
    expect(topesDeFilas(filas)).toEqual([0, 56, 86, 120, 154]);
  });
});


describe('armarFilas: geometría de la barra y qué se dibuja', () => {
  const barras = (filas: Fila[]) => filas.flatMap((x) => ('tarea' in x ? [x] : []));

  it('una tarea de 189 días entra entera en Trimestre y en Mes dice hasta cuándo sigue', () => {
    const larga = tareaDe(1, f('2026-10-19', '2027-04-25'));
    const trimestre = ventanaDesde('2026-10-12', 'trimestre', 1200);
    const [enTrimestre] = barras(armarFilas([larga], [], CATALOGO, trimestre, OPCIONES));
    expect(enTrimestre).toMatchObject({ barra: { x: 7 * 5, ancho: 189 * 5, sigueHasta: null, empiezaAntes: false } });
    const [enMes] = barras(armarFilas([larga], [], CATALOGO, MES, OPCIONES));
    expect(enMes).toMatchObject({ barra: { x: 7 * 16, ancho: (75 - 7) * 16, sigueHasta: '2027-04-25' } });
  });

  it('una tarea que empezó antes de la ventana queda cortada a la izquierda', () => {
    const [fila] = barras(armarFilas([tareaDe(1, f('2026-10-05', '2026-10-14'))], [], CATALOGO, MES, OPCIONES));
    expect(fila).toMatchObject({ barra: { x: 0, ancho: 3 * 16, empiezaAntes: true } });
  });

  it('las tareas fuera de la ventana no se dibujan', () => {
    const fuera = [tareaDe(1, f('2026-09-01', '2026-10-01')), tareaDe(2, f('2027-03-01', '2027-03-05'))];
    expect(armarFilas(fuera, [], CATALOGO, MES, OPCIONES)).toEqual([]);
  });

  it('una tarea con una sola fecha es una barra de un día con el otro lado abierto', () => {
    const [soloFin] = barras(armarFilas([tareaDe(1, { fin: '2026-10-21' })], [], CATALOGO, MES, OPCIONES));
    expect(soloFin).toMatchObject({ barra: { x: 9 * 16, ancho: 16, sinInicio: true, sinFin: false } });
    const [soloInicio] = barras(armarFilas([tareaDe(2, { inicio: '2026-10-21' })], [], CATALOGO, MES, OPCIONES));
    expect(soloInicio).toMatchObject({ barra: { x: 9 * 16, ancho: 16, sinInicio: false, sinFin: true } });
  });

  it('los hitos y las cerradas se dibujan, con su columna', () => {
    const filas = barras(armarFilas([tareaDe(1, { tipoId: 2, fin: '2026-10-21' }), tareaDe(2, { estadoId: 12, ...f('2026-10-19', '2026-10-20') })], [], CATALOGO, MES, { ...OPCIONES, terminadasVisibles: new Set(['proyecto-11']) }));
    expect(filas.map((x) => [x.tarea.id, x.barra?.esHito, x.barra?.columna])).toEqual([[2, false, 'cerrado'], [1, true, 'nuevo']]);
  });

  it('filtra por proyecto y por persona', () => {
    const tareas = [
      tareaDe(1, { responsableId: 9, ...f('2026-10-19', '2026-10-20') }),
      tareaDe(2, { proyectoId: 12, responsableId: 5, ...f('2026-10-19', '2026-10-20') }),
    ];
    const porProyecto = armarFilas(tareas, [], CATALOGO, MES, { ...OPCIONES, proyectoId: 12 });
    expect(porProyecto.filter((x) => x.tipo === 'encabezado').map((e) => e.titulo)).toEqual(['Migración del ERP']);
    const porPersona = armarFilas(tareas, [], CATALOGO, MES, { ...OPCIONES, personaId: 9 });
    expect(barras(porPersona).map((x) => x.tarea.id)).toEqual([1]);
  });

  it('el tono del encabezado sale del estilo del proyecto, o del tono estable', () => {
    const tareas = [tareaDe(1, f('2026-10-19', '2026-10-20'))];
    expect(armarFilas(tareas, [], CATALOGO, MES, OPCIONES, { 11: { color: 'rosa', icono: 'cohete' } })[0]).toMatchObject({ tono: 'rosa' });
    expect(armarFilas(tareas, [], CATALOGO, MES, OPCIONES)[0]).toMatchObject({ tono: tonoPara(11) });
  });

  it('Solo con dependencias por proyecto: una madre que no pasa el filtro y una hija que sí dejan un grupo sin barra', () => {
    const tareas = [
      tareaDe(10, f('2026-10-19', '2026-10-30')),
      tareaDe(11, { madreId: 10, ...f('2026-10-19', '2026-10-21') }),
      tareaDe(12, { madreId: 10, ...f('2026-10-22', '2026-10-23') }),
      tareaDe(13, f('2026-10-19', '2026-10-20')),
    ];
    const filas = armarFilas(tareas, [dep(1, 11, 13)], CATALOGO, MES, { ...OPCIONES, soloConDependencias: true });
    expect(filas[1]).toMatchObject({ tipo: 'grupo', barra: null });
    expect(ids(filas.slice(2))).toEqual([11, 13]);
  });

  it('una tarea recién creada se ve aunque los filtros la escondan', () => {
    const tareas = [
      tareaDe(1, f('2026-10-19', '2026-10-20')), tareaDe(2, f('2026-10-21', '2026-10-22')),
      tareaDe(3, { responsableId: 9, ...f('2026-10-26', '2026-10-30') }),
    ];
    const opciones = { ...OPCIONES, soloConDependencias: true, personaId: 4, siempreVisibles: new Set([3]) };
    expect(ids(armarFilas(tareas, [dep(1, 1, 2)], CATALOGO, MES, opciones))).toEqual(['proyecto-11', 3]);
  });

  it('una hija con fechas cuya madre no se dibuja sale igual, bajo su grupo', () => {
    const tareas = [
      tareaDe(1, { titulo: 'Madre sin fechas' }), tareaDe(2, { madreId: 1, ...f('2026-10-19', '2026-10-21') }),
      tareaDe(3, { titulo: 'Madre fuera', ...f('2027-03-01', '2027-03-05') }), tareaDe(4, { madreId: 3, ...f('2026-10-22', '2026-10-23') }),
    ];
    const filas = armarFilas(tareas, [], CATALOGO, MES, OPCIONES);
    expect(filas.filter((x) => x.tipo === 'grupo').map((g) => g.barra)).toEqual([null, null]);
    expect(barras(filas).filter((x) => x.tipo === 'tarea').map((x) => x.tarea.id).sort()).toEqual([2, 4]);
  });
});

describe('armarFilas: madres de otro proyecto y ciclos', () => {
  it('una tarea cuya madre es de otro proyecto es raíz de su propio proyecto y no deja encabezados vacíos', () => {
    const filas = armarFilas([
      tareaDe(10, { proyectoId: 12, ...f('2026-10-19', '2026-10-30') }),
      tareaDe(11, { proyectoId: 11, madreId: 10, ...f('2026-10-19', '2026-10-21') }),
    ], [], CATALOGO, MES, OPCIONES);
    expect(filas.filter((x) => x.tipo === 'encabezado').map((e) => e.clave)).toEqual(['proyecto-12', 'proyecto-11']);
    expect(filas).toMatchObject([
      { tipo: 'encabezado', clave: 'proyecto-12' }, { tipo: 'tarea', contenedor: '12:0' },
      { tipo: 'encabezado', clave: 'proyecto-11' }, { tipo: 'tarea', nivel: 0, contenedor: '11:0' },
    ]);
    expect(filas[1]).toMatchObject({ tarea: { id: 10 } });
    expect(filas[3]).toMatchObject({ tarea: { id: 11 } });
  });

  it('nunca hay un encabezado sin filas debajo', () => {
    const filas = armarFilas([
      tareaDe(10, { proyectoId: 12 }),
      tareaDe(11, { proyectoId: 11, madreId: 10, ...f('2026-10-19', '2026-10-21') }),
    ], [], CATALOGO, MES, OPCIONES);
    expect(ids(filas)).toEqual(['proyecto-11', 11]);
  });

  it('un ciclo de madres no cuelga ni hace desaparecer tareas', () => {
    const filas = armarFilas([
      tareaDe(1, { madreId: 2, ...f('2026-10-19', '2026-10-21') }),
      tareaDe(2, { madreId: 1, ...f('2026-10-22', '2026-10-23') }),
    ], [], CATALOGO, MES, OPCIONES);
    const tareas = filas.flatMap((x) => ('tarea' in x ? [x.tarea.id] : []));
    expect(tareas.sort()).toEqual([1, 2]);
  });
});
