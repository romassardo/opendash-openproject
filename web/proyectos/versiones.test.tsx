import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Version } from '../../compartido/tipos.js';
import { falla, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { App } from '../App.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

type ConPermisos = Version & { tareas: number; puedeCambiar: boolean; puedeBorrar: boolean };
const version = (id: number, nombre: string, extra: Partial<ConPermisos> = {}): ConPermisos =>
  ({ id, nombre, proyectoId: 11, estado: 'abierta', inicio: null, fin: null, tareas: 0, puedeCambiar: true, puedeBorrar: true, ...extra });

const VERSIONES = [
  version(1, 'Sprint 1', { tareas: 2, fin: '2026-11-30' }),
  version(2, 'Sprint 2', { estado: 'cerrada' }),
];

async function abrir(rutas: Parameters<typeof simularApi>[0] = {}, puedeCrear = true, versiones = VERSIONES) {
  prepararEntorno('/proyectos/11?vista=gestion');
  const api = simularApi({ 'GET /api/proyectos/11/versiones': ok({ versiones, puedeCrear }), ...rutas });
  render(<App />);
  const seccion = await screen.findByRole('region', { name: 'Versiones' });
  return { api, seccion, usuario: userEvent.setup() };
}

describe('Versiones del proyecto', () => {
  it('lista nombre, fecha, estado y cantidad de tareas', async () => {
    const { seccion } = await abrir();
    const fila = (await within(seccion).findByText('Sprint 1')).closest('li')!;
    expect(within(fila).getByText('2 tareas')).toBeInTheDocument();
    expect(within(fila).getByRole('combobox', { name: 'Estado de Sprint 1' })).toHaveValue('abierta');
    const otra = within(seccion).getByText('Sprint 2').closest('li')!;
    expect(within(otra).getByRole('combobox', { name: 'Estado de Sprint 2' })).toHaveValue('cerrada');
    expect(within(otra).getByText('0 tareas')).toBeInTheDocument();
  });

  it('Reader: sin «Nueva versión» y sin controles', async () => {
    const { seccion } = await abrir({}, false, [version(1, 'Sprint 1', { puedeCambiar: false, puedeBorrar: false })]);
    await within(seccion).findByText('Sprint 1');
    expect(within(seccion).queryByRole('button', { name: 'Nueva versión' })).toBeNull();
    expect(within(seccion).queryByRole('combobox')).toBeNull();
    expect(within(seccion).queryByRole('button', { name: /Borrar|Renombrar/ })).toBeNull();
    expect(within(seccion).getByText('Abierta')).toBeInTheDocument();
  });

  it('crear una versión manda nombre y fechas y recarga la lista', async () => {
    const { api, seccion, usuario } = await abrir({
      'POST /api/proyectos/11/versiones': ok(version(9, 'Sprint 3')),
    });
    await usuario.click(await within(seccion).findByRole('button', { name: 'Nueva versión' }));
    await usuario.type(within(seccion).getByLabelText('Nombre de la versión'), 'Sprint 3');
    await usuario.click(within(seccion).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/proyectos/11/versiones', cuerpo: { nombre: 'Sprint 3', inicio: null, fin: null } }));
    await waitFor(() => expect(api.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === '/api/proyectos/11/versiones').length).toBeGreaterThan(1));
  });

  it('cerrar una versión manda el estado', async () => {
    const { api, seccion, usuario } = await abrir({ 'PATCH /api/versiones/1': ok(version(1, 'Sprint 1', { estado: 'cerrada' })) });
    await usuario.selectOptions(await within(seccion).findByRole('combobox', { name: 'Estado de Sprint 1' }), 'cerrada');
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'PATCH', ruta: '/api/versiones/1', cuerpo: { estado: 'cerrada' } }));
  });

  it('renombrar manda el nombre nuevo', async () => {
    const { api, seccion, usuario } = await abrir({ 'PATCH /api/versiones/1': ok(version(1, 'Sprint uno')) });
    await usuario.click(await within(seccion).findByRole('button', { name: 'Renombrar Sprint 1' }));
    const campo = within(seccion).getByLabelText('Nombre de la versión');
    await usuario.clear(campo);
    await usuario.type(campo, 'Sprint uno{Enter}');
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'PATCH', ruta: '/api/versiones/1', cuerpo: { nombre: 'Sprint uno' } }));
  });

  it('borrar con tareas: el motivo se ve en pantalla y el botón no borra', async () => {
    const { api, seccion, usuario } = await abrir();
    const boton = await within(seccion).findByRole('button', { name: 'Borrar Sprint 1' });
    const motivo = within(seccion).getByText('Tiene 2 tareas: pasalas a otra versión antes de borrarla');
    expect(motivo).not.toHaveClass('sr-only');
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    expect(boton).toHaveAccessibleDescription('Tiene 2 tareas: pasalas a otra versión antes de borrarla');
    boton.focus();
    expect(boton).toHaveFocus();
    await usuario.click(boton);
    expect(within(seccion).queryByRole('group', { name: /Confirmar el borrado/ })).toBeNull();
    expect(api.llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
  });

  it('cambiar el estado con el teclado guarda solo el valor en que se detuvo', async () => {
    const { api, seccion } = await abrir({ 'PATCH /api/versiones/1': ok(version(1, 'Sprint 1', { estado: 'cerrada' })) });
    const select = await within(seccion).findByRole('combobox', { name: 'Estado de Sprint 1' });
    fireEvent.change(select, { target: { value: 'bloqueada' } });
    fireEvent.change(select, { target: { value: 'cerrada' } });
    expect(select).toHaveValue('cerrada');
    expect(select).not.toBeDisabled();
    await waitFor(() => expect(api.llamadas.filter((l) => l.metodo === 'PATCH')).toEqual([
      { metodo: 'PATCH', ruta: '/api/versiones/1', cuerpo: { estado: 'cerrada' } },
    ]));
  });

  it('borrar una versión vacía pide confirmación y la borra', async () => {
    const { api, seccion, usuario } = await abrir({ 'DELETE /api/versiones/2': ok({}) });
    await usuario.click(await within(seccion).findByRole('button', { name: 'Borrar Sprint 2' }));
    expect(within(seccion).getByText('¿Borrar la versión “Sprint 2”? No se puede deshacer')).toBeInTheDocument();
    await usuario.click(within(seccion).getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'DELETE', ruta: '/api/versiones/2', cuerpo: undefined }));
  });

  it('un 403 inesperado muestra «no tenés permiso» sin romper la pantalla', async () => {
    const { seccion, usuario } = await abrir({ 'PATCH /api/versiones/1': falla(403, 'prohibido', 'No tenés permiso para hacer eso en OpenProject') });
    await usuario.selectOptions(await within(seccion).findByRole('combobox', { name: 'Estado de Sprint 1' }), 'bloqueada');
    expect(await within(seccion).findByRole('alert')).toHaveTextContent('No tenés permiso para hacer eso en OpenProject');
    expect(within(seccion).getByText('Sprint 1')).toBeInTheDocument();
  });
});

describe('Foco en las versiones', () => {
  it('la confirmación de borrar enfoca «Cancelar»; cancelar devuelve el foco al tacho', async () => {
    const { seccion, usuario } = await abrir();
    await usuario.click(await within(seccion).findByRole('button', { name: 'Borrar Sprint 2' }));
    expect(within(seccion).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await usuario.click(within(seccion).getByRole('button', { name: 'Cancelar' }));
    expect(within(seccion).getByRole('button', { name: 'Borrar Sprint 2' })).toHaveFocus();
  });
});

describe('Pestañas del proyecto', () => {
  it('al cambiar de parte el foco queda en la opción marcada del control nuevo', async () => {
    prepararEntorno('/proyectos/11');
    simularApi({ 'GET /api/proyectos/11/versiones': ok({ versiones: [], puedeCrear: false }) });
    render(<App />);
    const usuario = userEvent.setup();
    const grupo = await screen.findByRole('radiogroup', { name: 'Parte del proyecto' });
    await usuario.click(within(grupo).getByRole('radio', { name: 'Miembros y versiones' }));
    await screen.findByRole('region', { name: 'Versiones' });
    expect(within(screen.getByRole('radiogroup', { name: 'Parte del proyecto' })).getByRole('radio', { name: 'Miembros y versiones' })).toHaveFocus();
    await usuario.keyboard('{ArrowLeft}');
    const nuevo = await screen.findByRole('radiogroup', { name: 'Parte del proyecto' });
    await waitFor(() => expect(within(nuevo).getByRole('radio', { name: 'Tablero' })).toBeChecked());
    expect(within(nuevo).getByRole('radio', { name: 'Tablero' })).toHaveFocus();
  });

  it('«Miembros y versiones» cambia la dirección y «Tablero» vuelve', async () => {
    prepararEntorno('/proyectos/11');
    simularApi({ 'GET /api/proyectos/11/versiones': ok({ versiones: [], puedeCrear: false }) });
    render(<App />);
    const usuario = userEvent.setup();
    const grupo = await screen.findByRole('radiogroup', { name: 'Parte del proyecto' });
    expect(within(grupo).getByRole('radio', { name: 'Tablero' })).toBeChecked();
    await usuario.click(within(grupo).getByRole('radio', { name: 'Miembros y versiones' }));
    await waitFor(() => expect(window.location.search).toBe('?vista=gestion'));
    expect(await screen.findByRole('region', { name: 'Versiones' })).toBeInTheDocument();
    await usuario.click(within(screen.getByRole('radiogroup', { name: 'Parte del proyecto' })).getByRole('radio', { name: 'Tablero' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    // Vuelve el tablero (su control queda marcado) y la sección de versiones se va.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Versiones' })).toBeNull());
    expect(within(screen.getByRole('radiogroup', { name: 'Parte del proyecto' })).getByRole('radio', { name: 'Tablero' })).toBeChecked();
  });
});
