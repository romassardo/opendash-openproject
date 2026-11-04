import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { EstimadoReal } from './EstimadoReal.js';

afterEach(cleanup);

const dibujar = (extra: { estimacionHoras: number | null; horasReales: number | null }) =>
  render(<EstimadoReal tarea={tareaDe(1, extra)} />);
const dato = (nombre: string) => screen.getByText(nombre).nextElementSibling;

describe('EstimadoReal', () => {
  it('muestra «Estimado» y «Trabajado» con el formato de la app, el porcentaje y la barra', () => {
    const { container } = dibujar({ estimacionHoras: 8, horasReales: 7 + 8 / 60 });
    expect(within(screen.getByRole('group', { name: 'Horas de la tarea' })).getByText('Estimado')).toBeInTheDocument();
    expect(dato('Estimado')).toHaveTextContent('8 h');
    expect(dato('Trabajado')).toHaveTextContent('7 h 8 m · 89 %');
    expect(container.querySelector<HTMLElement>('.estimado-real__relleno')?.style.width).toBe('89%');
    expect(container.querySelector('.estimado-real__pasado')).toBeNull();
  });

  it('pasado de lo estimado: en rojo y la barra llena', () => {
    const { container } = dibujar({ estimacionHoras: 2, horasReales: 3 });
    expect(dato('Trabajado')).toHaveTextContent('3 h · 150 %');
    expect(dato('Trabajado')).toHaveClass('estimado-real__pasado');
    expect(container.querySelector('.estimado-real__relleno--pasado')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('.estimado-real__relleno')?.style.width).toBe('100%');
  });

  it('solo estimación: nada trabajado todavía y la barra vacía', () => {
    const { container } = dibujar({ estimacionHoras: 5, horasReales: null });
    expect(dato('Estimado')).toHaveTextContent('5 h');
    expect(dato('Trabajado')).toHaveTextContent('Nada todavía');
    expect(container.querySelector<HTMLElement>('.estimado-real__relleno')?.style.width).toBe('0%');
  });

  it('solo trabajado: sin estimar y sin barra', () => {
    const { container } = dibujar({ estimacionHoras: null, horasReales: 0.75 });
    expect(dato('Estimado')).toHaveTextContent('Sin estimar');
    expect(dato('Trabajado')).toHaveTextContent('45 m');
    expect(container.querySelector('.estimado-real__barra')).toBeNull();
  });

  it('sin nada igual muestra los dos datos', () => {
    dibujar({ estimacionHoras: null, horasReales: null });
    expect(dato('Estimado')).toHaveTextContent('Sin estimar');
    expect(dato('Trabajado')).toHaveTextContent('Nada todavía');
  });
});
