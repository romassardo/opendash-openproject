import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { CATALOGO, falla, limpiarEntorno, ok, prepararEntorno, simularApi, type Llamada, type Manejador } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { MSG_CONFLICTO } from '../tareas/acciones.js';
import { MSG_SIN_PERMISO } from './escrituras.js';
import { CLAVES, type ListaTareas } from '../api/consultas.js';

// Se necesita el cliente de consultas de la App para simular un refresco con un cambio ajeno.
const guardado = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock('../api/consultas.js', async (original) => {
  const real = await original<typeof import('../api/consultas.js')>();
  return { ...real, crearClienteConsultas: () => (guardado.cliente = real.crearClienteConsultas()) };
});
const cliente = (): QueryClient => guardado.cliente as QueryClient;

// Martes 20 de octubre de 2026: en Mes la pista mide 16 px por día.
const AHORA = new Date('2026-10-20T15:00:00Z');
const PX = 16;

class ObservadorFalso {
  constructor(private readonly alMedir: ResizeObserverCallback) {}
  observe(): void {
    this.alMedir([{ contentRect: { width: 1250 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: AHORA });
  vi.stubGlobal('ResizeObserver', ObservadorFalso);
});

afterEach(() => {
  cleanup();
  limpiarEntorno();
  vi.useRealTimers();
});

const COBRANZAS = tareaDe(2, { titulo: 'Cobranzas', proyectoId: 11, inicio: '2026-10-20', fin: '2026-11-03', estadoId: 7 });
const TAREAS: Tarea[] = [
  tareaDe(1, { titulo: 'Relevamiento', proyectoId: 11, inicio: '2026-10-13', fin: '2026-10-19', estadoId: 12 }),
  COBRANZAS,
  tareaDe(3, { titulo: 'Salida', proyectoId: 12, tipoId: 2, inicio: '2026-10-28', fin: '2026-10-28' }),
  tareaDe(5, { titulo: 'Corta', proyectoId: 12, inicio: '2026-11-09', fin: '2026-11-09' }),
  tareaDe(10, { titulo: 'Madre automática', proyectoId: 12, inicio: '2026-10-21', fin: '2026-10-30', programacionManual: false }),
  tareaDe(6, { titulo: 'Sigue a Cobranzas', proyectoId: 11, inicio: '2026-11-04', fin: '2026-11-10', programacionManual: false }),
  tareaDe(7, { titulo: 'Empieza antes', proyectoId: 12, inicio: '2026-08-03', fin: '2026-10-30' }),
  tareaDe(8, { titulo: 'Sigue después', proyectoId: 12, inicio: '2026-10-21', fin: '2027-03-01' }),
  tareaDe(11, { titulo: 'Hija', proyectoId: 12, madreId: 10, inicio: '2026-10-21', fin: '2026-10-25' }),
];

async function abrir(patch?: Manejador, dependencias: Dependencia[] = []) {
  prepararEntorno('/linea-de-tiempo?zoom=mes');
  // El servidor simulado se acuerda de lo guardado: la lista que vuelve a pedir la web ya trae las fechas nuevas.
  const guardadas = new Map<number, Tarea>();
  const guardando: Manejador | undefined = patch && ((cuerpo) => {
    const respuesta = typeof patch === 'function' ? patch(cuerpo) : patch;
    const datos = (respuesta.cuerpo as { ok?: boolean; datos?: Tarea }).datos;
    if (respuesta.estado === 200 && datos) guardadas.set(datos.id, datos);
    return respuesta;
  });
  const api = simularApi({
    'GET /api/catalogo': ok(CATALOGO),
    'GET /api/tareas': () => ok({ tareas: TAREAS.map((t) => guardadas.get(t.id) ?? t), dependencias }),
    ...(guardando ? { 'PATCH /api/tareas/2': guardando, 'PATCH /api/tareas/3': guardando } : {}),
  });
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Línea de tiempo' });
  // El chip de proyecto también lo nombra: se espera el renglón del grupo.
  await within(await screen.findByRole('main')).findByText('Portal de clientes', { ignore: 'option, script, style' });
  return api;
}

const boton = (id: number): HTMLElement => document.querySelector<HTMLElement>(`[data-tarea-id="${id}"]`)!;
const fantasma = (): HTMLElement | null => document.querySelector<HTMLElement>('.barra__fantasma');
const patches = (api: { llamadas: Llamada[] }) => api.llamadas.filter((l) => l.metodo === 'PATCH');

/** Arrastra con el puntero: baja en `desde`, mueve y suelta `px` más allá. */
function arrastrar(objetivo: Element, boton: HTMLElement, px: number) {
  fireEvent.pointerDown(objetivo, { clientX: 300, button: 0, pointerId: 1 });
  fireEvent.pointerMove(boton, { clientX: 300 + px, pointerId: 1 });
  return () => fireEvent.pointerUp(boton, { clientX: 300 + px, pointerId: 1 });
}

describe('edición de fechas en la línea de tiempo', () => {
  it('soltar después de arrastrar tres días manda un solo PATCH con las fechas nuevas', async () => {
    const api = await abrir((cuerpo) => ok({ ...COBRANZAS, lockVersion: 2, ...(cuerpo as { cambios: object }).cambios }));
    const soltar = arrastrar(boton(2), boton(2), 3 * PX);
    // Mientras se arrastra se ve la barra fantasma con las fechas nuevas.
    expect(fantasma()!).toHaveTextContent('23 oct → 6 nov');
    expect(patches(api)).toHaveLength(0);
    soltar();
    await waitFor(() => expect(patches(api)).toHaveLength(1));
    expect(patches(api)[0]).toMatchObject({ ruta: '/api/tareas/2', cuerpo: { lockVersion: 1, cambios: { inicio: '2026-10-23', fin: '2026-11-06' } } });
    await waitFor(() => expect(boton(2)).toHaveAttribute('aria-label', 'Cobranzas, En curso, del 23 oct al 6 nov'));
    expect(fantasma()).toBeNull();
  });

  it('estirar el borde del fin cambia solo el fin', async () => {
    const api = await abrir((cuerpo) => ok({ ...COBRANZAS, ...(cuerpo as { cambios: object }).cambios }));
    const borde = boton(2).querySelector('[data-gesto="fin"]')!;
    arrastrar(borde, boton(2), 2 * PX)();
    await waitFor(() => expect(patches(api)).toHaveLength(1));
    expect(patches(api)[0]?.cuerpo).toEqual({ lockVersion: 1, cambios: { fin: '2026-11-05' } });
  });

  it('un hito se mueve y viaja con su fecha', async () => {
    const api = await abrir((cuerpo) => ok({ ...TAREAS[2], ...(cuerpo as { cambios: object }).cambios }));
    expect(boton(3).querySelector('[data-gesto]')).toBeNull();
    arrastrar(boton(3), boton(3), -2 * PX)();
    await waitFor(() => expect(patches(api)).toHaveLength(1));
    expect(patches(api)[0]).toMatchObject({ ruta: '/api/tareas/3', cuerpo: { lockVersion: 1, cambios: { fecha: '2026-10-26' } } });
  });

  it('un clic sin desplazamiento abre el detalle y no escribe', async () => {
    const api = await abrir();
    const usuario = userEvent.setup({ advanceTimers: () => {} });
    await usuario.click(boton(2));
    await waitFor(() => expect(window.location.pathname).toBe('/linea-de-tiempo/tareas/2'));
    expect(patches(api)).toHaveLength(0);
  });

  it('un 409 al soltar recarga la tarea y avisa sin pisar', async () => {
    const api = await abrir(falla(409, 'conflicto', 'Cambió en OpenProject'));
    arrastrar(boton(2), boton(2), 3 * PX)();
    expect(await screen.findByText(MSG_CONFLICTO)).toBeInTheDocument();
    expect(boton(2)).toHaveAttribute('aria-label', 'Cobranzas, En curso, del 20 oct al 3 nov');
    await waitFor(() => expect(api.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === '/api/tareas')).toHaveLength(2));
  });

  it('un 403 vuelve la barra y avisa que no hay permiso', async () => {
    const api = await abrir(falla(403, 'prohibido', 'No tenés permiso para hacer eso en OpenProject'));
    arrastrar(boton(2), boton(2), 3 * PX)();
    expect(await screen.findByText(MSG_SIN_PERMISO)).toBeInTheDocument();
    expect(MSG_SIN_PERMISO).toBe('No tenés permiso para cambiar esta tarea en OpenProject.');
    expect(boton(2)).toHaveAttribute('aria-label', 'Cobranzas, En curso, del 20 oct al 3 nov');
    expect(patches(api)).toHaveLength(1);
  });

  it('Alt+flecha y Enter guarda; Escape descarta', async () => {
    const api = await abrir((cuerpo) => ok({ ...COBRANZAS, ...(cuerpo as { cambios: object }).cambios }));
    const usuario = userEvent.setup({ advanceTimers: () => {} });
    boton(2).focus();
    await usuario.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(fantasma()!).toHaveTextContent('21 oct → 4 nov');
    await usuario.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(fantasma()!).toHaveTextContent('21 oct → 5 nov');
    expect(patches(api)).toHaveLength(0);
    await usuario.keyboard('{Escape}');
    expect(fantasma()).toBeNull();
    expect(patches(api)).toHaveLength(0);

    await usuario.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await usuario.keyboard('{Enter}');
    await waitFor(() => expect(patches(api)).toHaveLength(1));
    expect(patches(api)[0]?.cuerpo).toEqual({ lockVersion: 1, cambios: { inicio: '2026-10-19', fin: '2026-11-02' } });
    // Enter con una vista previa guarda: no abre el detalle.
    expect(window.location.pathname).toBe('/linea-de-tiempo');
  });

  it('una barra de menos de 24 px solo se mueve, sin bordes de estirar', async () => {
    await abrir();
    expect(boton(5).querySelector('[data-gesto]')).toBeNull();
    expect(boton(2).querySelectorAll('[data-gesto]')).toHaveLength(2);
  });

  it('un grupo automático no se arrastra', async () => {
    const api = await abrir();
    const corchete = boton(10);
    expect(corchete.querySelector('[data-gesto]')).toBeNull();
    arrastrar(corchete, corchete, 3 * PX)();
    expect(fantasma()).toBeNull();
    corchete.focus();
    await userEvent.setup({ advanceTimers: () => {} }).keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(fantasma()).toBeNull();
    expect(patches(api)).toHaveLength(0);
  });

  it('una tarea que espera a otra no se arrastra, esté en manual o en automático', async () => {
    const api = await abrir(undefined, [{ id: 1, predecesoraId: 2, sucesoraId: 6, lag: 0 }]);
    const automatica = boton(6);
    expect(automatica.querySelector('[data-gesto]')).toBeNull();
    expect(automatica).toHaveAttribute('title', 'Va sola detrás de «Cobranzas»');
    arrastrar(automatica, automatica, 3 * PX)();
    expect(fantasma()).toBeNull();
    automatica.focus();
    await userEvent.setup({ advanceTimers: () => {} }).keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(fantasma()).toBeNull();
    expect(patches(api)).toHaveLength(0);
    // Sigue pudiendo abrirse el detalle.
    await userEvent.setup({ advanceTimers: () => {} }).click(automatica);
    await waitFor(() => expect(window.location.pathname).toBe('/linea-de-tiempo/tareas/6'));
  });

  it('una tarea automática sin predecesoras sí se arrastra', async () => {
    await abrir(undefined, []);
    expect(boton(6).querySelectorAll('[data-gesto]')).toHaveLength(2);
  });

  it('guardar bien vuelve a pedir las tareas para ver lo que OpenProject reprogramó', async () => {
    const api = await abrir((cuerpo) => ok({ ...COBRANZAS, lockVersion: 2, ...(cuerpo as { cambios: object }).cambios }));
    const pedidas = () => api.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === '/api/tareas').length;
    const antes = pedidas();
    arrastrar(boton(2), boton(2), 3 * PX)();
    await waitFor(() => expect(pedidas()).toBe(antes + 1));
  });

  it('una barra cortada no ofrece estirar del lado del corte', async () => {
    await abrir();
    const empiezaAntes = boton(7);
    expect(empiezaAntes).toHaveClass('barra--corta-izq');
    expect([...empiezaAntes.querySelectorAll('[data-gesto]')].map((b) => b.getAttribute('data-gesto'))).toEqual(['fin']);
    const sigueHasta = boton(8);
    expect(sigueHasta).toHaveClass('barra--corta-der');
    expect([...sigueHasta.querySelectorAll('[data-gesto]')].map((b) => b.getAttribute('data-gesto'))).toEqual(['inicio']);
  });

  it('si llega un cambio ajeno durante la vista previa con teclado, guardar usa el lockVersion del inicio y no pisa', async () => {
    const api = await abrir(falla(409, 'conflicto', 'Cambió en OpenProject'));
    const usuario = userEvent.setup({ advanceTimers: () => {} });
    boton(2).focus();
    await usuario.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(fantasma()!).toHaveTextContent('21 oct → 4 nov');
    // En el medio llega un refresco con un cambio ajeno (lockVersion nuevo y otras fechas).
    act(() => {
      cliente().setQueryData<ListaTareas>(CLAVES.tareas, (lista) => lista && ({
        ...lista, tareas: lista.tareas.map((t) => (t.id === 2 ? { ...t, lockVersion: 5, inicio: '2026-10-27', fin: '2026-11-10' } : t)),
      }));
    });
    await usuario.keyboard('{Enter}');
    await waitFor(() => expect(patches(api)).toHaveLength(1));
    expect(patches(api)[0]?.cuerpo).toEqual({ lockVersion: 1, cambios: { inicio: '2026-10-21', fin: '2026-11-04' } });
    expect(await screen.findByText(MSG_CONFLICTO)).toBeInTheDocument();
  });

  it('Alt+Shift sobre un hito, o volver al punto de partida, no deja fantasma', async () => {
    await abrir();
    const usuario = userEvent.setup({ advanceTimers: () => {} });
    boton(3).focus();
    await usuario.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(fantasma()).toBeNull();
    boton(2).focus();
    await usuario.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(fantasma()).not.toBeNull();
    await usuario.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    expect(fantasma()).toBeNull();
  });

  it('Alt+flecha con una barra enfocada nunca navega, aunque no sea editable', async () => {
    await abrir();
    // Un corchete no se edita, pero el navegador no debe volver atrás en plena demostración.
    const noEditable = fireEvent.keyDown(boton(10), { key: 'ArrowLeft', altKey: true });
    expect(noEditable).toBe(false);
    expect(fireEvent.keyDown(boton(2), { key: 'ArrowRight', altKey: true })).toBe(false);
    // Una flecha sin Alt sigue siendo del navegador.
    expect(fireEvent.keyDown(boton(10), { key: 'ArrowLeft' })).toBe(true);
  });

  it('mientras se guarda, la barra no empieza otro gesto', async () => {
    const api = await abrir((cuerpo) => ok({ ...COBRANZAS, lockVersion: 2, ...(cuerpo as { cambios: object }).cambios }));
    // Se retiene el PATCH para que el primer guardado siga en vuelo.
    const real = fetch;
    let soltar: () => void = () => {};
    const compuerta = new Promise<void>((resolver) => { soltar = resolver; });
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PATCH' ? compuerta.then(() => real(entrada, init)) : real(entrada, init));
    arrastrar(boton(2), boton(2), 3 * PX)();
    await waitFor(() => expect(boton(2)).toHaveAttribute('aria-label', 'Cobranzas, En curso, del 23 oct al 6 nov'));
    // Segundo gesto con puntero y con teclado: ninguno arranca (el fantasma sigue siendo el del primero).
    fireEvent.pointerDown(boton(2), { clientX: 300, button: 0, pointerId: 2 });
    fireEvent.pointerMove(boton(2), { clientX: 300 + PX, pointerId: 2 });
    expect(fantasma()!).toHaveTextContent('23 oct → 6 nov');
    fireEvent.pointerUp(boton(2), { clientX: 300 + PX, pointerId: 2 });
    boton(2).focus();
    await userEvent.setup({ advanceTimers: () => {} }).keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(fantasma()!).toHaveTextContent('23 oct → 6 nov');
    soltar();
    await waitFor(() => expect(boton(2)).toHaveAttribute('aria-label', 'Cobranzas, En curso, del 23 oct al 6 nov'));
    expect(patches(api)).toHaveLength(1);
  });

  it('después de guardar, un segundo movimiento con teclado usa el lockVersion devuelto y guarda bien', async () => {
    const api = await abrir((cuerpo) => {
      const { lockVersion, cambios } = cuerpo as { lockVersion: number; cambios: object };
      return lockVersion === 1 ? ok({ ...COBRANZAS, lockVersion: 2, ...cambios }) : ok({ ...COBRANZAS, lockVersion: 3, ...cambios });
    });
    const usuario = userEvent.setup({ advanceTimers: () => {} });
    arrastrar(boton(2), boton(2), 3 * PX)();
    await waitFor(() => expect(boton(2)).toHaveAttribute('aria-label', 'Cobranzas, En curso, del 23 oct al 6 nov'));
    await waitFor(() => expect(patches(api)).toHaveLength(1));
    boton(2).focus();
    await usuario.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await usuario.keyboard('{Enter}');
    await waitFor(() => expect(patches(api)).toHaveLength(2));
    expect(patches(api)[1]?.cuerpo).toMatchObject({ lockVersion: 2 });
    expect(screen.queryByText(MSG_CONFLICTO)).toBeNull();
  });

  it('Alt+← dos veces sobre una tarea que empieza el lunes la lleva a la semana anterior', async () => {
    await abrir();
    const usuario = userEvent.setup({ advanceTimers: () => {} });
    boton(5).focus();
    // Corta empieza el lunes 9 nov: dos pasos atrás son 7 nov (sábado) y 6 nov (viernes), sin saltar de vuelta al lunes.
    await usuario.keyboard('{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}');
    expect(fantasma()!).toHaveTextContent('7 nov');
  });

  it('una falla que no es 409 vuelve a pedir las tareas', async () => {
    const api = await abrir(falla(422, 'validacion', 'La fecha no es válida'));
    const pedidas = () => api.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === '/api/tareas').length;
    arrastrar(boton(2), boton(2), 3 * PX)();
    await screen.findByText(/fecha no es válida/i);
    await waitFor(() => expect(pedidas()).toBe(2));
  });
});
