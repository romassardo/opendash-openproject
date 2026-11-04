import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DndContextProps, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { EstadoHoras, Tramo } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { abrirDetalle, CONCILIACION, panel } from '../../pruebas/fabricas/detalle.js';
import { falla, limpiarEntorno, ok, prepararEntorno, simularApi, TAREAS } from '../../pruebas/fabricas/web.js';

// Se espían el inicio y el fin de arrastre del tablero para comprobar que el ▶ no los dispara.
const dnd = vi.hoisted(() => ({
  alIniciar: null as ((evento: DragStartEvent) => void) | null,
  alTerminar: null as ((evento: DragEndEvent) => void) | null,
}));
vi.mock('@dnd-kit/core', async (original) => {
  const real = await original<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...real,
    DndContext: (props: DndContextProps) => {
      // Los manejadores reales siguen andando: los espías se cuelgan encima.
      return createElement(real.DndContext, {
        ...props,
        onDragStart: (evento: DragStartEvent) => { dnd.alIniciar?.(evento); props.onDragStart?.(evento); },
        onDragEnd: (evento: DragEndEvent) => { dnd.alTerminar?.(evento); return props.onDragEnd?.(evento); },
      });
    },
  };
});

afterEach(() => {
  dnd.alIniciar = null;
  dnd.alTerminar = null;
  cleanup();
  limpiarEntorno();
});

const tramo = (extra: Partial<Tramo> = {}): Tramo => ({
  id: 1, usuarioId: 9, tareaId: 1, dia: '2026-10-23', inicio: '2026-10-23T12:00:00Z', fin: null, pausado: false, segundos: null,
  frenadoSolo: null, avisoVisto: false, estado: 'abierto', entradaOpId: null, motivo: null, ...extra,
});
const corriendo = (): EstadoHoras => ({
  enMarcha: [{ ...tramo(), segundosVivos: 125 }], hoy: [], avisos: [], totalHoySegundos: 125, jornadaSegundos: 28800, variasALaVez: false, horasExtra: false, ultimoDia: null,
});

describe('Horas en el panel', () => {
  it('el panel muestra Trabajar en esta, lo estimado y lo trabajado', async () => {
    abrirDetalle('/tareas/1', {
      'GET /api/tareas/1': ok({ tarea: { ...TAREAS[0]!, lockVersion: 3, estimacionHoras: 5, horasReales: 3 + 1 / 3 }, actividades: [] }),
    });
    const dialogo = await panel('T1');
    expect(await within(dialogo).findByRole('button', { name: /Trabajar en esta/ })).toBeInTheDocument();
    const horas = within(dialogo).getByRole('group', { name: 'Horas de la tarea' });
    expect(horas).toHaveTextContent('Estimado5 h');
    expect(horas).toHaveTextContent('Trabajado3 h 20 m · 67 %');
  });

  it('una tarea cerrada no tiene ▶', async () => {
    abrirDetalle('/tareas/8', {
      'GET /api/tareas/8': ok({ tarea: { ...CONCILIACION, estadoId: 12 }, actividades: [] }),
    });
    const dialogo = await panel();
    await within(dialogo).findByRole('textbox', { name: 'Título' });
    expect(within(dialogo).queryByRole('button', { name: /Trabajar en esta/ })).not.toBeInTheDocument();
  });
});

describe('Horas en el tablero y la lista', () => {
  it('el ▶ de la tarjeta no abre el panel ni arrastra', async () => {
    prepararEntorno('/tareas');
    const api = simularApi({});
    render(<App />);
    const usuario = userEvent.setup();
    const region = await screen.findByRole('region', { name: 'Nuevo' });
    await within(region).findByText('T1');
    const jugar = within(region).getByRole('button', { name: 'Trabajar en esta: T1' });
    const finDeArrastre = vi.fn();
    const inicioDeArrastre = vi.fn();
    dnd.alIniciar = inicioDeArrastre;
    dnd.alTerminar = finDeArrastre;
    // Lo que arma un arrastre (puntero abajo, Enter/Espacio del teclado) muere en el ▶.
    fireEvent.pointerDown(jugar);
    fireEvent.keyDown(jugar, { key: 'Enter', code: 'Enter' });
    fireEvent.keyUp(jugar, { key: 'Enter', code: 'Enter' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(inicioDeArrastre).not.toHaveBeenCalled();
    expect(finDeArrastre).not.toHaveBeenCalled();
    await usuario.click(jugar);
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/horas', cuerpo: { tareaId: 1 } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(finDeArrastre).not.toHaveBeenCalled();
  });

  it('la tarjeta que corre lo dice en su nombre accesible', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/horas': ok(corriendo()) });
    render(<App />);
    const region = await screen.findByRole('region', { name: 'Nuevo' });
    await within(region).findByText('T1');
    await waitFor(() => expect(within(region).getByRole('button', { name: /Tarea T1.*trabajando ahora/ })).toBeInTheDocument());
  });

  it('si trabajar falla, el error se ve junto al ▶', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'POST /api/horas': falla(500, 'interno', 'No se pudo arrancar el cronómetro') });
    render(<App />);
    const usuario = userEvent.setup();
    const region = await screen.findByRole('region', { name: 'Nuevo' });
    await within(region).findByText('T1');
    await usuario.click(within(region).getByRole('button', { name: 'Trabajar en esta: T1' }));
    const alerta = await within(region).findByRole('alert');
    expect(alerta).toHaveTextContent('No se pudo arrancar el cronómetro');
    expect(alerta).not.toHaveClass('sr-only');
  });

  it('la fila de la lista muestra el reloj si la tarea corre', async () => {
    prepararEntorno('/tareas');
    localStorage.setItem('od:vista-tareas', 'lista');
    simularApi({ 'GET /api/horas': ok(corriendo()) });
    render(<App />);
    // «T1» también está en la isla del reloj: se toma el de la fila.
    const fila = (await screen.findAllByText('T1')).map((t) => t.closest('li')).find((li) => li !== null)!;
    expect(await within(fila).findByRole('timer')).toHaveTextContent('0:02:05');
    expect(within(fila).queryByRole('button', { name: /Trabajar en esta/ })).not.toBeInTheDocument();
  });
});
