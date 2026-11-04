import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { armarFilas, type OpcionesFilas } from './filas.js';
import { LineaDeTiempo } from './LineaDeTiempo.js';
import { ventanaDesde } from './modelo.js';
import type { CambiosLinea } from './useCambiosLinea.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const OPCIONES: OpcionesFilas = { vista: 'proyecto', soloConDependencias: false, proyectoId: null, personaId: null, plegados: new Set(), orden: {}, yoId: null, terminadasVisibles: new Set() };
const VENTANA = ventanaDesde('2026-10-12', 'mes', 1200);
const TAREAS: Tarea[] = [
  tareaDe(1, { titulo: 'A', proyectoId: 11, inicio: '2026-10-13', fin: '2026-10-16' }),
  tareaDe(2, { titulo: 'B', proyectoId: 11, inicio: '2026-10-20', fin: '2026-10-23' }),
  tareaDe(3, { titulo: 'C', proyectoId: 11, inicio: '2026-10-26', fin: '2026-10-28' }),
];

function dibujar(dependencias: Dependencia[] = [], ocupado = false) {
  const cambios = {
    guardar: async () => null, guardando: () => false, unir: vi.fn(async () => {}), avisar: vi.fn(), ocupado,
  } as unknown as CambiosLinea;
  const filas = armarFilas(TAREAS, dependencias, CATALOGO, VENTANA, OPCIONES);
  render(
    <LineaDeTiempo
      filas={filas} ventana={VENTANA} zoom="mes" tareas={TAREAS} dependencias={dependencias} catalogo={CATALOGO} hoy="2026-10-19"
      alAbrir={() => {}} feriados={new Map()} vacaciones={new Map()} alternarGrupo={() => {}} alternarTerminadas={() => {}} cambios={cambios}
    />,
  );
  return cambios;
}

const puntito = (id: number): HTMLElement => document.querySelector<HTMLElement>(`[data-unir="${id}"]`)!;
const renglon = (id: number): HTMLElement => document.querySelector<HTMLElement>(`[data-renglon-tarea="${id}"]`)!;
const temporal = (): Element | null => document.querySelector('.flecha--temporal');
/** Hace que el punto soltado caiga sobre el elemento dado (o sobre nada). */
const apuntarA = (el: Element | null) => { document.elementFromPoint = vi.fn(() => el); };

function arrastrar(desde: number, sobre: Element | null) {
  apuntarA(sobre);
  fireEvent.pointerDown(puntito(desde), { clientX: 100, clientY: 50, button: 0, pointerId: 1 });
  fireEvent.pointerMove(puntito(desde), { clientX: 300, clientY: 90, pointerId: 1 });
}

describe('unir arrastrando el puntito', () => {
  it('soltar sobre otra tarea la une: la de destino espera a la de origen', () => {
    const cambios = dibujar();
    arrastrar(1, renglon(2));
    expect(temporal()).not.toBeNull();
    fireEvent.pointerUp(puntito(1), { clientX: 300, clientY: 90, pointerId: 1 });
    expect(cambios.unir).toHaveBeenCalledWith(1, 2);
    expect(temporal()).toBeNull();
  });

  it('durante el arrastre el renglón de destino se marca como válido', () => {
    dibujar();
    arrastrar(1, renglon(2));
    expect(renglon(2)).toHaveAttribute('data-destino', 'si');
  });

  it('una unión que cerraría un círculo no escribe y avisa', () => {
    const cambios = dibujar([{ id: 9, predecesoraId: 2, sucesoraId: 1, lag: 0 }]);
    arrastrar(1, renglon(2));
    expect(renglon(2)).toHaveAttribute('data-destino', 'no');
    fireEvent.pointerUp(puntito(1), { clientX: 300, clientY: 90, pointerId: 1 });
    expect(cambios.unir).not.toHaveBeenCalled();
    expect(cambios.avisar).toHaveBeenCalledWith(expect.stringContaining('quedaría un círculo'));
  });

  it('soltar sobre la misma tarea no escribe ni avisa', () => {
    const cambios = dibujar();
    arrastrar(1, renglon(1));
    fireEvent.pointerUp(puntito(1), { clientX: 300, clientY: 90, pointerId: 1 });
    expect(cambios.unir).not.toHaveBeenCalled();
    expect(cambios.avisar).not.toHaveBeenCalled();
    expect(temporal()).toBeNull();
  });

  it('soltar fuera de todo renglón no escribe y no deja el trazo', () => {
    const cambios = dibujar();
    arrastrar(1, null);
    fireEvent.pointerUp(puntito(1), { clientX: 300, clientY: 90, pointerId: 1 });
    expect(cambios.unir).not.toHaveBeenCalled();
    expect(cambios.avisar).not.toHaveBeenCalled();
    expect(temporal()).toBeNull();
  });

  it('pointercancel no escribe y no deja el trazo', () => {
    const cambios = dibujar();
    arrastrar(1, renglon(2));
    fireEvent.pointerCancel(puntito(1), { pointerId: 1 });
    expect(cambios.unir).not.toHaveBeenCalled();
    expect(temporal()).toBeNull();
    expect(renglon(2)).not.toHaveAttribute('data-destino');
  });

  it('si el navegador le saca el puntero al puntito (lostpointercapture) no escribe y no deja el trazo', () => {
    const cambios = dibujar();
    arrastrar(1, renglon(2));
    expect(temporal()).not.toBeNull();
    fireEvent.lostPointerCapture(puntito(1), { pointerId: 1 });
    expect(cambios.unir).not.toHaveBeenCalled();
    expect(temporal()).toBeNull();
    expect(renglon(2)).not.toHaveAttribute('data-destino');
  });

  it('con otro cambio aplicándose el gesto no arranca', () => {
    dibujar([], true);
    arrastrar(1, renglon(2));
    expect(temporal()).toBeNull();
  });
});
