import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { bloquearFondo } from './inerte.js';
import { MS_AVISO, ProveedorAvisos, useAvisos, type Avisos } from './avisos.js';

let avisos: Avisos;
function Sonda() {
  avisos = useAvisos();
  return null;
}
const montar = () => render(<ProveedorAvisos><Sonda /></ProveedorAvisos>);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('aviso flotante único', () => {
  it('muestra el texto y la acción y se va a los 7 s', () => {
    montar();
    act(() => avisos.avisar({ texto: 'Cerraste «X».', accion: { etiqueta: 'Deshacer', alHacer: () => undefined } }));
    expect(screen.getByText('Cerraste «X».')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeTruthy();
    expect(MS_AVISO).toBe(7000);
    act(() => { vi.advanceTimersByTime(MS_AVISO - 1); });
    expect(screen.queryByText('Cerraste «X».')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText('Cerraste «X».')).toBeNull();
  });

  it('un aviso nuevo reemplaza al anterior y su acción', () => {
    montar();
    const primera = vi.fn();
    const segunda = vi.fn();
    act(() => avisos.avisar({ texto: 'Uno', accion: { etiqueta: 'Deshacer', alHacer: primera } }));
    act(() => avisos.avisar({ texto: 'Dos', accion: { etiqueta: 'Deshacer', alHacer: segunda } }));
    expect(screen.queryByText('Uno')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Deshacer' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(primera).not.toHaveBeenCalled();
    expect(segunda).toHaveBeenCalledOnce();
  });

  it('un error sin acción no se va solo', () => {
    montar();
    act(() => avisos.avisar({ texto: 'Falló', error: true }));
    act(() => { vi.advanceTimersByTime(MS_AVISO * 3); });
    expect(screen.queryByText('Falló')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByText('Falló')).toBeNull();
  });

  it('al tocar la acción corre alHacer una sola vez y el botón desaparece', async () => {
    montar();
    const alHacer = vi.fn(() => new Promise<void>(() => undefined));
    act(() => avisos.avisar({ texto: 'Listo', accion: { etiqueta: 'Deshacer', alHacer } }));
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(alHacer).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
    // Mientras la acción sigue en camino el reloj no corre.
    act(() => { vi.advanceTimersByTime(MS_AVISO * 2); });
    expect(screen.queryByText('Listo')).not.toBeNull();
  });

  it('si la acción termina sin publicar otro aviso, el aviso vuelve a su reloj y se va', async () => {
    montar();
    const alHacer = vi.fn(async () => undefined);
    act(() => avisos.avisar({ texto: 'No se corrió', error: true, accion: { etiqueta: 'Abrir', alHacer } }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abrir' })); });
    expect(screen.queryByText('No se corrió')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(MS_AVISO); });
    expect(screen.queryByText('No se corrió')).toBeNull();
  });

  it('si la acción publica otro aviso, ese no se apaga antes de tiempo', async () => {
    montar();
    const alHacer = vi.fn(async () => { avisos.avisar({ texto: 'Listo, quedó como estaba.' }); });
    act(() => avisos.avisar({ texto: 'Cerraste «X».', accion: { etiqueta: 'Deshacer', alHacer } }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deshacer' })); });
    expect(screen.queryByText('Listo, quedó como estaba.')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(MS_AVISO - 1); });
    expect(screen.queryByText('Listo, quedó como estaba.')).not.toBeNull();
  });

  it('si la acción se rechaza, avisa el error en lugar de perderlo', async () => {
    montar();
    const alHacer = vi.fn(async () => { throw new Error('se cayó'); });
    act(() => avisos.avisar({ texto: 'Cerraste «X».', accion: { etiqueta: 'Deshacer', alHacer } }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deshacer' })); });
    expect(screen.getByText('No se pudo completar: se cayó.')).toBeTruthy();
    expect(screen.getByText('No se pudo completar: se cayó.').closest('[data-aviso]')?.className).toContain('aviso-flotante--error');
  });

  it('con el mouse encima el reloj espera y al salir sigue', () => {
    montar();
    act(() => avisos.avisar({ texto: 'Cerraste «X».', accion: { etiqueta: 'Deshacer', alHacer: () => undefined } }));
    const caja = document.querySelector('[data-aviso]')!;
    fireEvent.pointerEnter(caja);
    act(() => { vi.advanceTimersByTime(MS_AVISO * 3); });
    expect(screen.queryByText('Cerraste «X».')).not.toBeNull();
    fireEvent.pointerLeave(caja);
    act(() => { vi.advanceTimersByTime(MS_AVISO); });
    expect(screen.queryByText('Cerraste «X».')).toBeNull();
  });

  it('con el foco adentro el reloj espera', () => {
    montar();
    act(() => avisos.avisar({ texto: 'Cerraste «X».', accion: { etiqueta: 'Deshacer', alHacer: () => undefined } }));
    fireEvent.focus(screen.getByRole('button', { name: 'Deshacer' }));
    act(() => { vi.advanceTimersByTime(MS_AVISO * 3); });
    expect(screen.queryByText('Cerraste «X».')).not.toBeNull();
  });

  it('Ctrl+Z hace el «Deshacer» a la vista, pero no escribiendo en un campo', () => {
    montar();
    const alHacer = vi.fn();
    act(() => avisos.avisar({ texto: 'Cerraste «X».', accion: { etiqueta: 'Deshacer', alHacer } }));
    const campo = document.createElement('input');
    document.body.append(campo);
    fireEvent.keyDown(campo, { key: 'z', ctrlKey: true });
    expect(alHacer).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(alHacer).toHaveBeenCalledOnce();
    campo.remove();
  });

  it('Ctrl+Z no hace nada con otras acciones (por ejemplo «Abrir»)', () => {
    montar();
    const alHacer = vi.fn();
    act(() => avisos.avisar({ texto: 'No se corrió', error: true, accion: { etiqueta: 'Abrir', alHacer } }));
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(alHacer).not.toHaveBeenCalled();
  });

  it('vive fuera de #root, así que un modal que vuelve inerte el fondo no lo apaga', () => {
    const { container } = montar();
    act(() => avisos.avisar({ texto: 'Corrida detrás', accion: { etiqueta: 'Deshacer', alHacer: () => undefined } }));
    const boton = screen.getByRole('button', { name: 'Deshacer' });
    expect(container.contains(boton)).toBe(false);
    const modal = document.createElement('div');
    document.body.append(modal);
    const soltar = bloquearFondo(modal);
    expect(boton.closest('[inert]')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(true);
    soltar();
    modal.remove();
  });

  it('tiene role="status" y muestra la línea de detalle', () => {
    montar();
    act(() => avisos.avisar({ texto: 'Movida', detalle: 'Ana está de vacaciones' }));
    expect(screen.getByRole('status').textContent).toContain('Movida');
    expect(screen.getByText('⚠ Ana está de vacaciones')).toBeTruthy();
  });

  it('fuera del proveedor avisar y cerrar no hacen nada', () => {
    let fuera: Avisos | undefined;
    function Suelta() { fuera = useAvisos(); return null; }
    render(<Suelta />);
    expect(() => { fuera!.avisar({ texto: 'x' }); fuera!.cerrar(); }).not.toThrow();
  });
});
