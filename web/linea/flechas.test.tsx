import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Dependencia } from '../../compartido/tipos.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { anclajes, Flechas } from './Flechas.js';
import { armarFilas, type OpcionesFilas } from './filas.js';
import { topesDeFilas } from './medidas.js';
import { ventanaDesde } from './modelo.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const dep: Dependencia = { id: 7, predecesoraId: 1, sucesoraId: 2, lag: 0 };

function dibujar(alSoltar?: (d: Dependencia) => void) {
  const tareas = [
    tareaDe(1, { titulo: 'A', inicio: '2026-10-13', fin: '2026-10-16' }),
    tareaDe(2, { titulo: 'B', inicio: '2026-10-20', fin: '2026-10-23' }),
  ];
  const ventana = ventanaDesde('2026-10-12', 'mes', 1200);
  const filas = armarFilas(tareas, [dep], CATALOGO, ventana, { vista: 'proyecto', soloConDependencias: false, proyectoId: null, personaId: null, plegados: new Set(), orden: {}, yoId: null, terminadasVisibles: new Set() });
  return render(<Flechas filas={filas} topes={topesDeFilas(filas)} tareas={tareas} dependencias={[dep]} catalogo={CATALOGO} ancho={1200} enfoque={null} alSoltar={alSoltar} />);
}

describe('Flechas: soltar una unión', () => {
  it('al pasar el mouse muestra la × y al tocarla suelta la unión', () => {
    const alSoltar = vi.fn();
    const { container } = dibujar(alSoltar);
    fireEvent.mouseEnter(container.querySelector('g[data-de="1"][data-a="2"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Soltar la unión de «A» a «B»' }));
    expect(alSoltar).toHaveBeenCalledWith(dep);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('la × se esconde 400 ms después de salir', () => {
    vi.useFakeTimers();
    const { container } = dibujar(() => {});
    const g = container.querySelector('g[data-de="1"][data-a="2"]')!;
    fireEvent.mouseEnter(g);
    fireEvent.mouseLeave(g);
    expect(screen.queryByRole('button')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(450); });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sin alSoltar no hay ningún botón', () => {
    const { container } = dibujar();
    fireEvent.mouseEnter(container.querySelector('g[data-de="1"][data-a="2"]')!);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

const OPC: OpcionesFilas = { vista: 'proyecto', soloConDependencias: false, proyectoId: null, personaId: null, plegados: new Set(), orden: {}, yoId: null, terminadasVisibles: new Set() };
const VENTANA = ventanaDesde('2026-10-12', 'mes', 1200);

describe('anclajes', () => {
  it('saltea los renglones de proyecto, de terminadas y los grupos ajenos', () => {
    const tareas = [
      tareaDe(87, { responsableId: 10, inicio: '2026-10-19', fin: '2026-10-30' }),
      tareaDe(88, { responsableId: 9, madreId: 87, inicio: '2026-10-20', fin: '2026-10-22' }),
      tareaDe(89, { responsableId: 9, estadoId: 12, inicio: '2026-10-20', fin: '2026-10-22' }),
    ];
    const filas = armarFilas(tareas, [], CATALOGO, VENTANA, { ...OPC, vista: 'persona', yoId: 9 });
    expect(filas.map((x) => x.tipo)).toContain('proyecto');
    expect(filas.map((x) => x.tipo)).toContain('terminadas');
    const puntos = anclajes(filas, topesDeFilas(filas));
    expect(puntos.has(88)).toBe(true);
    expect(puntos.has(87)).toBe(true); // la 87 es propia en la franja de quien la tiene
    expect([...puntos.keys()].sort()).toEqual([87, 88]);
  });

  it('una dependencia hacia una cerrada escondida no dibuja flecha', () => {
    const tareas = [
      tareaDe(1, { titulo: 'A', inicio: '2026-10-13', fin: '2026-10-16', estadoId: 12 }),
      tareaDe(2, { titulo: 'B', inicio: '2026-10-20', fin: '2026-10-23' }),
    ];
    const filas = armarFilas(tareas, [dep], CATALOGO, VENTANA, OPC);
    const { container } = render(<Flechas filas={filas} topes={topesDeFilas(filas)} tareas={tareas} dependencias={[dep]} catalogo={CATALOGO} ancho={1200} enfoque={null} />);
    expect(container.querySelector('g[data-de="1"][data-a="2"]')).toBeNull();
  });
});
