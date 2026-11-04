import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../App.js';
import { EVENTO_TOKEN_VENCIDO } from '../api/cliente.js';
import { buscar } from './busquedaLogica.js';
import { MSG_TRAYENDO } from '../tareas/logica.js';
import { CATALOGO, falla, limpiarEntorno, ok, prepararEntorno, simularApi, TAREAS, YO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const MIGRACIONES = Array.from({ length: 10 }, (_, i) =>
  tareaDe(100 + i, { titulo: `Migración fase ${i + 1}`, actualizada: `2026-09-${String(10 + i)}T10:00:00Z` }));
const HITO = tareaDe(200, { titulo: 'Migración hito final', tipoId: 2 });
const WEBS = tareaDe(300, { titulo: 'Migración de Webs', actualizada: '2026-10-30T10:00:00Z' });
const MUCHAS = [...TAREAS, ...MIGRACIONES, HITO, WEBS];

async function abrirPaleta(tareas = MUCHAS) {
  prepararEntorno('/tareas');
  const api = simularApi({ 'GET /api/tareas': ok({ tareas, dependencias: [] }) });
  const usuario = userEvent.setup();
  render(<App />);
  const pildora = await screen.findByRole('button', { name: /Buscar/ });
  await usuario.click(pildora);
  const dialogo = await screen.findByRole('dialog', { name: 'Buscar' });
  return { usuario, dialogo, pildora, api, campo: within(dialogo).getByRole('combobox') };
}

describe('lógica de búsqueda', () => {
  it('ignora tildes y mayúsculas, excluye hitos y topea a 8 por grupo', () => {
    const r = buscar('MIGRACION', MUCHAS, CATALOGO);
    expect(r.tareas).toHaveLength(8);
    expect(r.tareas.every((t) => t.id !== 200)).toBe(true);
    expect(buscar('migracion de webs', MUCHAS, CATALOGO).tareas.map((t) => t.id)).toEqual([300]);
  });

  it('sin texto devuelve las 8 tareas (no hito) actualizadas más recientemente y nada más', () => {
    const r = buscar('  ', MUCHAS, CATALOGO);
    expect(r.tareas).toHaveLength(8);
    expect(r.tareas[0]?.id).toBe(300);
    expect(r.proyectos).toEqual([]);
    expect(r.personas).toEqual([]);
  });

  it('encuentra proyectos y personas sin tildes', () => {
    expect(buscar('migracion del erp', MUCHAS, CATALOGO).proyectos.map((p) => p.id)).toEqual([12]);
    expect(buscar('martin gomez', MUCHAS, CATALOGO).personas.map((p) => p.id)).toEqual([5]);
  });
});

describe('Paleta de búsqueda', () => {
  it('Ctrl+K abre y Escape cierra devolviendo el foco a la barra', async () => {
    prepararEntorno('/tareas');
    simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    const pildora = await screen.findByRole('button', { name: /Buscar/ });
    await usuario.keyboard('{Control>}k{/Control}');
    const dialogo = await screen.findByRole('dialog', { name: 'Buscar' });
    expect(within(dialogo).getByRole('combobox')).toHaveFocus();
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Buscar' })).not.toBeInTheDocument());
    expect(pildora).toHaveFocus();
  });

  it('Cmd+K también abre', async () => {
    prepararEntorno('/tareas');
    simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: /Buscar/ });
    await usuario.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('dialog', { name: 'Buscar' })).toBeInTheDocument();
  });

  it('«/» abre solo si el foco no está en un campo', async () => {
    prepararEntorno('/tareas');
    simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: /Buscar/ });
    const campo = document.createElement('input');
    document.body.append(campo);
    campo.focus();
    await usuario.keyboard('/');
    expect(screen.queryByRole('dialog', { name: 'Buscar' })).not.toBeInTheDocument();
    campo.remove();
    await usuario.keyboard('/');
    expect(await screen.findByRole('dialog', { name: 'Buscar' })).toBeInTheDocument();
  });

  it('el clic en la barra abre y deja el fondo inerte', async () => {
    const { dialogo } = await abrirPaleta();
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(document.querySelector('.marco')?.closest('[inert]')).not.toBeNull();
  });

  it('busca «migracion» y encuentra «Migración de Webs»', async () => {
    const { usuario, dialogo, campo } = await abrirPaleta();
    await usuario.type(campo, 'migracion');
    expect(await within(dialogo).findByRole('option', { name: /Migración de Webs/ })).toBeInTheDocument();
  });

  it('agrupa en Tareas, Proyectos y Personas con tope de 8 y sin hitos', async () => {
    const { usuario, dialogo, campo } = await abrirPaleta();
    await usuario.type(campo, 'migracion');
    const grupoTareas = await within(dialogo).findByRole('group', { name: 'Tareas' });
    expect(within(grupoTareas).getAllByRole('option')).toHaveLength(8);
    expect(within(dialogo).queryByText('Migración hito final')).not.toBeInTheDocument();
    expect(within(dialogo).getByRole('group', { name: 'Proyectos' })).toBeInTheDocument();
    expect(within(dialogo).queryByRole('group', { name: 'Personas' })).not.toBeInTheDocument();
  });

  it('sin texto muestra las 8 tareas más recientes', async () => {
    const { dialogo } = await abrirPaleta();
    const opciones = await within(dialogo).findAllByRole('option');
    expect(opciones).toHaveLength(8);
    expect(opciones[0]).toHaveTextContent('Migración de Webs');
  });

  it('las flechas cruzan grupos y aria-activedescendant sigue la opción activa', async () => {
    const { usuario, dialogo, campo } = await abrirPaleta();
    // «a» aparece en tareas, proyectos y personas.
    await usuario.type(campo, 'a');
    const opciones = await within(dialogo).findAllByRole('option');
    const grupos = within(dialogo).getAllByRole('group').map((g) => g.getAttribute('aria-label') ?? g.textContent);
    expect(grupos.length).toBeGreaterThanOrEqual(3);
    expect(campo).toHaveAttribute('aria-controls', within(dialogo).getByRole('listbox').id);
    expect(campo).toHaveAttribute('aria-activedescendant', opciones[0]?.id);
    for (let i = 0; i < opciones.length - 1; i += 1) await usuario.keyboard('{ArrowDown}');
    expect(campo).toHaveAttribute('aria-activedescendant', opciones[opciones.length - 1]?.id);
    expect(opciones[opciones.length - 1]).toHaveAttribute('aria-selected', 'true');
    await usuario.keyboard('{ArrowUp}');
    expect(campo).toHaveAttribute('aria-activedescendant', opciones[opciones.length - 2]?.id);
  });

  it('Enter en una tarea navega a su detalle', async () => {
    const { usuario, campo } = await abrirPaleta();
    await usuario.type(campo, 'migracion de webs');
    await usuario.keyboard('{Enter}');
    await waitFor(() => expect(window.location.pathname).toBe('/tareas/300'));
    expect(screen.queryByRole('dialog', { name: 'Buscar' })).not.toBeInTheDocument();
  });

  it('buscar un proyecto lleva a su pantalla', async () => {
    const { usuario, campo } = await abrirPaleta();
    await usuario.type(campo, 'migracion del erp');
    await usuario.keyboard('{Enter}');
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/proyectos/12'));
  });

  it('buscar una persona lleva a su pantalla', async () => {
    const { usuario, campo } = await abrirPaleta();
    await usuario.type(campo, 'martin gomez');
    await usuario.keyboard('{Enter}');
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/equipo/5'));
  });

  it('el inert se quita al cerrar con Escape, al navegar con Enter y al desmontar', async () => {
    const hayInerte = () => document.querySelector('[inert]') !== null;
    const a = await abrirPaleta();
    expect(hayInerte()).toBe(true);
    await a.usuario.keyboard('{Escape}');
    await waitFor(() => expect(hayInerte()).toBe(false));
    await a.usuario.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Buscar' });
    // Un proyecto (y no una tarea): el detalle de una tarea es otro modal, con su propio bloqueo.
    await a.usuario.keyboard('migracion del erp');
    await a.usuario.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Buscar' })).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/proyectos/12');
    expect(hayInerte()).toBe(false);
    await a.usuario.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Buscar' });
    cleanup();
    expect(hayInerte()).toBe(false);
  });

  it('un clic en el título de un grupo no mata el teclado: Escape cierra y las flechas andan', async () => {
    const { usuario, dialogo, campo } = await abrirPaleta();
    await usuario.type(campo, 'migracion');
    await usuario.click(await within(dialogo).findByText('Proyectos'));
    expect(campo).toHaveFocus();
    await usuario.keyboard('{ArrowDown}');
    expect(campo).toHaveAttribute('aria-activedescendant', within(dialogo).getAllByRole('option')[1]?.id);
    await usuario.click(dialogo);
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Buscar' })).not.toBeInTheDocument());
  });

  it('el token vencido cierra la paleta y el diálogo de token queda usable', async () => {
    const { usuario } = await abrirPaleta();
    act(() => {
      window.dispatchEvent(new Event(EVENTO_TOKEN_VENCIDO));
    });
    const token = await screen.findByRole('dialog', { name: 'Tu token de OpenProject venció' });
    expect(screen.queryByRole('dialog', { name: 'Buscar' })).not.toBeInTheDocument();
    expect(token.closest('[inert]')).toBeNull();
    expect(within(token).getByLabelText('Token nuevo')).toHaveFocus();
    await usuario.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog', { name: 'Buscar' })).not.toBeInTheDocument();
  });

  it('Ctrl+K abre aun con el foco en un campo y cierra la campanita', async () => {
    prepararEntorno('/tareas');
    simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(await screen.findByRole('button', { name: /^Notificaciones/ }));
    await screen.findByRole('dialog', { name: 'Notificaciones' });
    const campo = document.createElement('input');
    document.body.append(campo);
    campo.focus();
    await usuario.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Buscar' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Notificaciones' })).not.toBeInTheDocument();
    campo.remove();
  });

  it('con la carga inicial en curso dice que está trayendo las tareas', async () => {
    prepararEntorno('/tareas');
    simularApi({
      'GET /api/auth/yo': ok({ ...YO, cargaInicialLista: false }),
      'GET /api/tareas': ok({ tareas: [], dependencias: [] }),
    });
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(await screen.findByRole('button', { name: /Buscar/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Buscar' });
    expect(await within(dialogo).findByText(MSG_TRAYENDO)).toBeInTheDocument();
    expect(within(dialogo).queryByText('Todavía no hay tareas.')).not.toBeInTheDocument();
  });

  it('si las consultas fallan, lo dice; el aviso queda fuera del listbox', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/tareas': falla(500, 'interno', 'Falló'), 'GET /api/catalogo': falla(500, 'interno', 'Falló') });
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(await screen.findByRole('button', { name: /Buscar/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Buscar' });
    const aviso = await within(dialogo).findByText('No se pudo cargar la búsqueda.', {}, { timeout: 5000 });
    expect(aviso.closest('[role="listbox"]')).toBeNull();
    expect(within(dialogo).getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });
});
