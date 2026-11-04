import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Notificacion } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { EVENTO_TOKEN_VENCIDO } from '../api/cliente.js';
import { motivoEnCastellano } from './notificacionesLogica.js';
import { falla, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const ahora = Date.now();
const hace = (minutos: number) => new Date(ahora - minutos * 60_000).toISOString();
const noti = (id: number, extra: Partial<Notificacion> = {}): Notificacion => ({
  id, leida: false, motivo: 'mentioned', tareaId: 2, titulo: `Tarea ${id}`, creada: hace(5), actorId: 5, ...extra,
});

async function abrirCampanita(notificaciones: Notificacion[], rutas: Parameters<typeof simularApi>[0] = {}) {
  prepararEntorno('/tareas');
  // El servidor recuerda lo marcado: así el refresco posterior no revive las no leídas.
  const estado = notificaciones.map((n) => ({ ...n }));
  const marcadoras = Object.fromEntries(estado.map((n) => [`POST /api/notificaciones/${n.id}/leida`, () => {
    n.leida = true;
    return ok({});
  }]));
  const marcarVarias = (cuerpo: unknown) => {
    const { ids } = cuerpo as { ids: number[] };
    for (const n of estado) if (ids.includes(n.id)) n.leida = true;
    return ok({ fallidas: [] });
  };
  const api = simularApi({
    'GET /api/notificaciones': () => ok(estado.map((n) => ({ ...n }))),
    'POST /api/notificaciones/leidas': marcarVarias,
    ...marcadoras,
    ...rutas,
  });
  const usuario = userEvent.setup();
  render(<App />);
  const campanita = await screen.findByRole('button', { name: /^Notificaciones/ });
  return { usuario, api, campanita };
}

const sinLeer = () => screen.queryByRole('button', { name: 'Notificaciones, hay sin leer' });

describe('lógica de notificaciones', () => {
  it('traduce los motivos conocidos y tiene un texto genérico para el resto', () => {
    for (const motivo of ['mentioned', 'assigned', 'watched', 'commented', 'dateAlert', 'responsible', 'created', 'prioritized', 'scheduled', 'shared']) {
      expect(motivoEnCastellano(motivo)).not.toBe(motivoEnCastellano('algoRaro'));
    }
    expect(motivoEnCastellano('mentioned')).toBe('Te mencionaron');
    expect(motivoEnCastellano('algoRaro')).toBe('Novedad');
  });
});

describe('Campanita', () => {
  it('muestra el punto solo si hay no leídas', async () => {
    const { campanita } = await abrirCampanita([noti(1)]);
    await waitFor(() => expect(campanita).toHaveAccessibleName('Notificaciones, hay sin leer'));
    expect(campanita.querySelector('.herramientas__punto')).not.toBeNull();
    cleanup();
    limpiarEntorno();
    const { campanita: otra } = await abrirCampanita([noti(1, { leida: true })]);
    await waitFor(() => expect(otra).toHaveAccessibleName('Notificaciones'));
    expect(otra.querySelector('.herramientas__punto')).toBeNull();
  });

  it('lista actor, motivo, título y hace cuánto', async () => {
    const { usuario, campanita } = await abrirCampanita([noti(1, { titulo: 'Revisar contrato', creada: hace(5) })]);
    await usuario.click(campanita);
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    const item = within(panel).getByRole('button', { name: /Revisar contrato/ });
    expect(item).toHaveTextContent('Martín Gómez');
    expect(item).toHaveTextContent('Te mencionaron');
    expect(item).toHaveTextContent('hace 5 minutos');
  });

  it('clic en una notificación la marca leída y abre la tarea', async () => {
    const { usuario, api, campanita } = await abrirCampanita(
      [noti(1, { tareaId: 2 }), noti(2, { tareaId: 3 })],
      { 'POST /api/notificaciones/1/leida': ok({}) },
    );
    await usuario.click(campanita);
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    await usuario.click(within(panel).getByRole('button', { name: /Tarea 1/ }));
    await waitFor(() => expect(window.location.pathname).toBe('/tareas/2'));
    expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/notificaciones/1/leida', cuerpo: undefined });
    expect(screen.queryByRole('dialog', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('marca leída de inmediato, sin esperar al servidor', async () => {
    const { usuario, campanita } = await abrirCampanita([noti(1)], { 'POST /api/notificaciones/1/leida': ok({}) });
    const real = fetch;
    let soltar: () => void = () => {};
    const compuerta = new Promise<void>((resolver) => { soltar = resolver; });
    vi.stubGlobal('fetch', async (entrada: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') await compuerta;
      return real(entrada, init);
    });
    await usuario.click(campanita);
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    await usuario.click(within(panel).getByRole('button', { name: /Tarea 1/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeInTheDocument());
    expect(sinLeer()).toBeNull();
    soltar();
  });

  it('revierte si el servidor falla', async () => {
    const { usuario, campanita } = await abrirCampanita([noti(1)], {
      'POST /api/notificaciones/1/leida': falla(500, 'interno', 'Falló'),
    });
    await usuario.click(campanita);
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    await usuario.click(within(panel).getByRole('button', { name: /Tarea 1/ }));
    await waitFor(() => expect(window.location.pathname).toBe('/tareas/2'));
    await waitFor(() => expect(sinLeer()).not.toBeNull());
    const reabierto = await screen.findByRole('dialog', { name: 'Notificaciones' });
    expect(within(reabierto).getByRole('alert')).toHaveTextContent('Falló');
  });

  it('Marcar todas hace un solo pedido al servidor', async () => {
    const { usuario, api, campanita } = await abrirCampanita(
      [noti(1), noti(2), noti(3, { leida: true })],
    );
    await usuario.click(campanita);
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    await usuario.click(within(panel).getByRole('button', { name: 'Marcar todas como leídas' }));
    await waitFor(() => expect(sinLeer()).toBeNull());
    const posts = api.llamadas.filter((l) => l.metodo === 'POST');
    expect(posts).toEqual([{ metodo: 'POST', ruta: '/api/notificaciones/leidas', cuerpo: { ids: [1, 2] } }]);
    expect(within(panel).queryByRole('button', { name: 'Marcar todas como leídas' })).not.toBeInTheDocument();
  });

  it('si «marcar todas» falla en una, esa vuelve a quedar sin leer y se avisa', async () => {
    const { usuario, campanita } = await abrirCampanita(
      [noti(1), noti(2)],
      { 'POST /api/notificaciones/leidas': () => ok({ fallidas: [2] }) },
    );
    await usuario.click(campanita);
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    await usuario.click(within(panel).getByRole('button', { name: 'Marcar todas como leídas' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/No se pudo marcar/);
    await waitFor(() => expect(sinLeer()).not.toBeNull());
  });

  it('el panel vive en un hijo directo de body, con posición calculada', async () => {
    const { usuario, campanita } = await abrirCampanita([noti(1)]);
    await usuario.click(campanita);
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.top).not.toBe('');
    expect(panel.style.right).not.toBe('');
  });

  it('al fallar marcar, el aviso no le saca el foco a la pantalla a la que se navegó', async () => {
    const { usuario, campanita } = await abrirCampanita([noti(1)], {
      'POST /api/notificaciones/1/leida': () => falla(500, 'interno', 'Falló'),
    });
    await usuario.click(campanita);
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    await usuario.click(within(panel).getByRole('button', { name: /Tarea 1/ }));
    const reabierto = await screen.findByRole('dialog', { name: 'Notificaciones' });
    expect(reabierto.contains(document.activeElement)).toBe(false);
  });

  it('al abrir, el foco queda en la parte que se desplaza: las flechas y AvPág mueven la lista', async () => {
    const { usuario, campanita } = await abrirCampanita([noti(1)]);
    await usuario.click(campanita);
    const panel = await screen.findByRole('dialog', { name: 'Notificaciones' });
    await waitFor(() => expect(panel.querySelector('.notificaciones__desplazable')).toHaveFocus());
  });

  it('el token vencido cierra el panel', async () => {
    const { usuario, campanita } = await abrirCampanita([noti(1)]);
    await usuario.click(campanita);
    await screen.findByRole('dialog', { name: 'Notificaciones' });
    act(() => {
      window.dispatchEvent(new Event(EVENTO_TOKEN_VENCIDO));
    });
    expect(screen.queryByRole('dialog', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('Escape y el clic afuera cierran el panel', async () => {
    const { usuario, campanita } = await abrirCampanita([noti(1)]);
    await usuario.click(campanita);
    await screen.findByRole('dialog', { name: 'Notificaciones' });
    await usuario.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notificaciones' })).not.toBeInTheDocument();
    expect(campanita).toHaveFocus();
    await usuario.click(campanita);
    await screen.findByRole('dialog', { name: 'Notificaciones' });
    await usuario.click(document.body);
    expect(screen.queryByRole('dialog', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('sin notificaciones lo dice', async () => {
    const { usuario, campanita } = await abrirCampanita([]);
    await usuario.click(campanita);
    expect(await screen.findByText('No tenés notificaciones.')).toBeInTheDocument();
  });
});
