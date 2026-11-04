import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../App.js';
import { limpiarEntorno, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { LimiteDeErrores } from './LimiteDeErrores.js';

// La pantalla de Tareas se rompe al dibujarse si la prueba lo pide.
const rotura = vi.hoisted(() => ({ activa: false }));
vi.mock('../tareas/PantallaTareas.js', async (original) => {
  const real = await original<typeof import('../tareas/PantallaTareas.js')>();
  return {
    ...real,
    PantallaTareas: () => {
      if (rotura.activa) throw new Error('render roto');
      return real.PantallaTareas();
    },
  };
});

function Rompe(): never {
  throw new Error('render roto');
}

afterEach(() => {
  cleanup();
  limpiarEntorno();
  rotura.activa = false;
  vi.restoreAllMocks();
});

describe('Límite de errores', () => {
  it('sin errores muestra lo de adentro', () => {
    render(<LimiteDeErrores><p>Pantalla</p></LimiteDeErrores>);
    expect(screen.getByText('Pantalla')).toBeInTheDocument();
  });

  it('ante una excepción de render muestra el aviso en vidrio con «Recargar» en vez de dejar la app en blanco', async () => {
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recargar = vi.fn();
    const { container } = render(<LimiteDeErrores alRecargar={recargar}><Rompe /></LimiteDeErrores>);
    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent('Algo salió mal en esta pantalla');
    expect(container.querySelector('.vidrio')).toContainElement(aviso);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Recargar' }));
    expect(recargar).toHaveBeenCalledTimes(1);
    // El detalle va a la consola del navegador, no a la pantalla.
    expect(errores).toHaveBeenCalled();
    expect(screen.queryByText('render roto')).not.toBeInTheDocument();
  });

  it('si la pantalla de Tareas se rompe, el marco sigue en pie con el aviso donde iba la pantalla', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rotura.activa = true;
    prepararEntorno('/tareas');
    simularApi();
    const { container } = render(<App />);
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Algo salió mal en esta pantalla');
    expect(within(aviso).getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
    expect(container.querySelector('.marco__vista')).toContainElement(aviso);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
