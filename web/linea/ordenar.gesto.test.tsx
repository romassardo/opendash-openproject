import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Tarea } from '../../compartido/tipos.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { armarFilas, type OpcionesFilas } from './filas.js';
import { LineaDeTiempo } from './LineaDeTiempo.js';
import { ALTO_RENGLON } from './medidas.js';
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
  // Fuera de la ventana: no tiene renglón, pero su lugar en el orden se conserva.
  tareaDe(4, { titulo: 'D', proyectoId: 11, inicio: '2027-03-01', fin: '2027-03-05' }),
];

function dibujar(opciones: Partial<OpcionesFilas> = {}, ocupado = false) {
  const cambios = {
    guardar: async () => null, guardando: () => false, unir: vi.fn(async () => {}), avisar: vi.fn(), ordenar: vi.fn(async () => {}), ocupado,
  } as unknown as CambiosLinea;
  const o = { ...OPCIONES, ...opciones };
  const filas = armarFilas(TAREAS, [], CATALOGO, VENTANA, o);
  render(
    <LineaDeTiempo
      filas={filas} ventana={VENTANA} zoom="mes" tareas={TAREAS} dependencias={[]} catalogo={CATALOGO} hoy="2026-10-19"
      alAbrir={() => {}} feriados={new Map()} vacaciones={new Map()} alternarGrupo={() => {}} alternarTerminadas={() => {}} cambios={cambios} orden={o.orden}
    />,
  );
  return cambios;
}

const asa = (id: number): HTMLElement => document.querySelector<HTMLElement>(`[data-orden="${id}"]`)!;

describe('ordenar con el asa', () => {
  it('Alt+↓ sobre la primera manda el orden con las dos primeras intercambiadas (y la que no se ve sigue incluida)', () => {
    const cambios = dibujar();
    fireEvent.keyDown(asa(1), { key: 'ArrowDown', altKey: true });
    expect(cambios.ordenar).toHaveBeenCalledWith('11:0', [2, 1, 3, 4]);
  });

  it('con una tarea oculta en el medio del contenedor, mover una visible la conserva en su lugar relativo', () => {
    // D (fuera de la ventana) está entre A y B.
    const cambios = dibujar({ orden: { '11:0': [1, 4, 2, 3] } });
    fireEvent.keyDown(asa(1), { key: 'ArrowDown', altKey: true });
    // A pasa detrás de B; D sigue delante de B y C, donde estaba respecto de ellas.
    expect(cambios.ordenar).toHaveBeenCalledWith('11:0', [4, 2, 1, 3]);
  });

  it('soltar antes de la primera visible deja a la oculta que la precedía en su sitio', () => {
    const cambios = dibujar({ orden: { '11:0': [4, 1, 2, 3] } });
    fireEvent.pointerDown(asa(3), { clientX: 10, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(asa(3), { clientX: 10, clientY: 300 - 2 * ALTO_RENGLON, pointerId: 1 });
    fireEvent.pointerUp(asa(3), { clientX: 10, clientY: 300 - 2 * ALTO_RENGLON, pointerId: 1 });
    expect(cambios.ordenar).toHaveBeenCalledWith('11:0', [4, 3, 1, 2]);
  });

  it('Alt+↑ sobre la primera no hace nada', () => {
    const cambios = dibujar();
    fireEvent.keyDown(asa(1), { key: 'ArrowUp', altKey: true });
    expect(cambios.ordenar).not.toHaveBeenCalled();
  });

  it('arrastrar el asa dos renglones hacia abajo manda el orden nuevo', () => {
    const cambios = dibujar();
    fireEvent.pointerDown(asa(1), { clientX: 10, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(asa(1), { clientX: 10, clientY: 100 + 2 * ALTO_RENGLON, pointerId: 1 });
    expect(document.querySelector('.renglon--levantado')).not.toBeNull();
    fireEvent.pointerUp(asa(1), { clientX: 10, clientY: 100 + 2 * ALTO_RENGLON, pointerId: 1 });
    expect(cambios.ordenar).toHaveBeenCalledWith('11:0', [2, 3, 1, 4]);
    expect(document.querySelector('.renglon--levantado')).toBeNull();
  });

  it('pointercancel no manda nada y suelta el renglón', () => {
    const cambios = dibujar();
    fireEvent.pointerDown(asa(1), { clientX: 10, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(asa(1), { clientX: 10, clientY: 200, pointerId: 1 });
    fireEvent.pointerCancel(asa(1), { pointerId: 1 });
    expect(cambios.ordenar).not.toHaveBeenCalled();
    expect(document.querySelector('.renglon--levantado')).toBeNull();
  });

  it('si el navegador le saca el puntero al asa (lostpointercapture) no manda nada y suelta el renglón', () => {
    const cambios = dibujar();
    fireEvent.pointerDown(asa(1), { clientX: 10, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(asa(1), { clientX: 10, clientY: 200, pointerId: 1 });
    expect(document.querySelector('.renglon--levantado')).not.toBeNull();
    fireEvent.lostPointerCapture(asa(1), { pointerId: 1 });
    expect(cambios.ordenar).not.toHaveBeenCalled();
    expect(document.querySelector('.renglon--levantado')).toBeNull();
    // Y se puede empezar otro gesto enseguida.
    fireEvent.pointerDown(asa(2), { clientX: 10, clientY: 100, button: 0, pointerId: 2 });
    fireEvent.pointerMove(asa(2), { clientX: 10, clientY: 140, pointerId: 2 });
    expect(document.querySelector('.renglon--levantado')).not.toBeNull();
  });

  it('soltar sin mover no manda nada', () => {
    const cambios = dibujar();
    fireEvent.pointerDown(asa(2), { clientX: 10, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(asa(2), { clientX: 10, clientY: 100, pointerId: 1 });
    expect(cambios.ordenar).not.toHaveBeenCalled();
  });

  it('con otro gesto aplicándose no arranca', () => {
    const cambios = dibujar({}, true);
    fireEvent.pointerDown(asa(1), { clientX: 10, clientY: 100, button: 0, pointerId: 1 });
    expect(document.querySelector('.renglon--levantado')).toBeNull();
    fireEvent.keyDown(asa(1), { key: 'ArrowDown', altKey: true });
    expect(cambios.ordenar).not.toHaveBeenCalled();
  });

  it('en Por persona no hay botones «Ordenar …»', () => {
    dibujar({ vista: 'persona' });
    expect(document.querySelector('[aria-label^="Ordenar"]')).toBeNull();
  });
});
