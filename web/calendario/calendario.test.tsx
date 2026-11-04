import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { CalendarioPropio, Feriado, Reunion, Tarea, Vacaciones } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { falla, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  limpiarEntorno();
});

// Miércoles 21 de octubre de 2026, 9:30 en Argentina.
const AHORA = '2026-10-21T12:30:00Z';

const reunion = (id: string, inicio: string, fin: string, extra: Partial<Reunion> = {}): Reunion =>
  ({ id, titulo: `Reunión ${id}`, lugar: null, inicio, fin, diaEntero: false, libre: false, enlace: null, plataforma: null, ...extra });

const sinCalendario: CalendarioPropio = { reuniones: [], estado: null, ventana: null };
const conCalendario = (reuniones: Reunion[], falla: CalendarioPropio['estado'] = { leido: AHORA, falla: null }): CalendarioPropio =>
  ({ reuniones, estado: falla, ventana: { desde: '2026-07-20', hasta: '2027-04-21' } });

interface Opciones { relojes?: boolean; calendario?: CalendarioPropio; feriados?: Feriado[]; vacaciones?: Vacaciones[]; tareas?: Tarea[]; titulo?: string; ahora?: string; rutas?: Parameters<typeof simularApi>[0]; desviar?: (url: string) => Promise<Response> | null }

async function abrir(ruta = '/calendario', o: Opciones = {}) {
  vi.useFakeTimers({ toFake: o.relojes ? ['Date', 'setInterval', 'clearInterval'] : ['Date'] });
  vi.setSystemTime(new Date(o.ahora ?? AHORA));
  prepararEntorno(ruta);
  const api = simularApi({
    'GET /api/calendario': ok(o.calendario ?? sinCalendario),
    'GET /api/feriados': ok({ feriados: o.feriados ?? [], actualizado: null }),
    'GET /api/cuenta/vacaciones': ok(o.vacaciones ?? []),
    ...(o.tareas ? { 'GET /api/tareas': ok({ tareas: o.tareas, dependencias: [] }) } : {}),
    ...o.rutas,
  });
  if (o.desviar) {
    const desviar = o.desviar;
    const real = fetch as unknown as (e: RequestInfo | URL, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL, i?: RequestInit) => desviar(String(e)) ?? real(e, i)));
  }
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: o.titulo ?? 'Octubre 2026' });
  return { api, usuario: userEvent.setup() };
}

const celda = (nombre: RegExp) => screen.findByRole('button', { name: nombre });

// Cinco reuniones el miércoles 21 (9:00, 9:30 y 11:00, 12:30 y 14:00 hora argentina) y una el viernes.
const MIERCOLES = [
  reunion('a', '2026-10-21T12:00:00Z', '2026-10-21T12:45:00Z', { titulo: 'Stand-up', lugar: 'Sala Huddle', plataforma: 'teams', enlace: 'https://teams.microsoft.com/l/meetup-join/abc' }),
  reunion('b', '2026-10-21T14:00:00Z', '2026-10-21T14:45:00Z', { titulo: 'Revisión' }),
  reunion('c', '2026-10-21T15:30:00Z', '2026-10-21T17:00:00Z', { titulo: 'Almuerzo' }),
  reunion('d', '2026-10-21T17:00:00Z', '2026-10-21T18:00:00Z', { titulo: 'Trabajo profundo' }),
  reunion('e', '2026-10-21T19:00:00Z', '2026-10-21T19:30:00Z', { titulo: 'Cierre' }),
  reunion('f', '2026-10-23T14:00:00Z', '2026-10-23T15:00:00Z', { titulo: 'Retro' }),
];

describe('Pantalla Calendario', () => {
  it('muestra el mes con N reuniones esta semana y +2 más', async () => {
    await abrir('/calendario', { calendario: conCalendario(MIERCOLES) });
    expect(await screen.findByText('6 reuniones esta semana')).toBeInTheDocument();
    const dia = await celda(/^miércoles 21 de octubre, 5 reuniones/);
    expect(within(dia).getByText('+2 más')).toBeInTheDocument();
    expect(within(dia).getByText('Stand-up')).toBeInTheDocument();
    expect(within(dia).queryByText('Cierre')).not.toBeInTheDocument();
    // La grilla de lunes a domingo trae el 28 sep y el 8 nov.
    expect(screen.getByRole('button', { name: /^lunes 28 de septiembre/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^domingo 8 de noviembre/ })).toBeInTheDocument();
  });

  it('marca el feriado con su nombre y las vacaciones propias', async () => {
    await abrir('/calendario', {
      feriados: [{ fecha: '2026-10-12', nombre: 'Diversidad Cultural', puente: false, manual: false }],
      vacaciones: [{ id: 1, desde: '2026-10-26', hasta: '2026-10-27' }],
    });
    const feriado = await celda(/^lunes 12 de octubre.*feriado: Diversidad Cultural/);
    expect(within(feriado).getByText('Diversidad Cultural')).toBeInTheDocument();
    const vacaciones = await celda(/^lunes 26 de octubre.*vacaciones/);
    expect(vacaciones).toHaveAttribute('data-vacaciones');
    expect(screen.getByRole('button', { name: /^martes 27 de octubre.*vacaciones/ })).toHaveAttribute('data-vacaciones');
    expect(screen.getByRole('button', { name: /^miércoles 28 de octubre/ })).not.toHaveAttribute('data-vacaciones');
  });

  it('elegir un día lo muestra en el panel', async () => {
    const { usuario } = await abrir('/calendario', { calendario: conCalendario(MIERCOLES) });
    expect(await screen.findByRole('heading', { level: 2, name: 'Hoy' })).toBeInTheDocument();
    await usuario.click(await celda(/^viernes 23 de octubre/));
    expect(await screen.findByRole('heading', { level: 2, name: 'Viernes 23 oct' })).toBeInTheDocument();
    expect(screen.getByText('1 reunión')).toBeInTheDocument();
    expect(screen.getAllByText('Retro').length).toBeGreaterThan(0);
    expect(window.location.search).toContain('dia=2026-10-23');
  });

  it('Unirse lleva al enlace de Teams en otra pestaña', async () => {
    await abrir('/calendario', { calendario: conCalendario(MIERCOLES) });
    const unirse = await screen.findByRole('link', { name: /Unirse/ });
    expect(unirse).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/abc');
    expect(unirse).toHaveAttribute('target', '_blank');
    expect(unirse).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('no arma enlaces que no sean http o https', async () => {
    const peligrosa = reunion('x', '2026-10-21T12:00:00Z', '2026-10-21T13:00:00Z', { enlace: 'javascript:alert(1)' });
    await abrir('/calendario', { calendario: conCalendario([peligrosa]) });
    expect(await screen.findByText('Reunión x', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Unirse/ })).not.toBeInTheDocument();
  });

  it('la reunión en curso dice Ahora y está la línea de la hora actual', async () => {
    await abrir('/calendario', { calendario: conCalendario(MIERCOLES) });
    const panel = (await screen.findByRole('heading', { level: 2, name: 'Hoy' })).closest('section')!;
    expect(within(panel).getByText('Ahora')).toBeInTheDocument();
    expect(within(panel).getAllByText('Ahora')).toHaveLength(1);
    const linea = within(panel).getByRole('separator', { name: 'Hora actual 9:30' });
    // La línea va entre la que ya empezó (9:00) y la siguiente (11:00).
    const titulos = within(panel).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titulos).toEqual(['Stand-up', 'Revisión', 'Almuerzo', 'Trabajo profundo', 'Cierre']);
    const stand = within(panel).getByText('Stand-up').closest('li')!;
    expect(stand.compareDocumentPosition(linea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const revision = within(panel).getByText('Revisión').closest('li')!;
    expect(revision.compareDocumentPosition(linea) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('en otro día no hay línea de la hora actual', async () => {
    await abrir('/calendario?dia=2026-10-23', { calendario: conCalendario(MIERCOLES) });
    expect(await screen.findByRole('heading', { level: 2, name: 'Viernes 23 oct' })).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.queryByText('Ahora')).not.toBeInTheDocument();
  });

  it('en la vista Semana lista las reuniones de cada día con su hora', async () => {
    await abrir('/calendario?vista=semana', { calendario: conCalendario(MIERCOLES) });
    const dia = await celda(/^miércoles 21 de octubre, 5 reuniones/);
    expect(within(dia).getByText('Cierre')).toBeInTheDocument();
    expect(within(dia).getByText('16:00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^lunes 28 de septiembre/ })).not.toBeInTheDocument();
  });

  it('con vencimientos pone la bandera y los lista en el panel con su casilla', async () => {
    const tareas = [tareaDe(1, { responsableId: 9, estadoId: 1, fin: '2026-10-21', titulo: 'Entregar informe' })];
    await abrir('/calendario', { tareas });
    expect(await celda(/^miércoles 21 de octubre.*vencimientos: 1/)).toBeInTheDocument();
    const panel = (await screen.findByRole('heading', { level: 2, name: 'Hoy' })).closest('section')!;
    expect(await within(panel).findByText('Vencen hoy')).toBeInTheDocument();
    expect(within(panel).getByRole('checkbox', { name: 'Completar «Entregar informe»' })).toBeInTheDocument();
  });

  it('sin calendario explica cómo publicarlo, lleva a Configuración y sigue mostrando feriados y vencimientos', async () => {
    await abrir('/calendario', {
      feriados: [{ fecha: '2026-10-12', nombre: 'Diversidad Cultural', puente: false, manual: false }],
      tareas: [tareaDe(1, { responsableId: 9, estadoId: 1, fin: '2026-10-21' })],
    });
    const aviso = await screen.findByText(/Publicá tu calendario desde Outlook en la web/);
    expect(aviso).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Configuración' })).toHaveAttribute('href', '/configuracion#configuracion-cuenta');
    expect(screen.getByText('Diversidad Cultural')).toBeInTheDocument();
    expect(await celda(/^miércoles 21 de octubre.*vencimientos: 1/)).toBeInTheDocument();
    expect(screen.getByText('0 reuniones esta semana')).toBeInTheDocument();
  });

  it('con el calendario sin actualizar avisa desde cuándo', async () => {
    await abrir('/calendario', { calendario: conCalendario([], { leido: '2026-10-21T12:05:00Z', falla: 'sin-conexion' }) });
    expect(await screen.findByText('Sin actualizar desde 9:05')).toBeInTheDocument();
  });

  it('Nueva reunión abre Outlook web en otra pestaña', async () => {
    await abrir();
    const enlace = await screen.findByRole('link', { name: 'Nueva reunión' });
    expect(enlace).toHaveAttribute('href', 'https://outlook.office.com/calendar/deeplink/compose');
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('‹ y › cambian de mes, Hoy vuelve y Semana cambia la vista', async () => {
    const { usuario } = await abrir();
    await usuario.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Noviembre 2026' })).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Octubre 2026' })).toBeInTheDocument();
    await usuario.click(screen.getByRole('radio', { name: 'Semana' }));
    expect(window.location.search).toContain('vista=semana');
    await usuario.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(window.location.search).toContain('dia=2026-10-28');
  });

  it('los eventos de día entero y libres no cuentan como reunión pero se ven', async () => {
    const lista = [
      reunion('x', '2026-10-21T14:00:00Z', '2026-10-21T15:00:00Z', { titulo: 'Planificación' }),
      reunion('y', '2026-10-21T16:00:00Z', '2026-10-21T17:00:00Z', { titulo: 'Bloque de foco', libre: true }),
      reunion('z', '2026-10-21T03:00:00Z', '2026-10-22T03:00:00Z', { titulo: 'Capacitación', diaEntero: true }),
    ];
    const { usuario } = await abrir('/calendario', { calendario: conCalendario(lista) });
    const panel = (await screen.findByRole('heading', { level: 2, name: 'Hoy' })).closest('section')!;
    expect(within(panel).getByText('1 reunión')).toBeInTheDocument();
    expect(within(panel).getByText('Todo el día')).toBeInTheDocument();
    expect(within(panel).getByText('Libre')).toBeInTheDocument();
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Capacitación', 'Planificación', 'Bloque de foco']);
    // Los tres se ven en la grilla, y el nombre de la celda cuenta solo la reunión.
    const dia = await celda(/^miércoles 21 de octubre, 1 reunión$/);
    expect(within(dia).getByText('Bloque de foco')).toBeInTheDocument();
    expect(within(dia).queryByText(/más/)).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('radio', { name: 'Semana' }));
    const semana = await celda(/^miércoles 21 de octubre, 1 reunión$/);
    expect(within(semana).getByText('Todo el día')).toBeInTheDocument();
    expect(within(semana).getByText('Libre')).toBeInTheDocument();
  });

  it('«Ahora» y la línea de la hora avanzan solos cada 30 s mientras se mira hoy', async () => {
    const lista = [
      reunion('a', '2026-10-21T12:00:00Z', '2026-10-21T12:45:00Z', { titulo: 'Primera' }),
      reunion('b', '2026-10-21T12:55:00Z', '2026-10-21T13:30:00Z', { titulo: 'Segunda' }),
    ];
    await abrir('/calendario', { calendario: conCalendario(lista), relojes: true });
    const panel = (await screen.findByRole('heading', { level: 2, name: 'Hoy' })).closest('section')!;
    const filaDe = (titulo: string) => within(panel).getByText(titulo).closest('li')!;
    expect(within(filaDe('Primera')).getByText('Ahora')).toBeInTheDocument();
    expect(within(panel).getByRole('separator', { name: 'Hora actual 9:30' })).toBeInTheDocument();
    // 9:56: terminó la primera, está en curso la segunda y la línea pasó después de ella.
    act(() => {
      vi.setSystemTime(new Date('2026-10-21T12:56:00Z'));
      vi.advanceTimersByTime(30_000);
    });
    expect(within(filaDe('Primera')).queryByText('Ahora')).not.toBeInTheDocument();
    expect(within(filaDe('Segunda')).getByText('Ahora')).toBeInTheDocument();
    const linea = within(panel).getByRole('separator', { name: 'Hora actual 9:56' });
    expect(filaDe('Segunda').compareDocumentPosition(linea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Calendario: ventana, vacaciones pasadas, falla y cambio de mes', () => {
  const llamadasA = (ruta: string): string[] =>
    (fetch as unknown as { mock: { calls: [unknown][] } }).mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith(ruta));

  it('avisa la ventana guardada al mirar un mes que empieza antes', async () => {
    const calendario = { ...conCalendario([]), ventana: { desde: '2026-10-10', hasta: '2027-04-21' } };
    await abrir('/calendario', { calendario });
    expect(await screen.findByText('Las reuniones se guardan del 10/10/2026 al 21/4/2027; fuera de esas fechas no se ven.')).toBeInTheDocument();
  });

  it('no avisa la ventana al mirar un mes adentro ni sin calendario conectado', async () => {
    await abrir('/calendario', { calendario: conCalendario([]) });
    await screen.findByText('0 reuniones esta semana');
    expect(screen.queryByText(/Las reuniones se guardan del/)).not.toBeInTheDocument();
    cleanup();
    await abrir('/calendario', { calendario: { reuniones: [], estado: null, ventana: { desde: '2026-10-10', hasta: '2027-04-21' } } });
    await screen.findByText(/Publicá tu calendario desde Outlook en la web/);
    expect(screen.queryByText(/Las reuniones se guardan del/)).not.toBeInTheDocument();
  });

  it('marca vacaciones ya terminadas al mirar ese mes y pide desde el primer día visible', async () => {
    await abrir('/calendario?dia=2026-08-15', {
      titulo: 'Agosto 2026',
      vacaciones: [{ id: 5, desde: '2026-08-03', hasta: '2026-08-07' }],
    });
    expect(await celda(/^miércoles 5 de agosto.*vacaciones/)).toHaveAttribute('data-vacaciones');
    expect(llamadasA('/api/cuenta/vacaciones').some((u) => u.includes('desde=2026-07-27'))).toBe(true);
  });

  it('si el calendario falla, el subtítulo lo dice y no queda cargando', async () => {
    await abrir('/calendario', { rutas: { 'GET /api/calendario': falla(400, 'conflicto', 'Se rompió') } });
    expect(await screen.findByText('No se pudo cargar el calendario')).toBeInTheDocument();
    expect(screen.queryByText('Cargando el calendario…')).not.toBeInTheDocument();
  });

  it('si falla solo la consulta de esta semana, el subtítulo lo dice y no queda cargando', async () => {
    const cuerpoError = JSON.stringify({ ok: false, codigo: 'conflicto', mensaje: 'Se rompió' });
    await abrir('/calendario?dia=2026-08-15', {
      titulo: 'Agosto 2026',
      desviar: (url) => url.includes('desde=2026-10-19&hasta=2026-10-25')
        ? Promise.resolve(new Response(cuerpoError, { status: 400, headers: { 'content-type': 'application/json' } }))
        : null,
    });
    expect(await screen.findByText('No se pudo cargar el calendario')).toBeInTheDocument();
    expect(screen.queryByText('Cargando el calendario…')).not.toBeInTheDocument();
  });

  it('al volver al mes de hoy, mientras llega la respuesta no cuenta las reuniones del rango anterior', async () => {
    const { usuario } = await abrir('/calendario?dia=2026-09-15', {
      titulo: 'Septiembre 2026',
      calendario: conCalendario(MIERCOLES),
      // El rango de septiembre viene sin reuniones; el de esta semana trae las seis.
      desviar: (url) => url.startsWith('/api/calendario') && url.includes('desde=2026-08-31')
        ? Promise.resolve(new Response(JSON.stringify(ok(conCalendario([])).cuerpo), { status: 200, headers: { 'content-type': 'application/json' } }))
        : null,
    });
    expect(await screen.findByText('6 reuniones esta semana')).toBeInTheDocument();
    const real = fetch as unknown as (e: RequestInfo | URL, i?: RequestInit) => Promise<Response>;
    let soltar: () => void = () => {};
    const frenada = new Promise<void>((r) => { soltar = r; });
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL, i?: RequestInit) => {
      if (String(e).startsWith('/api/calendario') && String(e).includes('desde=2026-09-28')) await frenada;
      return real(e, i);
    }));
    await usuario.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Octubre 2026' })).toBeInTheDocument();
    expect(screen.getByText('6 reuniones esta semana')).toBeInTheDocument();
    soltar();
  });

  it('al pasar de mes, mientras llega la respuesta siguen las reuniones del anterior', async () => {
    const { usuario } = await abrir('/calendario', { calendario: conCalendario([reunion('g', '2026-10-28T14:00:00Z', '2026-10-28T15:00:00Z', { titulo: 'Cierre de mes' })]) });
    await screen.findAllByText('Cierre de mes');
    const real = fetch as unknown as (e: RequestInfo | URL, i?: RequestInit) => Promise<Response>;
    let soltar: () => void = () => {};
    const frenada = new Promise<void>((r) => { soltar = r; });
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL, i?: RequestInit) => {
      if (String(e).startsWith('/api/calendario')) await frenada;
      return real(e, i);
    }));
    await usuario.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Noviembre 2026' })).toBeInTheDocument();
    expect(screen.getAllByText('Cierre de mes').length).toBeGreaterThan(0);
    soltar();
  });

  it('«Sin actualizar desde» dice ayer si la lectura fue ayer', async () => {
    await abrir('/calendario', { calendario: conCalendario([], { leido: '2026-10-20T12:05:00Z', falla: 'sin-conexion' }) });
    expect(await screen.findByText('Sin actualizar desde ayer 9:05')).toBeInTheDocument();
  });

  it('al pasar la medianoche, mirando otro mes, la marca de hoy pasa al día nuevo', async () => {
    await abrir('/calendario?dia=2026-10-10', { relojes: true, ahora: '2026-10-22T02:59:30Z' });
    expect(await celda(/^miércoles 21 de octubre/)).toHaveClass('cal-dia--hoy');
    await act(async () => {
      vi.setSystemTime(new Date('2026-10-22T03:00:30Z'));
      vi.advanceTimersByTime(61_000);
    });
    expect(await celda(/^jueves 22 de octubre/)).toHaveClass('cal-dia--hoy');
    expect(screen.getByRole('button', { name: /^miércoles 21 de octubre/ })).not.toHaveClass('cal-dia--hoy');
  });
});
