import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { CalendarioPropio, EstadoHoras, Reunion, Tramo } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { hoyArgentina } from '../fechas.js';
import { AJUSTES, falla, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const HOY = hoyArgentina();
const AHORA = new Date().toISOString();

// Mías para hoy: tres abiertas (una vencida) y una cerrada hoy; ajenas y de otro día no cuentan.
const TAREAS_HOY = [
  tareaDe(1, { titulo: 'Revisar informe', responsableId: 9, estadoId: 1, fin: HOY }),
  tareaDe(2, { titulo: 'Armar presupuesto', responsableId: 9, estadoId: 7, fin: HOY, prioridadId: 9 }),
  tareaDe(3, { titulo: 'Tarea atrasada', responsableId: 9, estadoId: 4, fin: '2020-01-01' }),
  tareaDe(4, { titulo: 'Ya la cerré', responsableId: 9, estadoId: 12, fin: HOY, cerradaEl: AHORA }),
  tareaDe(5, { titulo: 'De otra persona', responsableId: 5, estadoId: 1, fin: HOY }),
  tareaDe(6, { titulo: 'Para mañana', responsableId: 9, estadoId: 1, fin: '2999-01-01' }),
];

const tramoDe = (extra: Partial<Tramo> = {}): Tramo => ({
  id: 1, usuarioId: 9, tareaId: 1, dia: HOY, inicio: AHORA, fin: null, pausado: false, segundos: null,
  frenadoSolo: null, avisoVisto: false, estado: 'abierto', entradaOpId: null, motivo: null, ...extra,
});
const estadoDe = (extra: Partial<EstadoHoras> = {}): EstadoHoras => ({
  enMarcha: [], hoy: [], avisos: [], totalHoySegundos: 0, jornadaSegundos: 28800, variasALaVez: false, horasExtra: false, ultimoDia: null, ...extra,
});

type Rutas = Parameters<typeof simularApi>[0];

async function abrirInicio(rutas: Rutas = {}, ruta = '/inicio') {
  prepararEntorno(ruta);
  const api = simularApi({ 'GET /api/tareas': ok({ tareas: TAREAS_HOY, dependencias: [] }), ...rutas });
  render(<App />);
  await screen.findByRole('heading', { level: 1 });
  return { api, usuario: userEvent.setup() };
}

const contador = (etiqueta: string) => screen.getByText(etiqueta).closest('dl')!;

describe('Inicio', () => {
  it('saluda por el nombre y resume las tareas de hoy', async () => {
    await abrirInicio();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(/, Ana$/);
    expect(await screen.findByText(/· 4 tareas para hoy$/)).toBeInTheDocument();
    expect(contador('Hechas hoy')).toHaveTextContent(/1\s*\/\s*4/);
    expect(contador('Horas hoy')).toHaveTextContent('0 m');
    expect(contador('Vencidas')).toHaveTextContent('1');
    const mias = screen.getByRole('region', { name: 'Mis tareas' });
    expect(within(mias).getAllByRole('checkbox')).toHaveLength(3);
    expect(within(mias).queryByText('Para mañana')).not.toBeInTheDocument();
    expect(within(mias).queryByText('De otra persona')).not.toBeInTheDocument();
    expect(within(mias).getByText('Alta')).toBeInTheDocument();
    expect(within(mias).getByRole('link', { name: 'Todas' })).toHaveAttribute('href', '/tareas?persona=mias');
  });

  it('en Inicio, las vencidas enlazan a /para-ordenar', async () => {
    await abrirInicio();
    expect(await within(contador('Vencidas')).findByRole('link')).toHaveAttribute('href', '/para-ordenar');
  });

  it('cerrar una tarea desde Mis tareas la mueve a Cerrado', async () => {
    const { api, usuario } = await abrirInicio({
      'POST /api/tareas/1/mover': ok({ ...TAREAS_HOY[0], estadoId: 12, lockVersion: 2, cerradaEl: new Date().toISOString() }),
    });
    const mias = await screen.findByRole('region', { name: 'Mis tareas' });
    await usuario.click(await within(mias).findByRole('checkbox', { name: 'Completar «Revisar informe»' }));
    expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas/1/mover', cuerpo: { lockVersion: 1, columna: 'cerrado' } });
    await waitFor(() => expect(within(mias).queryByText('Revisar informe')).not.toBeInTheDocument());
    expect(contador('Hechas hoy')).toHaveTextContent(/2\s*\/\s*4/);
  });

  it('la fila cerrada vuelve al deshacer', async () => {
    const { api, usuario } = await abrirInicio({
      'POST /api/tareas/1/mover': ok({ ...TAREAS_HOY[0], estadoId: 12, lockVersion: 2, cerradaEl: new Date().toISOString() }),
      'PATCH /api/tareas/1': ok({ ...TAREAS_HOY[0], lockVersion: 3 }),
    });
    const mias = await screen.findByRole('region', { name: 'Mis tareas' });
    await usuario.click(await within(mias).findByRole('checkbox', { name: 'Completar «Revisar informe»' }));
    await waitFor(() => expect(within(mias).queryByText('Revisar informe')).not.toBeInTheDocument());
    await usuario.click(await screen.findByRole('button', { name: 'Deshacer' }));
    expect(await within(mias).findByText('Revisar informe')).toBeInTheDocument();
    expect(api.llamadas.some((l) => l.metodo === 'PATCH' && l.ruta === '/api/tareas/1')).toBe(true);
  });

  it('Inicio muestra Horas hoy y el anillo contra la jornada', async () => {
    await abrirInicio({ 'GET /api/horas': ok(estadoDe({ totalHoySegundos: 12000 })) });
    await waitFor(() => expect(contador('Horas hoy')).toHaveTextContent('3 h 20 m'));
    expect(screen.getByRole('img', { name: /Horas: 3,3 de 8 h/ })).toBeInTheDocument();
    const hoy = screen.getByRole('region', { name: 'Hoy' });
    expect(within(hoy).getByText('Horas')).toBeInTheDocument();
    expect(within(hoy).queryByText('Foco')).not.toBeInTheDocument();
  });

  it('Horas hoy y el anillo avanzan en vivo mientras corre el cronómetro', async () => {
    // Solo el reloj de pared: el paso de un segundo del cronómetro sigue siendo el real.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await abrirInicio({
        'GET /api/horas': ok(estadoDe({ enMarcha: [{ ...tramoDe(), segundosVivos: 0 }], totalHoySegundos: 600 })),
      });
      await waitFor(() => expect(contador('Horas hoy')).toHaveTextContent('10 m'));
      vi.setSystemTime(Date.now() + 120_000);
      await waitFor(() => expect(contador('Horas hoy')).toHaveTextContent('12 m'), { timeout: 3000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sin estado de horas la meta es la jornada de los ajustes del equipo', async () => {
    await abrirInicio({
      'GET /api/horas': falla(500, 'interno', 'no anda'),
      'GET /api/ajustes': ok({ ...AJUSTES, horas: { jornadaHoras: 6 } }),
    });
    expect(await screen.findByRole('img', { name: /Horas: 0 de 6 h/ })).toBeInTheDocument();
  });

  it('Trabajando ahora: elegir tarea y ▶', async () => {
    const { api, usuario } = await abrirInicio({ 'POST /api/horas': ok(tramoDe()) });
    const tarjeta = await screen.findByRole('region', { name: 'Trabajando ahora' });
    expect(within(tarjeta).getByText('No estás trabajando en nada')).toBeInTheDocument();
    await usuario.type(within(tarjeta).getByRole('combobox', { name: 'Tarea para trabajar' }), 'Revisar');
    await usuario.click(await screen.findByRole('option', { name: /Revisar informe/ }));
    expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/horas', cuerpo: { tareaId: 1 } });
  });

  it('Trabajando ahora lista lo que corre con Pausa y Terminar', async () => {
    const { api, usuario } = await abrirInicio({
      'GET /api/horas': ok(estadoDe({ enMarcha: [{ ...tramoDe(), segundosVivos: 125 }], totalHoySegundos: 125 })),
      'POST /api/horas/1/pausa': ok(tramoDe({ pausado: true })),
    });
    const tarjeta = await screen.findByRole('region', { name: 'Trabajando ahora' });
    expect(await within(tarjeta).findByText('Revisar informe')).toBeInTheDocument();
    expect(within(tarjeta).getByRole('timer')).toHaveTextContent(/^0:02:0\d$|^0:02:1\d$/);
    await usuario.click(within(tarjeta).getByRole('button', { name: 'Pausa' }));
    expect(api.llamadas.some((l) => l.ruta === '/api/horas/1/pausa')).toBe(true);
    expect(within(tarjeta).getByRole('button', { name: 'Terminar' })).toBeInTheDocument();
  });

  it('lista de hoy con corregir', async () => {
    const cargado = tramoDe({ id: 7, tareaId: 1, fin: AHORA, segundos: 3600, estado: 'cargado' });
    const pendiente = tramoDe({ id: 8, tareaId: 2, fin: AHORA, segundos: 1800, estado: 'pendiente' });
    const { api, usuario } = await abrirInicio({
      'GET /api/horas': ok(estadoDe({ hoy: [cargado, pendiente], totalHoySegundos: 5400 })),
      'PATCH /api/horas/7': ok({ ...cargado, segundos: 5400 }),
    });
    const tarjeta = await screen.findByRole('region', { name: 'Trabajando ahora' });
    expect(await within(tarjeta).findByText('Revisar informe')).toBeInTheDocument();
    expect(within(tarjeta).getByText('1 h')).toBeInTheDocument();
    expect(within(tarjeta).getByText('pendiente de cargar')).toBeInTheDocument();
    expect(within(tarjeta).getByText('cargado')).toBeInTheDocument();
    await usuario.click(within(tarjeta).getAllByRole('button', { name: /^Corregir/ })[0]!);
    expect(within(tarjeta).getByText('Cargaste 1 h en «Revisar informe»')).toBeInTheDocument();
    const minutos = within(tarjeta).getByRole('spinbutton', { name: 'Minutos' });
    await usuario.clear(minutos);
    await usuario.type(minutos, '30');
    await usuario.click(within(tarjeta).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.llamadas.some((l) => l.metodo === 'PATCH' && l.ruta === '/api/horas/7')).toBe(true));
  });

  it('un tramo de una tarea que no está en la lista local se rotula con su número', async () => {
    const ajeno = tramoDe({ id: 9, tareaId: 777, fin: AHORA, segundos: 600, estado: 'rechazado' });
    await abrirInicio({ 'GET /api/horas': ok(estadoDe({ hoy: [ajeno], totalHoySegundos: 600 })) });
    const tarjeta = await screen.findByRole('region', { name: 'Trabajando ahora' });
    expect(await within(tarjeta).findByText('Tarea #777')).toBeInTheDocument();
    expect(within(tarjeta).getByText('no se pudo cargar')).toBeInTheDocument();
  });

  it('entrar sin ruta lleva a Inicio', async () => {
    await abrirInicio({}, '/');
    expect(window.location.pathname).toBe('/inicio');
    expect(screen.getByRole('link', { name: /Inicio/ })).toHaveAttribute('aria-current', 'page');
  });

  it('sin tareas para hoy lo dice', async () => {
    await abrirInicio({ 'GET /api/tareas': ok({ tareas: [], dependencias: [] }) });
    expect(await screen.findByText('No tenés tareas para hoy.')).toBeInTheDocument();
    expect(screen.getByText('Conectá tu calendario de Outlook para ver tus reuniones acá')).toBeInTheDocument();
  });

  it('esta semana cuenta lo que cerró el equipo', async () => {
    await abrirInicio();
    const semana = screen.getByRole('region', { name: 'Esta semana' });
    expect(await within(semana).findByText(/1 cerrada hasta ahora/)).toBeInTheDocument();
  });
});

// Miércoles 21 de octubre de 2026, 10:30 en Argentina (13:30Z). Solo se fija el reloj de Date: los temporizadores siguen reales.
describe('Inicio con reuniones', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T13:30:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const reunion = (id: string, inicio: string, fin: string, extra: Partial<Reunion> = {}): Reunion =>
    ({ id, titulo: `Reunión ${id}`, lugar: null, inicio, fin, diaEntero: false, libre: false, enlace: null, plataforma: null, ...extra });
  const conCalendario = (reuniones: Reunion[], estado: CalendarioPropio['estado'] = { leido: '2026-10-21T13:00:00Z', falla: null }): CalendarioPropio =>
    ({ reuniones, estado, ventana: { desde: '2026-07-20', hasta: '2027-04-21' } });
  const abrir = (calendario: CalendarioPropio) =>
    abrirInicio({ 'GET /api/tareas': ok({ tareas: [], dependencias: [] }), 'GET /api/calendario': ok(calendario) });

  // 9:00-9:30 (ya pasó), 10:00-11:00 (en curso), 11:00-12:00 y 14:00-14:30 (siguientes), y una «libre» que no cuenta.
  const AGENDA = [
    reunion('a', '2026-10-21T12:00:00Z', '2026-10-21T12:30:00Z', { titulo: 'Stand-up' }),
    reunion('b', '2026-10-21T13:00:00Z', '2026-10-21T14:00:00Z', { titulo: 'Planificación', lugar: 'Sala Huddle', plataforma: 'teams', enlace: 'https://teams.microsoft.com/l/meetup-join/b' }),
    reunion('c', '2026-10-21T14:00:00Z', '2026-10-21T15:00:00Z', { titulo: 'Revisión', enlace: 'https://meet.google.com/abc-defg-hij', plataforma: 'meet' }),
    reunion('d', '2026-10-21T17:00:00Z', '2026-10-21T17:30:00Z', { titulo: 'Cierre' }),
    reunion('e', '2026-10-21T18:00:00Z', '2026-10-21T19:00:00Z', { titulo: 'Almuerzo', libre: true }),
  ];

  it('el subtítulo cuenta las reuniones que cuentan', async () => {
    await abrir(conCalendario(AGENDA));
    expect(await screen.findByText(/· 4 reuniones para hoy$/)).toBeInTheDocument();
  });

  it('Próxima: 11:00 abre el enlace de la próxima reunión', async () => {
    await abrir(conCalendario(AGENDA.filter((r) => r.id !== 'b')));
    const boton = await screen.findByRole('link', { name: /^Próxima: 11:00/ });
    expect(boton).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
    expect(boton).toHaveAttribute('target', '_blank');
    expect(boton).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('Próxima apunta a la reunión en curso si hay una', async () => {
    await abrir(conCalendario(AGENDA));
    const boton = await screen.findByRole('link', { name: /^Próxima: 10:00/ });
    expect(boton).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/b');
  });

  it('Próxima sin enlace lleva al Calendario', async () => {
    await abrir(conCalendario([reunion('x', '2026-10-21T14:00:00Z', '2026-10-21T15:00:00Z')]));
    const boton = await screen.findByRole('link', { name: /^Próxima: 11:00/ });
    expect(boton).toHaveAttribute('href', '/calendario');
    expect(boton).not.toHaveAttribute('target');
  });

  it('Próxima ignora enlaces que no son http(s)', async () => {
    await abrir(conCalendario([reunion('x', '2026-10-21T14:00:00Z', '2026-10-21T15:00:00Z', { enlace: 'javascript:alert(1)' })]));
    expect(await screen.findByRole('link', { name: /^Próxima: 11:00/ })).toHaveAttribute('href', '/calendario');
  });

  it('Próxima no aparece si no quedan reuniones hoy', async () => {
    await abrir(conCalendario([AGENDA[0]!]));
    await screen.findByText(/· 1 reunión para hoy$/);
    expect(screen.queryByRole('link', { name: /^Próxima/ })).not.toBeInTheDocument();
  });

  it('el tercer anillo cuenta las reuniones pasadas sobre las del día', async () => {
    await abrir(conCalendario(AGENDA));
    const hoy = await screen.findByRole('region', { name: 'Hoy' });
    await waitFor(() => expect(within(hoy).getByText('Reuniones').closest('div')).toHaveTextContent(/1\s*\/\s*4/));
    expect(within(hoy).getByRole('img')).toHaveAccessibleName(/Reuniones: 1 de 4/);
  });

  it('sin calendario no hay tercer anillo', async () => {
    await abrir({ reuniones: [], estado: null, ventana: null });
    const hoy = await screen.findByRole('region', { name: 'Hoy' });
    expect(within(hoy).queryByText('Reuniones')).not.toBeInTheDocument();
  });

  it('Próximo muestra la reunión en curso con Ahora y las demás del día', async () => {
    await abrir(conCalendario(AGENDA));
    const tarjeta = await screen.findByRole('region', { name: 'Próximo' });
    expect(await within(tarjeta).findByText('Planificación')).toBeInTheDocument();
    expect(within(tarjeta).getByText('Ahora')).toBeInTheDocument();
    expect(within(tarjeta).getByText(/Sala Huddle/)).toBeInTheDocument();
    expect(within(tarjeta).getByRole('link', { name: 'Unirse a «Planificación»' })).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/b');
    expect(within(tarjeta).getByText('Revisión')).toBeInTheDocument();
    expect(within(tarjeta).getByText('Cierre')).toBeInTheDocument();
    expect(within(tarjeta).queryByText('Stand-up')).not.toBeInTheDocument();
    expect(within(tarjeta).queryByText('Almuerzo')).not.toBeInTheDocument();
    expect(within(tarjeta).getByRole('link', { name: 'Calendario' })).toHaveAttribute('href', '/calendario');
  });

  it('Próximo muestra la siguiente sin Ahora cuando no hay una en curso', async () => {
    await abrir(conCalendario([AGENDA[2]!, AGENDA[3]!]));
    const tarjeta = await screen.findByRole('region', { name: 'Próximo' });
    expect(await within(tarjeta).findByText('Revisión')).toBeInTheDocument();
    expect(within(tarjeta).queryByText('Ahora')).not.toBeInTheDocument();
  });

  it('Próximo avisa cuando ya no quedan reuniones hoy', async () => {
    await abrir(conCalendario([AGENDA[0]!]));
    const tarjeta = await screen.findByRole('region', { name: 'Próximo' });
    expect(await within(tarjeta).findByText('No te quedan reuniones hoy.')).toBeInTheDocument();
  });

  it('sin calendario Próximo invita a conectarlo', async () => {
    await abrir({ reuniones: [], estado: null, ventana: null });
    const tarjeta = await screen.findByRole('region', { name: 'Próximo' });
    const enlace = await within(tarjeta).findByRole('link', { name: /Conectá tu calendario de Outlook para ver tus reuniones acá/ });
    expect(enlace).toHaveAttribute('href', '/configuracion#configuracion-cuenta');
    expect(screen.queryByRole('link', { name: /^Próxima/ })).not.toBeInTheDocument();
  });

  it('con falla Próximo dice desde cuándo no se actualiza', async () => {
    await abrir(conCalendario(AGENDA, { leido: '2026-10-21T12:15:00Z', falla: 'enlace-caido' }));
    const tarjeta = await screen.findByRole('region', { name: 'Próximo' });
    expect(await within(tarjeta).findByText('Sin actualizar desde 9:15')).toBeInTheDocument();
  });

  it('Próxima con enlace tiene el nombre completo y avisa que abre otra pestaña', async () => {
    await abrir(conCalendario([reunion('x', '2026-10-21T14:00:00Z', '2026-10-21T15:00:00Z', { titulo: 'Daily', enlace: 'https://meet.google.com/abc' })]));
    const boton = await screen.findByRole('link', { name: 'Próxima: 11:00, «Daily». Se abre en otra pestaña' });
    expect(boton).toHaveTextContent('Próxima: 11:00');
    expect(boton).not.toHaveTextContent('Daily');
  });

  it('Próxima sin enlace nombra la reunión', async () => {
    await abrir(conCalendario([reunion('x', '2026-10-21T14:00:00Z', '2026-10-21T15:00:00Z', { titulo: 'Daily' })]));
    expect(await screen.findByRole('link', { name: 'Próxima: 11:00, «Daily»' })).toHaveTextContent('Próxima: 11:00');
  });

  it('con dos reuniones en curso, la principal y la de las demás llevan Ahora', async () => {
    await abrir(conCalendario([
      reunion('p', '2026-10-21T13:00:00Z', '2026-10-21T14:00:00Z', { titulo: 'Primera' }),
      reunion('q', '2026-10-21T13:15:00Z', '2026-10-21T14:30:00Z', { titulo: 'Segunda' }),
    ]));
    const tarjeta = await screen.findByRole('region', { name: 'Próximo' });
    expect(await within(tarjeta).findAllByText('Ahora')).toHaveLength(2);
  });

  it('sin actualizar desde ayer lo dice con «ayer»', async () => {
    await abrir(conCalendario(AGENDA, { leido: '2026-10-20T12:15:00Z', falla: 'enlace-caido' }));
    const tarjeta = await screen.findByRole('region', { name: 'Próximo' });
    expect(await within(tarjeta).findByText('Sin actualizar desde ayer 9:15')).toBeInTheDocument();
  });

  it('mientras carga el calendario no invita a conectarlo ni muestra anillo ni botón', async () => {
    prepararEntorno('/inicio');
    simularApi({ 'GET /api/tareas': ok({ tareas: [], dependencias: [] }) });
    const fetchSimulado = globalThis.fetch;
    // La respuesta del calendario no llega nunca.
    vi.stubGlobal('fetch', vi.fn((entrada: RequestInfo | URL, init?: RequestInit) =>
      String(entrada).startsWith('/api/calendario') ? new Promise<Response>(() => {}) : fetchSimulado(entrada, init)));
    render(<App />);
    const tarjeta = await screen.findByRole('region', { name: 'Próximo' });
    expect(await within(tarjeta).findByText('Cargando tu agenda…')).toBeInTheDocument();
    expect(within(tarjeta).queryByText(/Conectá tu calendario/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Hoy' })).queryByText('Reuniones')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Próxima/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/reuniones? para hoy/)).not.toBeInTheDocument();
  });

  it('si falla la consulta del calendario lo avisa y no lo ofrece conectar', async () => {
    await abrirInicio({
      'GET /api/tareas': ok({ tareas: [], dependencias: [] }),
      'GET /api/calendario': falla(500, 'interno', 'Se rompió'),
    });
    const tarjeta = await screen.findByRole('region', { name: 'Próximo' });
    // Las consultas con 5xx se reintentan dos veces antes de rendirse.
    expect(await within(tarjeta).findByText('No se pudo cargar tu calendario.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(within(tarjeta).queryByText(/Conectá tu calendario/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Hoy' })).queryByText('Reuniones')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Próxima/ })).not.toBeInTheDocument();
  }, 15000);
});

describe('Inicio al pasar la medianoche', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pasa solo al día nuevo sin reuniones ni foco', async () => {
    // 23:59:50 del miércoles 21 en Argentina.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date('2026-10-22T02:59:50Z') });
    await abrirInicio({ 'GET /api/tareas': ok({ tareas: [], dependencias: [] }), 'GET /api/calendario': ok({ reuniones: [], estado: null, ventana: null }) });
    expect(await screen.findByText(/^miércoles 21 de octubre/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(70_000);
    });
    expect(await screen.findByText(/^jueves 22 de octubre/)).toBeInTheDocument();
  });
});

// Miércoles 21 de octubre de 2026: la semana va del 19 al 23.
describe('Inicio: «Quién falta»', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T13:30:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const miembro = (personaId: number, vacaciones: { desde: string; hasta: string }[]) => ({
    personaId, presencia: 'conectado', rol: '', capacidadHoras: 40, trabajandoEn: [], vacaciones, reunionesPorSemana: null,
  });

  it('lista ausencias y feriados, y cada persona lleva a su página', async () => {
    await abrirInicio({
      'GET /api/equipo': ok([miembro(5, [{ desde: '2026-10-15', hasta: '2026-10-22' }])]),
      'GET /api/feriados': ok({ feriados: [{ fecha: '2026-10-23', nombre: 'Feriado de prueba', puente: false, manual: true }], actualizado: null }),
    });
    const tarjeta = screen.getByRole('region', { name: 'Quién falta' });
    const fila = await within(tarjeta).findByRole('link', { name: /Martín Gómez · de vacaciones hasta el jue 22\/10/ });
    expect(fila).toHaveAttribute('href', '/equipo/5');
    expect(within(tarjeta).getByText('vie 23/10 · feriado')).toBeInTheDocument();
    expect(within(tarjeta).getByText('Solo cuenta lo que cada uno carga en OpenDash')).toBeInTheDocument();
  });

  it('dice «Esta semana están todos» si no falta nadie', async () => {
    await abrirInicio();
    const tarjeta = screen.getByRole('region', { name: 'Quién falta' });
    expect(await within(tarjeta).findByText('Esta semana están todos')).toBeInTheDocument();
  });

  it('mientras el equipo carga no afirma que están todos', async () => {
    await abrirInicio({ 'GET /api/equipo': () => new Promise(() => undefined) as never });
    const tarjeta = screen.getByRole('region', { name: 'Quién falta' });
    expect(await within(tarjeta).findByText('Cargando…')).toBeInTheDocument();
    expect(within(tarjeta).queryByText('Esta semana están todos')).not.toBeInTheDocument();
  });

  it('si falla el equipo avisa y deja reintentar, sin decir que están todos', async () => {
    const { api, usuario } = await abrirInicio({ 'GET /api/equipo': falla(400, 'validacion', 'Se rompió') });
    const tarjeta = screen.getByRole('region', { name: 'Quién falta' });
    expect(await within(tarjeta).findByText('No se pudo cargar')).toBeInTheDocument();
    expect(within(tarjeta).queryByText('Esta semana están todos')).not.toBeInTheDocument();
    const antes = api.llamadas.filter((l) => l.ruta === '/api/equipo').length;
    await usuario.click(within(tarjeta).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(api.llamadas.filter((l) => l.ruta === '/api/equipo').length).toBeGreaterThan(antes));
  });
});
