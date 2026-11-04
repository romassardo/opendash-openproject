import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { falla, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { App } from '../App.js';
import type { ListaMiembros } from '../api/consultas.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const COMPLETO: ListaMiembros['puede'] = { agregar: true, cambiar: true, quitar: true };
const lista = (puede: ListaMiembros['puede'] = COMPLETO, tareasAbiertas = 0): ListaMiembros => ({
  miembros: [{ id: 20, personaId: 5, roles: [{ id: 3, nombre: 'Member' }], nombre: 'Beto Gómez', avatarUrl: null, tareasAbiertas }],
  roles: puede.agregar || puede.cambiar ? [{ id: 3, nombre: 'Member' }, { id: 4, nombre: 'Project admin' }] : [],
  candidatos: puede.agregar ? [{ id: 7, nombre: 'Dani Paz', login: null, email: null, avatarUrl: null }] : [],
  puede,
});

async function abrir(rutas: Parameters<typeof simularApi>[0], datos: ListaMiembros) {
  prepararEntorno('/proyectos/11?vista=gestion');
  const api = simularApi({
    'GET /api/proyectos/11/versiones': ok({ versiones: [], puedeCrear: false }),
    'GET /api/proyectos/11/miembros': ok(datos),
    ...rutas,
  });
  render(<App />);
  const seccion = await screen.findByRole('region', { name: 'Miembros' });
  return { api, seccion, usuario: userEvent.setup() };
}

describe('Miembros del proyecto', () => {
  it('lista nombre y rol, y agrega a una persona con su rol', async () => {
    const { api, seccion, usuario } = await abrir({ 'POST /api/proyectos/11/miembros': ok({}) }, lista());
    const fila = (await within(seccion).findByText('Beto Gómez')).closest('li')!;
    expect(within(fila).getByRole('combobox', { name: 'Cambiar rol de Beto Gómez' })).toHaveValue('3');
    await usuario.click(within(seccion).getByRole('button', { name: 'Agregar persona' }));
    await usuario.selectOptions(within(seccion).getByRole('combobox', { name: 'Persona' }), '7');
    await usuario.selectOptions(within(seccion).getByRole('combobox', { name: 'Rol' }), '4');
    await usuario.click(within(seccion).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/proyectos/11/miembros', cuerpo: { personaId: 7, rolId: 4 } }));
  });

  it('al agregar, el rol arranca sin elegir y «Agregar» espera a que se elija', async () => {
    const { api, seccion, usuario } = await abrir({ 'POST /api/proyectos/11/miembros': ok({}) }, lista());
    await usuario.click(await within(seccion).findByRole('button', { name: 'Agregar persona' }));
    const rol = within(seccion).getByRole('combobox', { name: 'Rol' });
    expect(rol).toHaveValue('');
    expect(within(rol).getByRole('option', { name: 'Elegí un rol' })).toBeInTheDocument();
    await usuario.selectOptions(within(seccion).getByRole('combobox', { name: 'Persona' }), '7');
    expect(within(seccion).getByRole('button', { name: 'Agregar' })).toBeDisabled();
    await usuario.selectOptions(rol, '3');
    await usuario.click(within(seccion).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/proyectos/11/miembros', cuerpo: { personaId: 7, rolId: 3 } }));
  });

  it('cambiar el rol manda el rol nuevo', async () => {
    const { api, seccion, usuario } = await abrir({ 'PATCH /api/miembros/20': ok({}) }, lista());
    await usuario.selectOptions(await within(seccion).findByRole('combobox', { name: 'Cambiar rol de Beto Gómez' }), '4');
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'PATCH', ruta: '/api/miembros/20', cuerpo: { rolId: 4 } }));
  });

  it('con el teclado se guarda el rol en que se detuvo, sin deshabilitar el select', async () => {
    const { api, seccion } = await abrir({ 'PATCH /api/miembros/20': ok({}) }, lista());
    const select = await within(seccion).findByRole('combobox', { name: 'Cambiar rol de Beto Gómez' });
    fireEvent.change(select, { target: { value: '4' } });
    fireEvent.change(select, { target: { value: '3' } });
    fireEvent.change(select, { target: { value: '4' } });
    expect(select).toHaveValue('4');
    expect(select).not.toBeDisabled();
    await waitFor(() => expect(api.llamadas.filter((l) => l.metodo === 'PATCH')).toEqual([
      { metodo: 'PATCH', ruta: '/api/miembros/20', cuerpo: { rolId: 4 } },
    ]));
  });

  it('la confirmación de sacar enfoca «Cancelar», Escape la cierra y el foco vuelve al botón', async () => {
    const { seccion, usuario } = await abrir({}, lista());
    const boton = await within(seccion).findByRole('button', { name: 'Sacar a Beto Gómez' });
    await usuario.click(boton);
    expect(within(seccion).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await usuario.keyboard('{Escape}');
    expect(within(seccion).queryByRole('group', { name: /Confirmar que/ })).toBeNull();
    expect(within(seccion).getByRole('button', { name: 'Sacar a Beto Gómez' })).toHaveFocus();
  });

  it('sacar con tareas pregunta a quién pasarlas y las deja sin asignar por defecto', async () => {
    const { api, seccion, usuario } = await abrir({ 'DELETE /api/miembros/20': ok({}) }, lista(COMPLETO, 4));
    await usuario.click(await within(seccion).findByRole('button', { name: 'Sacar a Beto Gómez' }));
    expect(within(seccion).getByText('Sus 4 tareas abiertas: pasarlas a')).toBeInTheDocument();
    expect(within(seccion).getByRole('combobox', { name: /pasarlas a/ })).toHaveValue('');
    await usuario.click(within(seccion).getByRole('button', { name: 'Sacar' }));
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'DELETE', ruta: '/api/miembros/20', cuerpo: { pasarA: null } }));
  });

  it('un 409 por una tarea se muestra y no se cierra el diálogo', async () => {
    const { seccion, usuario } = await abrir(
      { 'DELETE /api/miembros/20': falla(409, 'conflicto', 'No se pudo reasignar «Uno»') }, lista(COMPLETO, 2),
    );
    await usuario.click(await within(seccion).findByRole('button', { name: 'Sacar a Beto Gómez' }));
    await usuario.click(within(seccion).getByRole('button', { name: 'Sacar' }));
    expect(await within(seccion).findByRole('alert')).toHaveTextContent('No se pudo reasignar «Uno»');
  });

  it('Member: sin botones', async () => {
    const { seccion } = await abrir({}, lista({ agregar: false, cambiar: false, quitar: false }));
    await within(seccion).findByText('Beto Gómez');
    expect(within(seccion).queryByRole('button')).toBeNull();
    expect(within(seccion).queryByRole('combobox')).toBeNull();
    expect(within(seccion).getByText('Member')).toBeInTheDocument();
  });

  it('Reader: la sección no aparece', async () => {
    prepararEntorno('/proyectos/11?vista=gestion');
    simularApi({
      'GET /api/proyectos/11/versiones': ok({ versiones: [], puedeCrear: false }),
      'GET /api/proyectos/11/miembros': falla(403, 'prohibido', 'No tenés permiso para hacer eso en OpenProject'),
    });
    render(<App />);
    await screen.findByRole('region', { name: 'Versiones' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Miembros' })).toBeNull());
  });
});
