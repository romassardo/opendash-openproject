import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { DragEndEvent } from '@dnd-kit/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { crearClienteConsultas } from '../api/consultas.js';
import { App } from '../App.js';
import { CATALOGO, falla, limpiarEntorno, ok, prepararEntorno, simularApi, TAREAS, YO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { HorasProvider } from '../horas/HorasProvider.js';
import { TarjetaTarea } from './TarjetaTarea.js';

// El arrastre real necesita medidas que jsdom no tiene: se captura el onDragEnd del DndContext.
const dnd = vi.hoisted(() => ({ onDragEnd: null as ((evento: DragEndEvent) => void) | null }));
vi.mock('@dnd-kit/core', async (original) => {
  const real = await original<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...real,
    DndContext: (props: Parameters<typeof real.DndContext>[0]) => {
      dnd.onDragEnd = props.onDragEnd ?? null;
      return createElement(real.DndContext, props);
    },
  };
});

afterEach(() => {
  cleanup();
  limpiarEntorno();
  dnd.onDragEnd = null;
});

const columna = (nombre: string) => screen.getByRole('region', { name: nombre });
const soltar = (id: number, sobre: string | null) =>
  act(async () => {
    dnd.onDragEnd?.({ active: { id }, over: sobre === null ? null : { id: sobre } } as unknown as DragEndEvent);
  });

async function pantallaLista() {
  render(<App />);
  await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText('T1');
}

describe('Tarjeta', () => {
  it('renderiza una tarjeta sin responsable ni fecha', () => {
    render(<QueryClientProvider client={crearClienteConsultas()}><HorasProvider><TarjetaTarea tarea={tareaDe(12, { titulo: 'Ordenar el depósito' })} catalogo={CATALOGO} hoy="2026-10-19" avance={null} /></HorasProvider></QueryClientProvider>);
    expect(screen.getByText('Ordenar el depósito')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sin asignar' })).toHaveTextContent('?');
    expect(screen.queryByText(/Vence/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hoy|Mañana|Ayer/)).not.toBeInTheDocument();
  });

  it('muestra proyecto, prioridad alta, avance, fecha vencida en rojo y comentarios', () => {
    const tarea = tareaDe(5, { titulo: 'Cerrar contrato', prioridadId: 9, fin: '2026-10-09', comentarios: 3, responsableId: 5 });
    const { container } = render(<QueryClientProvider client={crearClienteConsultas()}><HorasProvider><TarjetaTarea tarea={tarea} catalogo={CATALOGO} hoy="2026-10-19" avance={{ hechas: 2, total: 3 }} /></HorasProvider></QueryClientProvider>);
    expect(screen.getByText('Portal de clientes')).toBeInTheDocument();
    expect(screen.getByText('Alta')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('9 oct').closest('.tarjeta__fecha')).toHaveClass('tarjeta__fecha--vencida');
    expect(screen.getByText('3').closest('.tarjeta__comentarios')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Martín Gómez' })).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('.tarjeta__avance-relleno')?.style.width).toMatch(/^66\.66/);
  });

  it('sin comentarios no muestra el ícono y sin prioridad alta no muestra la píldora', () => {
    const { container } = render(<QueryClientProvider client={crearClienteConsultas()}><HorasProvider><TarjetaTarea tarea={tareaDe(6, { comentarios: 0 })} catalogo={CATALOGO} hoy="2026-10-19" avance={null} /></HorasProvider></QueryClientProvider>);
    expect(container.querySelector('.tarjeta__comentarios')).toBeNull();
    expect(screen.queryByText('Alta')).not.toBeInTheDocument();
  });

  it('la prioridad Immediate se muestra como Urgente en la tarjeta', () => {
    const catalogo = { ...CATALOGO, prioridades: [...CATALOGO.prioridades, { id: 10, nombre: 'Immediate', alta: true, nivel: 'inmediata' as const }] };
    render(<QueryClientProvider client={crearClienteConsultas()}><HorasProvider><TarjetaTarea tarea={tareaDe(7, { prioridadId: 10 })} catalogo={catalogo} hoy="2026-10-19" avance={null} /></HorasProvider></QueryClientProvider>);
    expect(screen.getByText('Urgente')).toBeInTheDocument();
  });
});

describe('Tablero', () => {
  it('muestra las cuatro columnas con su contador, sin hitos', async () => {
    prepararEntorno('/tareas?persona=todas');
    simularApi();
    await pantallaLista();
    // TAREAS: nuevo 1, 4, 6, 11 (10 es hito); en curso 2, 5, 12; en pausa 3, 7.
    expect(within(columna('Nuevo')).getAllByRole('button', { name: /^Tarea / })).toHaveLength(4);
    expect(within(columna('En curso')).getAllByRole('button', { name: /^Tarea / })).toHaveLength(3);
    expect(within(columna('En pausa')).getAllByRole('button', { name: /^Tarea / })).toHaveLength(2);
    expect(within(columna('Nuevo')).queryByText('T10')).not.toBeInTheDocument();
    expect(within(columna('Nuevo')).getByText('4')).toBeInTheDocument();
    expect(screen.getByText('9 abiertas en 2 proyectos')).toBeInTheDocument();
  });

  it('mover una tarjeta llama a mover y la deja en la nueva columna', async () => {
    prepararEntorno('/tareas');
    const api = simularApi({ 'POST /api/tareas/1/mover': ok({ ...TAREAS[0], estadoId: 7, lockVersion: 2 }) });
    await pantallaLista();
    await soltar(1, 'curso');
    expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas/1/mover', cuerpo: { lockVersion: 1, columna: 'curso' } });
    await waitFor(() => expect(within(columna('En curso')).getByText('T1')).toBeInTheDocument());
    expect(within(columna('Nuevo')).queryByText('T1')).not.toBeInTheDocument();
  });

  it('se mueve al instante, antes de que responda el servidor', async () => {
    prepararEntorno('/tareas');
    const espera: { responder?: () => void } = {};
    simularApi({ 'POST /api/tareas/1/mover': ok({ ...TAREAS[0], estadoId: 4, lockVersion: 2 }) });
    const fetchSimulado = globalThis.fetch;
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) =>
      String(entrada).endsWith('/mover')
        ? new Promise<Response>((listo) => { espera.responder = () => void fetchSimulado(entrada, init).then(listo); })
        : fetchSimulado(entrada, init));
    await pantallaLista();
    await soltar(1, 'pausa');
    expect(await within(columna('En pausa')).findByText('T1')).toBeInTheDocument();
    expect(espera.responder).toBeDefined();
    await act(async () => espera.responder?.());
    expect(within(columna('En pausa')).getByText('T1')).toBeInTheDocument();
  });

  it('si mover falla, la tarjeta vuelve y aparece el motivo', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'POST /api/tareas/1/mover': falla(422, 'transicion-no-permitida', 'Estado no es válido') });
    await pantallaLista();
    await soltar(1, 'curso');
    expect(await screen.findByRole('alert')).toHaveTextContent('Estado no es válido');
    expect(within(columna('Nuevo')).getByText('T1')).toBeInTheDocument();
    expect(within(columna('En curso')).queryByText('T1')).not.toBeInTheDocument();
  });

  it('ante un conflicto avisa y vuelve a pedir la lista', async () => {
    prepararEntorno('/tareas');
    const api = simularApi({ 'POST /api/tareas/1/mover': falla(409, 'conflicto', 'Alguien modificó la tarea antes que vos') });
    await pantallaLista();
    const antes = api.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === '/api/tareas').length;
    await soltar(1, 'cerrado');
    expect(await screen.findByRole('alert')).toHaveTextContent('Alguien cambió esta tarea recién. Ya ves la versión nueva.');
    await waitFor(() => expect(api.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === '/api/tareas').length).toBeGreaterThan(antes));
  });

  it('después de un conflicto, el reintento sale con el lockVersion que trae la lista releída', async () => {
    prepararEntorno('/tareas');
    // El servidor ya dejó en la caché la versión de otra persona (lockVersion 5) al responder el 409.
    let enServidor = TAREAS;
    let primero = true;
    const api = simularApi({
      'GET /api/tareas': () => ok({ tareas: enServidor, dependencias: [] }),
      'POST /api/tareas/1/mover': (cuerpo) => {
        if (primero) {
          primero = false;
          enServidor = TAREAS.map((t) => (t.id === 1 ? { ...t, lockVersion: 5 } : t));
          return falla(409, 'conflicto', 'Alguien modificó la tarea antes que vos');
        }
        return ok({ ...TAREAS[0], estadoId: 7, lockVersion: (cuerpo as { lockVersion: number }).lockVersion + 1 });
      },
    });
    await pantallaLista();
    const lecturasLista = () => api.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === '/api/tareas').length;
    const antes = lecturasLista();
    await soltar(1, 'curso');
    expect(await screen.findByRole('alert')).toHaveTextContent('Alguien cambió esta tarea recién. Ya ves la versión nueva.');
    await waitFor(() => expect(lecturasLista()).toBeGreaterThan(antes));
    await waitFor(() => expect(within(columna('Nuevo')).getByText('T1')).toBeInTheDocument());
    await soltar(1, 'curso');
    const movidas = api.llamadas.filter((l) => l.ruta === '/api/tareas/1/mover').map((l) => l.cuerpo);
    expect(movidas).toEqual([{ lockVersion: 1, columna: 'curso' }, { lockVersion: 5, columna: 'curso' }]);
    await waitFor(() => expect(within(columna('En curso')).getByText('T1')).toBeInTheDocument());
  });

  it('tocar una tarjeta (o Enter) abre su dirección y conserva los filtros', async () => {
    prepararEntorno('/tareas?persona=mias');
    simularApi();
    const usuario = userEvent.setup();
    await pantallaLista();
    await usuario.click(within(columna('Nuevo')).getByText('T1'));
    expect(window.location.pathname).toBe('/tareas/1');
    expect(window.location.search).toBe('?persona=mias');
    // El panel deja inerte el resto: se lo cierra antes de usar el teclado en otra tarjeta.
    await screen.findByRole('dialog');
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(window.location.pathname).toBe('/tareas'));
    within(columna('En curso')).getByRole('button', { name: /^Tarea T2,/ }).focus();
    await usuario.keyboard('{Enter}');
    await waitFor(() => expect(window.location.pathname).toBe('/tareas/2'));
  });

  it('soltar en la misma columna o afuera no llama a mover', async () => {
    prepararEntorno('/tareas');
    const api = simularApi();
    await pantallaLista();
    await soltar(1, 'nuevo');
    await soltar(1, null);
    expect(api.llamadas.some((l) => l.ruta.endsWith('/mover'))).toBe(false);
  });
});

describe('Primera carga desde OpenProject', () => {
  const TRAYENDO = 'Trayendo tus tareas de OpenProject…';
  // Recién registrada: el servidor todavía no terminó la carga inicial, así que no hay tareas ni proyectos.
  const sinCargaInicial = () => simularApi({
    'GET /api/auth/yo': ok({ ...YO, cargaInicialLista: false }),
    'GET /api/tareas': ok({ tareas: [], dependencias: [] }),
    'GET /api/catalogo': ok({ ...CATALOGO, proyectos: [], versiones: [], personas: [] }),
  });

  it('el tablero, el resumen y los contadores dicen que se están trayendo las tareas, no que no hay', async () => {
    prepararEntorno('/tareas');
    sinCargaInicial();
    render(<App />);
    expect(await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText(TRAYENDO)).toBeInTheDocument();
    for (const nombre of ['En curso', 'En pausa', 'Cerrado']) expect(within(columna(nombre)).getByText(TRAYENDO)).toBeInTheDocument();
    expect(screen.queryByText('Sin tareas')).not.toBeInTheDocument();
    expect(screen.queryByText('Sin tareas abiertas')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tareas', level: 1 }).parentElement).toHaveTextContent(TRAYENDO);
    const resumen = screen.getByRole('group', { name: 'Resumen de tareas' });
    expect(within(resumen).getAllByText('–')).toHaveLength(4);
  });

  it('el formulario rápido avisa que los proyectos se están cargando', async () => {
    prepararEntorno('/tareas');
    sinCargaInicial();
    const usuario = userEvent.setup();
    render(<App />);
    await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText(TRAYENDO);
    await usuario.click(within(columna('Nuevo')).getByRole('button', { name: 'Nueva tarea en Nuevo' }));
    const formulario = await screen.findByRole('form', { name: 'Nueva tarea' });
    expect(within(formulario).getByRole('status')).toHaveTextContent('Todavía se están cargando tus proyectos de OpenProject.');
  });

  it('con la carga lista y sin tareas, dice que no hay', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/tareas': ok({ tareas: [], dependencias: [] }) });
    render(<App />);
    expect(await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText('Sin tareas')).toBeInTheDocument();
    expect(screen.getByText('Sin tareas abiertas')).toBeInTheDocument();
    expect(screen.queryByText(TRAYENDO)).not.toBeInTheDocument();
  });
});

describe('Crear tarea rápida', () => {
  async function completarFormulario(usuario: ReturnType<typeof userEvent.setup>, titulo: string) {
    const formulario = await screen.findByRole('form', { name: 'Nueva tarea' });
    await usuario.selectOptions(within(formulario).getByLabelText('Proyecto'), 'Portal de clientes');
    await usuario.type(within(formulario).getByLabelText('Título'), `${titulo}{Enter}`);
    return formulario;
  }

  it('+ de una columna crea la tarea en ese estado', async () => {
    prepararEntorno('/tareas');
    const api = simularApi({ 'POST /api/tareas': ok(tareaDe(99, { titulo: 'Llamar al proveedor', estadoId: 7, responsableId: 9 })) });
    const usuario = userEvent.setup();
    await pantallaLista();
    await usuario.click(within(columna('En curso')).getByRole('button', { name: 'Nueva tarea en En curso' }));
    await completarFormulario(usuario, 'Llamar al proveedor');
    await waitFor(() =>
      expect(api.llamadas).toContainEqual({
        metodo: 'POST',
        ruta: '/api/tareas',
        cuerpo: { titulo: 'Llamar al proveedor', proyectoId: 11, estadoId: 7, responsableId: 9 },
      }));
    expect(await within(columna('En curso')).findByText('Llamar al proveedor')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Nueva tarea' })).not.toBeInTheDocument();
  });

  it('el + de la barra superior crea en Nuevo', async () => {
    prepararEntorno('/tareas');
    const api = simularApi({ 'POST /api/tareas': ok(tareaDe(98, { titulo: 'Pedir presupuesto', estadoId: 1, responsableId: 9 })) });
    const usuario = userEvent.setup();
    const { container } = render(<App />);
    await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText('T1');
    await usuario.click(within(container.querySelector<HTMLElement>('.herramientas')!).getByRole('button', { name: 'Nueva tarea' }));
    expect(columna('Nuevo')).toContainElement(await screen.findByRole('form', { name: 'Nueva tarea' }));
    await completarFormulario(usuario, 'Pedir presupuesto');
    await waitFor(() =>
      expect(api.llamadas).toContainEqual({
        metodo: 'POST',
        ruta: '/api/tareas',
        cuerpo: { titulo: 'Pedir presupuesto', proyectoId: 11, estadoId: 1, responsableId: 9 },
      }));
    expect(await within(columna('Nuevo')).findByText('Pedir presupuesto')).toBeInTheDocument();
  });

  it('desde otra pantalla, el + lleva a Tareas y abre el formulario', async () => {
    prepararEntorno('/equipo');
    simularApi();
    const usuario = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'Equipo' });
    await usuario.click(within(container.querySelector<HTMLElement>('.herramientas')!).getByRole('button', { name: 'Nueva tarea' }));
    const formulario = await screen.findByRole('form', { name: 'Nueva tarea' });
    expect(window.location.pathname).toBe('/tareas');
    expect(columna('Nuevo')).toContainElement(formulario);
    await waitFor(() => expect(within(formulario).getByLabelText('Título')).toHaveFocus());
  });

  it('con un proyecto filtrado lo propone y con «Solo mías» asigna a quien la crea', async () => {
    prepararEntorno('/tareas?proyecto=12&persona=mias');
    const api = simularApi({ 'POST /api/tareas': ok(tareaDe(97, { titulo: 'Migrar clientes', proyectoId: 12, responsableId: 9 })) });
    const usuario = userEvent.setup();
    const { container } = render(<App />);
    await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText('T6');
    await usuario.click(within(container.querySelector<HTMLElement>('.encabezado')!).getByRole('button', { name: 'Nueva tarea' }));
    const formulario = await screen.findByRole('form', { name: 'Nueva tarea' });
    expect(within(formulario).getByLabelText('Proyecto')).toHaveValue('12');
    await usuario.type(within(formulario).getByLabelText('Título'), 'Migrar clientes{Enter}');
    await waitFor(() =>
      expect(api.llamadas).toContainEqual({
        metodo: 'POST',
        ruta: '/api/tareas',
        cuerpo: { titulo: 'Migrar clientes', proyectoId: 12, estadoId: 1, responsableId: 9 },
      }));
  });

  it('sin título no llama al servidor y Escape cierra el formulario', async () => {
    prepararEntorno('/tareas');
    const api = simularApi();
    const usuario = userEvent.setup();
    await pantallaLista();
    await usuario.click(within(columna('Nuevo')).getByRole('button', { name: 'Nueva tarea en Nuevo' }));
    const formulario = await screen.findByRole('form', { name: 'Nueva tarea' });
    await usuario.selectOptions(within(formulario).getByLabelText('Proyecto'), 'Portal de clientes');
    await usuario.type(within(formulario).getByLabelText('Título'), '   {Enter}');
    expect(within(formulario).getByRole('alert')).toHaveTextContent('Escribí un título');
    expect(api.llamadas.some((l) => l.metodo === 'POST')).toBe(false);
    await usuario.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'Nueva tarea' })).not.toBeInTheDocument();
  });

  it('el alta rápida con resultado-incierto muestra el mensaje del servidor y conserva el título', async () => {
    prepararEntorno('/tareas');
    const mensaje = 'OpenProject no respondió a tiempo y no sabemos si lo guardó. Revisá antes de volver a intentar.';
    simularApi({ 'POST /api/tareas': falla(503, 'resultado-incierto', mensaje) });
    const usuario = userEvent.setup();
    await pantallaLista();
    await usuario.click(within(columna('Nuevo')).getByRole('button', { name: 'Nueva tarea en Nuevo' }));
    const formulario = await completarFormulario(usuario, 'Algo dudoso');
    expect(await within(formulario).findByRole('alert')).toHaveTextContent(mensaje);
    expect(within(formulario).getByLabelText('Título')).toHaveValue('Algo dudoso');
  });

  it('si el servidor rechaza la tarea muestra el motivo y deja el formulario', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'POST /api/tareas': falla(403, 'prohibido', 'No tenés permiso para hacer eso en OpenProject') });
    const usuario = userEvent.setup();
    await pantallaLista();
    await usuario.click(within(columna('Nuevo')).getByRole('button', { name: 'Nueva tarea en Nuevo' }));
    const formulario = await completarFormulario(usuario, 'Algo');
    expect(await within(formulario).findByRole('alert')).toHaveTextContent('No tenés permiso para hacer eso en OpenProject');
  });
});

describe('Filtros', () => {
  it('lee los filtros de la dirección y los escribe al cambiarlos', async () => {
    prepararEntorno('/tareas?proyecto=12&persona=todas');
    simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText('T6');
    expect(within(columna('Nuevo')).queryByText('T1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Proyecto')).toHaveValue('12');
    await usuario.selectOptions(screen.getByLabelText('Persona'), 'Solo mías');
    // «Solo mías» es lo que vale sin nada en la dirección: no se escribe.
    expect(new URLSearchParams(window.location.search).get('persona')).toBeNull();
    await usuario.selectOptions(screen.getByLabelText('Proyecto'), 'Todos los proyectos');
    expect(new URLSearchParams(window.location.search).get('proyecto')).toBeNull();
    // T11 es de Martín: con «Solo mías» no aparece.
    expect(await within(columna('Nuevo')).findByText('T1')).toBeInTheDocument();
    expect(within(columna('Nuevo')).queryByText('T11')).not.toBeInTheDocument();
  });

  it('el texto viaja por la dirección: lee ?q=, la escribe con demora y sin sumar historial', async () => {
    prepararEntorno('/tareas?q=impresora&persona=mias');
    simularApi({
      'GET /api/tareas': ok({
        tareas: [
          tareaDe(1, { titulo: 'Configurar la impresora', responsableId: 9 }),
          tareaDe(2, { titulo: 'Revisar facturas', responsableId: 9 }),
        ],
        dependencias: [],
      }),
    });
    const usuario = userEvent.setup();
    render(<App />);
    const campo = await screen.findByLabelText('Filtrar por título, proyecto o persona');
    expect(campo).toHaveValue('impresora');
    expect(await within(columna('Nuevo')).findByText('Configurar la impresora')).toBeInTheDocument();
    expect(screen.queryByText('Revisar facturas')).not.toBeInTheDocument();

    const historial = window.history.length;
    await usuario.clear(campo);
    await usuario.type(campo, 'facturas');
    // Se filtra enseguida; la dirección espera a que se deje de escribir.
    expect(screen.getByText('Revisar facturas')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('q')).not.toBe('facturas');
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe('facturas'));
    expect(new URLSearchParams(window.location.search).get('persona')).toBe('mias');
    expect(window.history.length).toBe(historial);

    await usuario.clear(campo);
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('q')).toBe(false));

    // Un enlace con ?q= (por ejemplo, desde la búsqueda) cambia el filtro con la pantalla abierta.
    act(() => {
      window.history.pushState(null, '', '/tareas?q=configurar');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(campo).toHaveValue('configurar'));
    expect(screen.queryByText('Revisar facturas')).not.toBeInTheDocument();
  });

  it('Tareas abre con las tuyas; «Todas las personas» queda en la dirección', async () => {
    prepararEntorno('/tareas');
    simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    expect(await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText('T1')).toBeInTheDocument();
    // T11 es de Martín.
    expect(within(columna('Nuevo')).queryByText('T11')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Persona')).toHaveValue('mias');
    await usuario.selectOptions(screen.getByLabelText('Persona'), 'Todas las personas');
    expect(new URLSearchParams(window.location.search).get('persona')).toBe('todas');
    expect(await within(columna('Nuevo')).findByText('T11')).toBeInTheDocument();
  });

  it('filtra por texto y por prioridad alta', async () => {
    prepararEntorno('/tareas?persona=todas');
    simularApi({
      'GET /api/tareas': ok({
        tareas: [tareaDe(1, { titulo: 'Configurar la impresora' }), tareaDe(2, { titulo: 'Revisar facturas', prioridadId: 9 })],
        dependencias: [],
      }),
    });
    const usuario = userEvent.setup();
    render(<App />);
    await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText('Revisar facturas');
    await usuario.type(screen.getByLabelText('Filtrar por título, proyecto o persona'), 'IMPRESORA');
    expect(screen.queryByText('Revisar facturas')).not.toBeInTheDocument();
    expect(screen.getByText('Configurar la impresora')).toBeInTheDocument();
    await usuario.clear(screen.getByLabelText('Filtrar por título, proyecto o persona'));
    await usuario.selectOptions(screen.getByLabelText('Prioridad'), 'Alta');
    expect(screen.queryByText('Configurar la impresora')).not.toBeInTheDocument();
    expect(screen.getByText('Revisar facturas')).toBeInTheDocument();
  });
});

describe('Tareas por proyecto o por persona', () => {
  it('la pantalla de un proyecto muestra solo sus tareas y su nombre como título', async () => {
    prepararEntorno('/proyectos/12');
    simularApi();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Migración del ERP' })).toBeInTheDocument();
    // TAREAS del proyecto 12: 5 (en curso), 6 (nuevo), 7 (en pausa).
    expect(await within(columna('En curso')).findByText('T5')).toBeInTheDocument();
    expect(within(columna('Nuevo')).getByText('T6')).toBeInTheDocument();
    expect(within(columna('En pausa')).getByText('T7')).toBeInTheDocument();
    expect(screen.queryByText('T1')).not.toBeInTheDocument();
    expect(screen.getByText('3 abiertas en 1 proyecto')).toBeInTheDocument();
    // El proyecto ya lo fija la pantalla: su filtro no se ofrece; el de persona sí, y dentro de un proyecto arranca en todas.
    expect(screen.queryByRole('combobox', { name: 'Proyecto' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Persona' })).toHaveValue('todas');
  });

  it('la pantalla de una persona oculta el filtro de persona', async () => {
    prepararEntorno('/equipo/5');
    simularApi();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Martín Gómez' })).toBeInTheDocument();
    expect(await within(columna('Nuevo')).findByText('T11')).toBeInTheDocument();
    expect(screen.queryByText('T1')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Persona' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Proyecto' })).toBeInTheDocument();
  });

  it('abrir una tarea desde un proyecto queda dentro del proyecto', async () => {
    prepararEntorno('/proyectos/12');
    simularApi({ 'GET /api/tareas/5': ok({ tarea: TAREAS[4], actividades: [] }) });
    const usuario = userEvent.setup();
    render(<App />);
    await screen.findByRole('region', { name: 'En curso' });
    await usuario.click(await within(columna('En curso')).findByRole('button', { name: /^Tarea T5/ }));
    await waitFor(() => expect(window.location.pathname).toBe('/proyectos/12/tareas/5'));
  });

  it('abrir una tarea desde una persona queda dentro de la persona', async () => {
    prepararEntorno('/equipo/5');
    simularApi({ 'GET /api/tareas/11': ok({ tarea: TAREAS[10], actividades: [] }) });
    const usuario = userEvent.setup();
    render(<App />);
    await screen.findByRole('region', { name: 'Nuevo' });
    await usuario.click(await within(columna('Nuevo')).findByRole('button', { name: /^Tarea T11/ }));
    await waitFor(() => expect(window.location.pathname).toBe('/equipo/5/tareas/11'));
  });

  it('un proyecto que no se ve avisa y enlaza a la sección', async () => {
    prepararEntorno('/proyectos/999');
    simularApi();
    render(<App />);
    expect(await screen.findByText('No encontramos ese proyecto')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Proyectos' })).toHaveAttribute('href', '/proyectos');
  });

  it('una persona que no se ve avisa y enlaza a la sección', async () => {
    prepararEntorno('/equipo/999');
    simularApi();
    render(<App />);
    expect(await screen.findByText('No encontramos esa persona')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Equipo' })).toHaveAttribute('href', '/equipo');
  });
});
