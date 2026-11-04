import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { HorasTarea } from './HorasTarea.js';
import { describirTarea } from './TarjetaTarea.js';

afterEach(cleanup);

const abierta = CATALOGO.estados.find((e) => !e.cerrado)!.id;

describe('horas en Tareas', () => {
  it('muestra lo trabajado contra lo estimado y lo dice entero para quien lee la pantalla', () => {
    const { container } = render(<HorasTarea tarea={tareaDe(1, { estimacionHoras: 5, horasReales: 2 })} cerrada={false} />);
    expect(container.textContent).toContain('2 h / ~5 h');
    expect(screen.getByText('2 h trabajadas de 5 h estimadas')).toHaveClass('sr-only');
    expect(container.firstElementChild).not.toHaveClass('horas-tarea--pasada');
  });

  it('en rojo si ya se pasó de lo estimado', () => {
    const { container } = render(<HorasTarea tarea={tareaDe(1, { estimacionHoras: 1, horasReales: 3 })} cerrada={false} />);
    expect(container.firstElementChild).toHaveClass('horas-tarea--pasada');
  });

  it('sin horas no dibuja nada', () => {
    const { container } = render(<HorasTarea tarea={tareaDe(1)} cerrada={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('el nombre de la tarjeta incluye las horas', () => {
    const tarea = tareaDe(1, { proyectoId: CATALOGO.proyectos[0]!.id, estadoId: abierta, estimacionHoras: 5, horasReales: 2 });
    expect(describirTarea(tarea, CATALOGO, '2026-10-30', null)).toContain('2 h trabajadas de 5 h estimadas');
  });
});
