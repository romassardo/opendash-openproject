import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { abrirDetalle, CONCILIACION, panel } from '../../pruebas/fabricas/detalle.js';
import { falla, limpiarEntorno, ok } from '../../pruebas/fabricas/web.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const resumen = (extra = {}) => ({ puede: true, motivo: null, subtareas: 3, horas: 12, adjuntos: 2, trabajando: null, ajenas: 0, sucesoras: [], ...extra });
const BORRADO = 'GET /api/tareas/8/borrado';

describe('Borrar una tarea desde el detalle', () => {
  it('sin permiso «Borrar tarea» está a la vista pero apagado, y dice por qué', async () => {
    const motivo = 'Solo quien creó la tarea la puede borrar, y esta la creó Daniel Sosa.';
    abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen({ puede: false, motivo })) });
    const dialogo = await panel();
    const boton = await within(dialogo).findByRole('button', { name: 'Borrar tarea' });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAccessibleDescription(motivo);
    expect(within(dialogo).getByText(motivo)).toBeInTheDocument();
  });

  it('la confirmación pregunta si está seguro y nombra las tareas que la esperan', async () => {
    abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen({ sucesoras: ['Pruebas de cobro', 'Puesta en marcha'] })) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar tarea' }));
    const confirmar = await within(dialogo).findByRole('alertdialog', { name: '¿Seguro que querés borrar «Conciliación bancaria»?' });
    expect(await within(confirmar).findByText('La esperan «Pruebas de cobro» y «Puesta en marcha»: dejan de esperarla.')).toBeInTheDocument();
  });

  it('con una sola que la espera lo dice en singular', async () => {
    abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen({ sucesoras: ['Pruebas de cobro'] })) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar tarea' }));
    const confirmar = await within(dialogo).findByRole('alertdialog');
    expect(await within(confirmar).findByText('La espera «Pruebas de cobro»: deja de esperarla.')).toBeInTheDocument();
  });

  it('el diálogo muestra subtareas, horas y adjuntos y al borrar cierra el detalle y avisa', async () => {
    const api = abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen()), 'DELETE /api/tareas/8': { estado: 204, cuerpo: null as never } });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar tarea' }));
    const confirmar = await within(dialogo).findByRole('alertdialog');
    expect(await within(confirmar).findByText('Se borran también 3 subtareas, 12 h cargadas y 2 adjuntos. No se puede deshacer.')).toBeInTheDocument();
    expect(within(confirmar).getByText('Las 12 h cargadas se borran de OpenProject; quienes las trabajaron las pueden pasar a otra tarea')).toBeInTheDocument();
    expect(api.llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
    await usuario.click(within(confirmar).getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Conciliación bancaria' })).toBeNull());
    expect(api.llamadas.filter((l) => l.metodo === 'DELETE')).toEqual([{ metodo: 'DELETE', ruta: '/api/tareas/8', cuerpo: undefined }]);
    expect(await screen.findByText('Borraste «Conciliación bancaria»')).toBeInTheDocument();
  });

  it('el resumen nombra solo lo que hay, en singular cuando es uno', async () => {
    const usuario = userEvent.setup();
    abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen({ subtareas: 1, horas: 0, adjuntos: 1 })) });
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar tarea' }));
    const confirmar = await within(dialogo).findByRole('alertdialog');
    expect(await within(confirmar).findByText('Se borran también 1 subtarea y 1 adjunto. No se puede deshacer.')).toBeInTheDocument();
  });

  it('sin subtareas, horas ni adjuntos solo avisa que no se puede deshacer', async () => {
    const usuario = userEvent.setup();
    abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen({ subtareas: 0, horas: 0, adjuntos: 0 })) });
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar tarea' }));
    const confirmar = await within(dialogo).findByRole('alertdialog');
    expect(await within(confirmar).findByText('No se puede deshacer.')).toBeInTheDocument();
    expect(within(confirmar).queryByText(/Se borran también/)).toBeNull();
  });

  it('si alguien está trabajando en la tarea lo dice y no deja borrar', async () => {
    const api = abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen({ trabajando: 'Ana' })) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar tarea' }));
    const confirmar = await within(dialogo).findByRole('alertdialog');
    expect(await within(confirmar).findByText('Ana está trabajando en esta tarea ahora')).toBeInTheDocument();
    expect(within(confirmar).getByRole('button', { name: 'Borrar' })).toBeDisabled();
    expect(api.llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
  });

  it('con subtareas que creó otra persona lo dice y no deja borrar', async () => {
    const api = abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen({ ajenas: 2 })) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar tarea' }));
    const confirmar = await within(dialogo).findByRole('alertdialog');
    expect(await within(confirmar).findByText('No se puede borrar: tiene 2 subtareas que creó otra persona.')).toBeInTheDocument();
    expect(within(confirmar).getByRole('button', { name: 'Borrar' })).toBeDisabled();
    expect(api.llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
  });

  it('un error al borrar queda a la vista y el detalle sigue abierto', async () => {
    abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen()), 'DELETE /api/tareas/8': falla(409, 'conflicto', 'Ana está trabajando en esta tarea ahora') });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar tarea' }));
    const confirmar = await within(dialogo).findByRole('alertdialog');
    await within(confirmar).findByText(/Se borran también/);
    await usuario.click(within(confirmar).getByRole('button', { name: 'Borrar' }));
    expect(await within(confirmar).findByText('Ana está trabajando en esta tarea ahora')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Conciliación bancaria' })).toBeInTheDocument();
  });

  it('un guardado contra una tarea que otra persona borró dice que ya no existe y la saca de la lista', async () => {
    const api = abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen()), 'PATCH /api/tareas/8': falla(404, 'no-encontrado', 'Esa tarea ya no existe en OpenProject') });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const titulo = await within(dialogo).findByRole('textbox', { name: /título/i });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Otro nombre{Enter}');
    expect(await within(dialogo).findByText('Esa tarea ya no existe en OpenProject')).toBeInTheDocument();
    expect(api.llamadas.some((l) => l.metodo === 'PATCH')).toBe(true);
  });

  it('esa tarea sale de la lista y el detalle pasa a «No se encontró la tarea»', async () => {
    let borrada = false;
    const api = abrirDetalle('/tareas/8', {
      [BORRADO]: ok(resumen()),
      'PATCH /api/tareas/8': () => { borrada = true; return falla(404, 'no-encontrado', 'Esa tarea ya no existe en OpenProject'); },
      'GET /api/tareas/8': () => (borrada ? falla(404, 'no-encontrado', 'No encontramos esa tarea') : ok({ tarea: CONCILIACION, actividades: [] })),
    });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const titulo = await within(dialogo).findByRole('textbox', { name: /título/i });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Otro nombre{Enter}');
    expect(await panel('No se encontró la tarea')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Conciliación bancaria' })).toBeNull();
    expect(api.llamadas.some((l) => l.metodo === 'PATCH')).toBe(true);
  });

  it('el botón pide solo el permiso (sin contar adjuntos) y el diálogo pide el resumen completo', async () => {
    abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen()) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const boton = await within(dialogo).findByRole('button', { name: 'Borrar tarea' });
    const pedidos = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/borrado'));
    expect(pedidos()).toEqual(['/api/tareas/8/borrado?sinAdjuntos=1']);
    await usuario.click(boton);
    await within(dialogo).findByText(/Se borran también/);
    expect(pedidos()).toContain('/api/tareas/8/borrado');
  });

  it('Escape en el diálogo cancela solo el borrado, el detalle sigue y el foco vuelve a «Borrar tarea»', async () => {
    const api = abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen()) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const mas = await within(dialogo).findByRole('button', { name: 'Borrar tarea' });
    await usuario.click(mas);
    const confirmar = await within(dialogo).findByRole('alertdialog');
    expect(within(confirmar).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await usuario.keyboard('{Escape}');
    expect(within(dialogo).queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Conciliación bancaria' })).toBeInTheDocument();
    expect(mas).toHaveFocus();
    expect(api.llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
  });

  it('Tab da la vuelta dentro del diálogo de borrado y no sale a los campos del detalle', async () => {
    abrirDetalle('/tareas/8', { [BORRADO]: ok(resumen()) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar tarea' }));
    const confirmar = await within(dialogo).findByRole('alertdialog');
    await within(confirmar).findByText(/Se borran también/);
    const borrar = within(confirmar).getByRole('button', { name: 'Borrar' });
    await usuario.tab();
    expect(borrar).toHaveFocus();
    await usuario.tab();
    expect(within(confirmar).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await usuario.tab({ shift: true });
    expect(borrar).toHaveFocus();
  });
});
