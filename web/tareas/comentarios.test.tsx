import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { CATALOGO, limpiarEntorno } from '../../pruebas/fabricas/web.js';
import type { EdicionTarea } from './accionesDetalle.js';
import { Comentarios } from './SeccionesDetalle.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

describe('Comentarios', () => {
  it('el botón Comentar se libera aunque comentar rechace', async () => {
    const comentar = vi.fn().mockRejectedValue(new Error('se cortó'));
    const edicion = { comentar } as unknown as EdicionTarea;
    render(<Comentarios actividades={[]} catalogo={CATALOGO} edicion={edicion} />);
    const usuario = userEvent.setup();
    await usuario.type(screen.getByRole('textbox', { name: 'Nuevo comentario' }), 'Lo reviso mañana');
    const boton = screen.getByRole('button', { name: 'Comentar' });
    await usuario.click(boton);
    await waitFor(() => expect(comentar).toHaveBeenCalledTimes(1));
    // El texto sigue ahí y se puede volver a intentar.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Comentar' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Nuevo comentario' })).toHaveValue('Lo reviso mañana');
  });
});
