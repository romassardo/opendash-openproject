import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { hoyArgentina, sumarDias } from '../../compartido/fechas.js';
import type { EstadoHoras, Tarea, Tramo } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { etiquetaRetomar } from '../inicio/RetomarUltimoDia.js';
import { CATALOGO, limpiarEntorno, ok, prepararEntorno, simularApi, TAREAS } from '../../pruebas/fabricas/web.js';
import { pideEstimado } from './estimacion.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
  try { localStorage.clear(); } catch { /* sin almacenamiento */ }
});

const tramoDe = (extra: Partial<Tramo> = {}): Tramo => ({
  id: 1, usuarioId: 9, tareaId: 1, dia: hoyArgentina(), inicio: '2026-10-23T12:00:00Z', fin: null, pausado: false, segundos: null,
  frenadoSolo: null, avisoVisto: false, estado: 'abierto', entradaOpId: null, motivo: null, ...extra,
});
const estadoDe = (extra: Partial<EstadoHoras> = {}): EstadoHoras => ({
  enMarcha: [], hoy: [], avisos: [], totalHoySegundos: 0, jornadaSegundos: 28800, variasALaVez: false, horasExtra: false, ultimoDia: null, ...extra,
});
const corre = (tareaId: number): EstadoHoras['enMarcha'][number] => ({ ...tramoDe({ id: 100 + tareaId, tareaId }), segundosVivos: 0 });

/** El ▶ de la tarjeta T1 en el tablero de Tareas. */
async function jugarT1(usuario: ReturnType<typeof userEvent.setup>) {
  const region = await screen.findByRole('region', { name: 'Nuevo' });
  await within(region).findByText('T1');
  await usuario.click(within(region).getByRole('button', { name: 'Trabajar en esta: T1' }));
}

const arranques = (llamadas: { metodo: string; ruta: string; cuerpo?: unknown }[]) =>
  llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/api/horas').map((l) => (l.cuerpo as { tareaId: number }).tareaId);

describe('Horas extra', () => {
  it('con el día lleno, ▶ pregunta antes: «Cancelar» no arranca y «Seguir con horas extra» marca el día y arranca', async () => {
    prepararEntorno('/tareas');
    let estado = estadoDe({ totalHoySegundos: 28800 });
    const api = simularApi({
      'GET /api/horas': () => ok(estado),
      'POST /api/horas/extra': () => { estado = { ...estado, horasExtra: true }; return ok(estado); },
      'POST /api/horas': () => ok(tramoDe()),
    });
    render(<App />);
    const usuario = userEvent.setup();
    await jugarT1(usuario);
    const dialogo = await screen.findByRole('dialog', { name: 'Ya llegaste a las 8 h de hoy' });
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Ya llegaste a las 8 h de hoy' })).toBeNull();
    expect(arranques(api.llamadas)).toEqual([]);

    await jugarT1(usuario);
    await usuario.click(within(await screen.findByRole('dialog', { name: 'Ya llegaste a las 8 h de hoy' })).getByRole('button', { name: 'Seguir con horas extra' }));
    await waitFor(() => expect(arranques(api.llamadas)).toEqual([1]));
    const rutas = api.llamadas.map((l) => `${l.metodo} ${l.ruta}`);
    expect(rutas.indexOf('POST /api/horas/extra')).toBeLessThan(rutas.indexOf('POST /api/horas'));
  });

  it('con horas extra ya confirmadas, ▶ no vuelve a preguntar', async () => {
    prepararEntorno('/tareas');
    const api = simularApi({ 'GET /api/horas': ok(estadoDe({ totalHoySegundos: 30000, horasExtra: true })), 'POST /api/horas': ok(tramoDe()) });
    render(<App />);
    await jugarT1(userEvent.setup());
    await waitFor(() => expect(arranques(api.llamadas)).toEqual([1]));
    expect(screen.queryByRole('dialog', { name: /Ya llegaste/ })).toBeNull();
  });

  it('el aviso del tope de hoy ofrece seguir con horas extra: marca el día, retoma la tarea y da el aviso por visto', async () => {
    prepararEntorno('/equipo');
    const frenado = tramoDe({ id: 7, tareaId: 2, fin: '2026-10-23T20:00:00Z', segundos: 28800, frenadoSolo: 'tope', estado: 'cargado' });
    const api = simularApi({
      'GET /api/horas': ok(estadoDe({ avisos: [frenado], totalHoySegundos: 28800 })),
      'POST /api/horas/extra': ok(estadoDe({ avisos: [frenado], totalHoySegundos: 28800, horasExtra: true })),
      'POST /api/horas': ok(tramoDe({ tareaId: 2 })),
      'POST /api/horas/7/aviso-visto': ok({ ...frenado, avisoVisto: true }),
    });
    render(<App />);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Seguir con horas extra' }));
    await waitFor(() => expect(api.llamadas.map((l) => `${l.metodo} ${l.ruta}`)).toContain('POST /api/horas/7/aviso-visto'));
    expect(arranques(api.llamadas)).toEqual([2]);
    expect(api.llamadas.map((l) => l.ruta)).toContain('/api/horas/extra');
    // El aviso del tope ya es un botón explícito: no se pregunta otra vez.
    expect(screen.queryByRole('dialog', { name: /Ya llegaste/ })).toBeNull();
  });

  it('un tope de otro día no ofrece horas extra', async () => {
    prepararEntorno('/equipo');
    const viejo = tramoDe({ dia: sumarDias(hoyArgentina(), -1), fin: '2026-10-23T20:00:00Z', segundos: 28800, frenadoSolo: 'tope', estado: 'cargado' });
    simularApi({ 'GET /api/horas': ok(estadoDe({ avisos: [viejo] })) });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Está bien' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /horas extra/ })).toBeNull();
  });
});

describe('Pedir el estimado al arrancar', () => {
  const conTareas = (estimacion: number | null) => ({
    'GET /api/tareas': ok({ tareas: TAREAS.map((t) => (t.id === 1 ? { ...t, lockVersion: 4, estimacionHoras: estimacion } : t)), dependencias: [] }),
  });

  it('una tarea sin estimado lo pide; «Guardar» lo manda con el lockVersion', async () => {
    prepararEntorno('/tareas');
    const api = simularApi({
      ...conTareas(null),
      'POST /api/horas': ok(tramoDe()),
      'PATCH /api/tareas/1': ok({ ...TAREAS[0]!, lockVersion: 5, estimacionHoras: 2.5 }),
    });
    render(<App />);
    const usuario = userEvent.setup();
    await jugarT1(usuario);
    const form = await screen.findByRole('form', { name: 'Estimado de T1' });
    expect(within(form).getByText('«T1» no tiene estimado. ¿Cuántas horas le calculás?')).toBeInTheDocument();
    await usuario.type(within(form).getByLabelText(/no tiene estimado/), 'dos');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Escribí las horas como un número, por ejemplo 2 o 1,5.')).toBeInTheDocument();
    await usuario.clear(within(form).getByLabelText(/no tiene estimado/));
    await usuario.type(within(form).getByLabelText(/no tiene estimado/), '2,5');
    await usuario.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Estimado de T1' })).toBeNull());
    expect(api.llamadas).toContainEqual({ metodo: 'PATCH', ruta: '/api/tareas/1', cuerpo: { lockVersion: 4, cambios: { estimacionHoras: 2.5 } } });
  });

  it('«Ahora no» no lo vuelve a pedir hoy para esa tarea', async () => {
    prepararEntorno('/tareas');
    simularApi({ ...conTareas(null), 'POST /api/horas': ok(tramoDe()) });
    render(<App />);
    const usuario = userEvent.setup();
    await jugarT1(usuario);
    await usuario.click(within(await screen.findByRole('form', { name: 'Estimado de T1' })).getByRole('button', { name: 'Ahora no' }));
    expect(screen.queryByRole('form', { name: 'Estimado de T1' })).toBeNull();
    expect(JSON.parse(localStorage.getItem('od:estimar-salteadas')!)).toEqual({ dia: hoyArgentina(), ids: [1] });
    await jugarT1(usuario);
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Estimado de T1' })).toBeNull());
  });

  it('la regla: sin estimado sí; con estimado, en hitos y en tareas con subtareas no', () => {
    const tarea = (id: number, extra: Partial<Tarea> = {}): Tarea => ({ ...TAREAS[0]!, id, estimacionHoras: null, tipoId: 1, madreId: null, ...extra });
    const madre = tarea(20);
    const lista = [madre, tarea(21, { madreId: 20 })];
    expect(pideEstimado(tarea(1), lista, CATALOGO)).toBe(true);
    expect(pideEstimado(tarea(1, { estimacionHoras: 2 }), lista, CATALOGO)).toBe(false);
    expect(pideEstimado(tarea(1, { tipoId: 2 }), lista, CATALOGO)).toBe(false);
    expect(pideEstimado(madre, lista, CATALOGO)).toBe(false);
  });

  it('una tarea que ya tiene estimado no lo pide', async () => {
    prepararEntorno('/tareas');
    const api = simularApi({ ...conTareas(3), 'POST /api/horas': ok(tramoDe()) });
    render(<App />);
    await jugarT1(userEvent.setup());
    await waitFor(() => expect(arranques(api.llamadas)).toEqual([1]));
    expect(screen.queryByRole('form', { name: /Estimado de/ })).toBeNull();
  });
});

describe('Retomar lo del último día', () => {
  const ayer = (): string => sumarDias(hoyArgentina(), -1);

  it('la etiqueta nombra el día', () => {
    expect(etiquetaRetomar('2026-11-03', '2026-11-04')).toBe('Retomar lo de ayer');
    expect(etiquetaRetomar('2026-10-30', '2026-11-02')).toBe('Retomar lo del viernes');
    expect(etiquetaRetomar('2026-10-20', '2026-11-04')).toBe('Retomar lo del 20/10');
  });

  it('con varias a la vez, lista las abiertas de ayer tildadas y retoma solo las que quedan tildadas, en orden', async () => {
    prepararEntorno('/inicio');
    // La 8 está cerrada y la 3 ya corre: no se ofrecen.
    const api = simularApi({
      'GET /api/horas': ok(estadoDe({ variasALaVez: true, enMarcha: [corre(3)], ultimoDia: { dia: ayer(), tareaIds: [2, 8, 1, 3, 6] } })),
      'POST /api/horas': ok(tramoDe()),
    });
    render(<App />);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Retomar lo de ayer' }));
    const form = screen.getByRole('form', { name: 'Retomar lo de ayer' });
    const opciones = within(form).getAllByRole('checkbox');
    expect(opciones.map((o) => o.closest('label')!.textContent)).toEqual(['T2', 'T1', 'T6']);
    expect(opciones.every((o) => (o as HTMLInputElement).checked)).toBe(true);
    await usuario.click(within(form).getByRole('checkbox', { name: 'T1' }));
    await usuario.click(within(form).getByRole('button', { name: 'Retomar 2' }));
    await waitFor(() => expect(arranques(api.llamadas)).toEqual([2, 6]));
  });

  it('sin varias a la vez se elige una sola', async () => {
    prepararEntorno('/inicio');
    const api = simularApi({ 'GET /api/horas': ok(estadoDe({ ultimoDia: { dia: ayer(), tareaIds: [2, 1] } })), 'POST /api/horas': ok(tramoDe()) });
    render(<App />);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Retomar lo de ayer' }));
    const form = screen.getByRole('form', { name: 'Retomar lo de ayer' });
    expect(within(form).getByRole('radio', { name: 'T2' })).toBeChecked();
    await usuario.click(within(form).getByRole('radio', { name: 'T1' }));
    await usuario.click(within(form).getByRole('button', { name: 'Retomar' }));
    await waitFor(() => expect(arranques(api.llamadas)).toEqual([1]));
  });

  it('sin último día, o si no queda nada para retomar, no aparece', async () => {
    prepararEntorno('/inicio');
    simularApi({ 'GET /api/horas': ok(estadoDe({ ultimoDia: { dia: ayer(), tareaIds: [8] } })) });
    render(<App />);
    await screen.findByRole('heading', { name: 'Trabajando ahora' });
    expect(screen.queryByRole('button', { name: /Retomar/ })).toBeNull();
  });
});
