import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../App.js';
import { CATALOGO, YO, falla, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

// Martes 20 de octubre de 2026: con 17 días a la vista, la ventana arranca el lunes 12 y hoy queda hacia la mitad.
const AHORA = new Date('2026-10-20T15:00:00Z');
const ANCHO = 1250;

class ObservadorFalso {
  constructor(private readonly alMedir: ResizeObserverCallback) {}
  observe(): void {
    this.alMedir([{ contentRect: { width: ANCHO } } as ResizeObserverEntry], this as unknown as ResizeObserver);
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

const TAREAS = [
  tareaDe(1, { titulo: 'Relevamiento', proyectoId: 11, responsableId: 9, inicio: '2026-10-13', fin: '2026-10-19', estadoId: 12 }),
  tareaDe(2, { titulo: 'Cobranzas', proyectoId: 11, responsableId: 5, inicio: '2026-10-20', fin: '2026-11-03', estadoId: 7 }),
  tareaDe(3, { titulo: 'Migración de datos', proyectoId: 12, responsableId: 9, inicio: '2026-10-21', fin: '2026-10-30' }),
  tareaDe(4, { titulo: 'Sin fechas', proyectoId: 12 }),
];
const DEPENDENCIAS = [{ id: 1, predecesoraId: 1, sucesoraId: 2, lag: 0 }];

async function abrir(ruta = '/linea-de-tiempo', tareas = TAREAS, extra = {}) {
  prepararEntorno(ruta);
  const api = simularApi({
    'GET /api/catalogo': ok(CATALOGO),
    'GET /api/tareas': ok({ tareas, dependencias: DEPENDENCIAS }),
    'GET /api/tareas/1': ok({ tarea: TAREAS[0], actividades: [] }),
    'GET /api/tareas/2': ok({ tarea: TAREAS[1], actividades: [] }),
    ...extra,
  });
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Línea de tiempo' });
  const usuario = userEvent.setup({ advanceTimers: () => {} });
  return { api, usuario };
}

const params = (): URLSearchParams => new URLSearchParams(window.location.search);
// El menú lateral y los chips de filtro también listan proyectos y personas: en la línea se busca dentro
// de su cuerpo; en las otras pantallas, dentro de <main>.
const principal = () => within(document.querySelector<HTMLElement>('.linea__medida') ?? screen.getByRole('main'));
const radio =(nombre: string) => screen.getByRole('radio', { name: nombre });

describe('Pantalla Línea de tiempo', () => {
  it('la pantalla abre por proyecto en Semana, con la semana anterior y la actual (hoy hacia la mitad)', async () => {
    await abrir();
    expect(await principal().findByText('Portal de clientes')).toBeInTheDocument();
    expect(principal().getByText('Migración del ERP')).toBeInTheDocument();
    expect(screen.getByText('3 tareas con fechas · 2 con dependencias')).toBeInTheDocument();
    expect(radio('Por proyecto')).toBeChecked();
    expect(radio('Semana')).toBeChecked();
    expect(params().has('zoom')).toBe(false);
    expect(screen.getByText('lun 12')).toBeInTheDocument();
    expect(screen.getByText('lun 19')).toBeInTheDocument();
    expect(screen.queryByText('lun 5')).toBeNull();
    expect(screen.getByRole('button', { name: 'Solo con dependencias' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Mostrar subtareas' })).toBeNull();
    // La tarea cerrada queda plegada hasta que se pidan las terminadas.
    expect(document.querySelectorAll('[data-tarea-id]')).toHaveLength(2);
  });

  it('«mostrar» lista también las terminadas fuera de la ventana sin moverla, y su marca lleva la línea hasta ellas', async () => {
    const vieja = tareaDe(5, { titulo: 'Vieja', proyectoId: 11, responsableId: 9, inicio: '2026-09-14', fin: '2026-09-18', estadoId: 12 });
    const { usuario } = await abrir('/linea-de-tiempo', [TAREAS[1]!, vieja]);
    expect(await principal().findByText('1 terminada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir «Vieja»' })).toBeNull();
    await usuario.click(principal().getByRole('button', { name: 'mostrar' }));
    expect(await screen.findByRole('button', { name: 'Abrir «Vieja»' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir «Cobranzas»' })).toBeInTheDocument();
    expect(params().has('desde')).toBe(false);
    await usuario.click(screen.getByRole('button', { name: '◂ terminó el 18 sept' }));
    await waitFor(() => expect(params().get('desde')).not.toBeNull());
    expect(params().get('desde')! <= '2026-09-14').toBe(true);
    expect(document.querySelector('[data-tarea-id="5"]')).not.toBeNull();
  });

  it('por persona, quien mira va primero', async () => {
    await abrir('/linea-de-tiempo?vista=persona', TAREAS, { 'GET /api/auth/yo': ok({ ...YO, id: 5, nombre: 'Martín Gómez' }) });
    const franjas = await waitFor(() => {
      const f = Array.from(document.querySelectorAll('.renglon--encabezado .renglon__titulo')).map((x) => x.textContent);
      expect(f.length).toBeGreaterThan(1);
      return f;
    });
    expect(franjas[0]).toBe('Martín Gómez');
  });

  it('cambiar a Por persona y a Semana queda en la URL', async () => {
    const { usuario } = await abrir();
    await principal().findByText('Portal de clientes');
    await usuario.click(radio('Por persona'));
    await usuario.click(radio('Mes'));
    await usuario.click(screen.getByRole('button', { name: 'Solo con dependencias' }));
    await waitFor(() => expect(params().get('zoom')).toBe('mes'));
    expect(params().get('vista')).toBe('persona');
    expect(params().get('dependencias')).toBe('1');
    expect(await principal().findByText('Ana Pereyra', { selector: '.renglon__titulo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solo con dependencias' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('[data-tarea-id]')).toHaveLength(1);
  });

  it('arrastrar el fondo de una pista corre la ventana y la escribe en la dirección al soltar', async () => {
    await abrir('/linea-de-tiempo?desde=2026-10-12');
    await principal().findByText('Portal de clientes');
    const fondo = document.querySelector<HTMLElement>('[data-renglon-tarea="2"] .renglon__pista')!;
    fireEvent.pointerDown(fondo, { clientX: 500, button: 0, pointerId: 7 });
    fireEvent.pointerMove(fondo, { clientX: 500 + 48 * 3, pointerId: 7 });
    // Mientras se arrastra la ventana ya se corrió tres días atrás, pero la dirección no cambia.
    expect(await screen.findByText('vie 9')).toBeInTheDocument();
    expect(params().get('desde')).toBe('2026-10-12');
    fireEvent.pointerMove(fondo, { clientX: 500 - 48 * 2, pointerId: 7 });
    fireEvent.pointerUp(fondo, { clientX: 500 - 48 * 2, pointerId: 7 });
    await waitFor(() => expect(params().get('desde')).toBe('2026-10-14'));
  });

  it('arrastrar una barra no corre la ventana, y un clic quieto en el fondo tampoco', async () => {
    await abrir('/linea-de-tiempo?desde=2026-10-12');
    await principal().findByText('Portal de clientes');
    const fondo = document.querySelector<HTMLElement>('[data-renglon-tarea="2"] .renglon__pista')!;
    fireEvent.pointerDown(fondo, { clientX: 500, button: 0, pointerId: 7 });
    fireEvent.pointerMove(fondo, { clientX: 502, pointerId: 7 });
    fireEvent.pointerUp(fondo, { clientX: 502, pointerId: 7 });
    const barra = document.querySelector<HTMLElement>('[data-tarea-id="2"]')!;
    fireEvent.pointerDown(barra, { clientX: 500, button: 0, pointerId: 8 });
    fireEvent.pointerMove(barra, { clientX: 500 + 48 * 3, pointerId: 8 });
    expect(screen.queryByText('vie 9')).toBeNull();
    fireEvent.pointerCancel(barra, { pointerId: 8 });
    expect(params().get('desde')).toBe('2026-10-12');
  });

  it('Hoy vuelve la ventana a la semana actual', async () => {
    const { usuario } = await abrir();
    await principal().findByText('Portal de clientes');
    await usuario.click(screen.getByRole('button', { name: 'Adelante' }));
    await waitFor(() => expect(params().has('desde')).toBe(true));
    const adelante = params().get('desde')!;
    expect(adelante > '2026-10-12').toBe(true);
    await usuario.click(screen.getByRole('button', { name: 'Atrás' }));
    await waitFor(() => expect(params().get('desde')).toBe('2026-10-12'));
    await usuario.click(screen.getByRole('button', { name: 'Adelante' }));
    await usuario.click(screen.getByRole('button', { name: 'Hoy' }));
    await waitFor(() => expect(params().has('desde')).toBe(false));
    expect(await principal().findByText('Portal de clientes')).toBeInTheDocument();
  });

  it('tocar una barra abre el detalle y cerrarlo vuelve con los mismos controles', async () => {
    const { usuario } = await abrir('/linea-de-tiempo?zoom=mes&dependencias=1');
    await principal().findByText('Portal de clientes');
    await usuario.click(document.querySelector<HTMLElement>('[data-tarea-id="2"]')!);
    const dialogo = await screen.findByRole('dialog');
    expect(window.location.pathname).toBe('/linea-de-tiempo/tareas/2');
    expect(params().get('dependencias')).toBe('1');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(window.location.pathname).toBe('/linea-de-tiempo'));
    expect(params().get('zoom')).toBe('mes');
    expect(params().get('dependencias')).toBe('1');
    expect(screen.getByRole('button', { name: 'Solo con dependencias' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('desde un proyecto llega filtrada y el chip de proyecto quita el filtro', async () => {
    const { usuario } = await abrir('/linea-de-tiempo?vista=proyecto&proyecto=12');
    expect(await screen.findByText('1 tarea con fechas de Migración del ERP · 0 con dependencias')).toBeInTheDocument();
    expect(principal().queryByText('Portal de clientes')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Proyecto' })).toHaveValue('12');
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Proyecto' }), 'Todos los proyectos');
    expect(await principal().findByText('Portal de clientes')).toBeInTheDocument();
    expect(params().has('proyecto')).toBe(false);
  });

  it('los chips filtran por proyecto y por persona, y «Solo mías» es la persona propia', async () => {
    const { usuario } = await abrir('/linea-de-tiempo?vista=todas');
    await principal().findByText('Cobranzas');
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Persona' }), 'Martín Gómez');
    await waitFor(() => expect(params().get('persona')).toBe('5'));
    expect(await screen.findByText('1 tarea con fechas de Martín Gómez · 1 con dependencias')).toBeInTheDocument();
    expect(principal().queryByText('Migración de datos')).toBeNull();

    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Persona' }), 'Solo mías');
    await waitFor(() => expect(params().get('persona')).toBe(String(YO.id)));
    expect(await principal().findByText('Migración de datos')).toBeInTheDocument();
    expect(principal().queryByText('Cobranzas')).toBeNull();

    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Proyecto' }), 'Migración del ERP');
    await waitFor(() => expect(params().get('proyecto')).toBe('12'));
    expect(params().get('persona')).toBe(String(YO.id));
    expect(principal().queryByText('Relevamiento')).toBeNull();
  });

  it('los botones Línea de tiempo de un proyecto y de una persona llevan a la pantalla filtrada', async () => {
    prepararEntorno('/proyectos/11');
    simularApi({ 'GET /api/catalogo': ok(CATALOGO), 'GET /api/tareas': ok({ tareas: TAREAS, dependencias: DEPENDENCIAS }) });
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Portal de clientes' });
    expect(await principal().findByRole('link', { name: 'Línea de tiempo' })).toHaveAttribute('href', '/linea-de-tiempo?vista=proyecto&proyecto=11');
    cleanup();
    prepararEntorno('/equipo/5');
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Martín Gómez' });
    expect(await principal().findByRole('link', { name: 'Línea de tiempo' })).toHaveAttribute('href', '/linea-de-tiempo?vista=persona&persona=5');
  });

  it('sin tareas en la ventana lo dice con las fechas', async () => {
    await abrir('/linea-de-tiempo', [tareaDe(1, { inicio: '2027-03-01', fin: '2027-03-05' })]);
    expect(await screen.findByText('No hay tareas con fechas entre el 12 oct y el 28 oct.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adelante' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeEnabled();
  });

  it('la pista vacía se arrastra igual, y el arrastre sigue cuando aparecen las tareas', async () => {
    await abrir('/linea-de-tiempo?desde=2026-10-12', [tareaDe(1, { titulo: 'Anterior', inicio: '2026-10-05', fin: '2026-10-06' })]);
    await screen.findByText('No hay tareas con fechas entre el 12 oct y el 28 oct.');
    const fondo = () => document.querySelector<HTMLElement>('.linea__sin-tareas .renglon__pista, [data-renglon-tarea="1"] .renglon__pista')!;
    const lienzo = document.querySelector<HTMLElement>('.linea__lienzo')!;
    fireEvent.pointerDown(fondo(), { clientX: 300, button: 0, pointerId: 3 });
    fireEvent.pointerMove(lienzo, { clientX: 300 + 48 * 6, pointerId: 3 });
    expect(await principal().findByText('Anterior')).toBeInTheDocument();
    fireEvent.pointerMove(lienzo, { clientX: 300 + 48 * 7, pointerId: 3 });
    fireEvent.pointerUp(lienzo, { clientX: 300 + 48 * 7, pointerId: 3 });
    await waitFor(() => expect(params().get('desde')).toBe('2026-10-05'));
  });

  it('si no se pudieron traer las tareas muestra el error con reintentar', async () => {
    await abrir('/linea-de-tiempo', TAREAS, { 'GET /api/tareas': falla(422, 'validacion', 'Se rompió todo') });
    expect(await screen.findByText('Se rompió todo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
  it('una automática pisada que OpenProject no corre ofrece «Abrir» en el aviso de la línea', async () => {
    const base = tareaDe(1, { titulo: 'Base', proyectoId: 11, inicio: '2026-10-20', fin: '2026-10-23' });
    const pisada = tareaDe(2, { titulo: 'Pisada', proyectoId: 11, inicio: '2026-10-22', fin: '2026-10-23', programacionManual: false });
    const { usuario } = await abrir('/linea-de-tiempo', [base, pisada], {
      'GET /api/tareas/2': ok({ tarea: pisada, actividades: [] }),
      'PATCH /api/tareas/2': ok({ tarea: pisada }),
    });
    await usuario.click(await screen.findByRole('button', { name: /Clic para correrla detrás/ }));
    const abrirAviso = await screen.findByRole('button', { name: 'Abrir' });
    await usuario.click(abrirAviso);
    await waitFor(() => expect(window.location.pathname).toBe('/linea-de-tiempo/tareas/2'));
  });
});

describe('Nueva tarea desde la línea', () => {
  // Una madre automática con una hija, en Portal de clientes, más las de siempre.
  const MADRE = tareaDe(20, { titulo: 'Etapa 1', proyectoId: 11, tipoId: 3, inicio: '2026-10-19', fin: '2026-10-23', programacionManual: false });
  const HIJA = tareaDe(21, { titulo: 'Diseño', proyectoId: 11, madreId: 20, inicio: '2026-10-19', fin: '2026-10-23' });

  /** Abre la línea con un servidor que guarda lo que se crea: la lista que vuelve a pedir la web ya la trae. */
  async function abrirConAlta(ruta = '/linea-de-tiempo', tareas = TAREAS) {
    const lista = [...tareas];
    const abierta = await abrir(ruta, tareas, {
      'GET /api/tareas': () => ok({ tareas: lista, dependencias: DEPENDENCIAS }),
      'POST /api/tareas': (cuerpo: unknown) => {
        const nueva = tareaDe(900, { ...(cuerpo as object), lockVersion: 0 });
        lista.push(nueva);
        return ok(nueva);
      },
    });
    return abierta;
  }
  const altas = (api: { llamadas: { metodo: string; ruta: string; cuerpo: unknown }[] }) =>
    api.llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/api/tareas').map((l) => l.cuerpo);

  it('el «+» de un proyecto la crea para hoy, a tu nombre y en manual; su barra aparece con el foco', async () => {
    const { api, usuario } = await abrirConAlta();
    await usuario.click(await principal().findByRole('button', { name: 'Nueva tarea en «Portal de clientes»' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva tarea' });
    expect(within(dialogo).getByRole('combobox', { name: 'Proyecto' })).toHaveDisplayValue('Portal de clientes');
    expect(within(dialogo).getByText(/Vence el 20 oct, a tu nombre/)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Crear' })).toBeDisabled();
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Título' }), 'Relevar requerimientos{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nueva tarea' })).toBeNull());
    expect(altas(api)).toEqual([{
      titulo: 'Relevar requerimientos', proyectoId: 11, estadoId: 1, responsableId: 9, madreId: null,
      inicio: '2026-10-20', fin: '2026-10-20', programacionManual: true,
    }]);
    const barra = await waitFor(() => {
      const b = document.querySelector<HTMLElement>('[data-tarea-id="900"]');
      expect(b).not.toBeNull();
      return b!;
    });
    await waitFor(() => expect(barra).toHaveFocus());
    expect(barra.closest('.renglon')).toHaveAttribute('data-recien');
    expect(await screen.findByText(/Creada «Relevar requerimientos» el 20 oct/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeInTheDocument();
  });

  it('el «+» de una madre crea una subtarea dentro de ella', async () => {
    const { api, usuario } = await abrirConAlta('/linea-de-tiempo', [...TAREAS, MADRE, HIJA]);
    await usuario.click(await principal().findByRole('button', { name: 'Nueva subtarea en «Etapa 1»' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva subtarea' });
    expect(within(dialogo).getByText('Dentro de «Etapa 1», en Portal de clientes')).toBeInTheDocument();
    expect(within(dialogo).queryByRole('combobox', { name: 'Proyecto' })).toBeNull();
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Título' }), 'Prototipo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(altas(api)).toHaveLength(1));
    expect(altas(api)[0]).toMatchObject({ titulo: 'Prototipo', proyectoId: 11, madreId: 20 });
    expect(await waitFor(() => document.querySelector('[data-renglon-tarea="900"]'))).not.toBeNull();
  });

  it('el botón de la barra de herramientas pide el proyecto; con un filtro activo propone ese', async () => {
    const { api, usuario } = await abrirConAlta('/linea-de-tiempo?proyecto=12');
    await screen.findByText(/de Migración del ERP/);
    await usuario.click(within(document.querySelector<HTMLElement>('.linea__controles')!).getByRole('button', { name: 'Nueva tarea' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva tarea' });
    const proyecto = within(dialogo).getByRole('combobox', { name: 'Proyecto' });
    expect(proyecto).toHaveDisplayValue('Migración del ERP');
    await usuario.selectOptions(proyecto, 'Portal de clientes');
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Título' }), 'Otra{Enter}');
    await waitFor(() => expect(altas(api)).toHaveLength(1));
    expect(altas(api)[0]).toMatchObject({ proyectoId: 11 });
    // Es de otro proyecto que el del filtro, pero recién creada se ve igual.
    expect(await waitFor(() => document.querySelector('[data-tarea-id="900"]'))).not.toBeNull();
  });

  it('el «+» de la barra superior abre el mismo diálogo sin salir de la línea', async () => {
    const { usuario } = await abrirConAlta();
    await principal().findByText('Portal de clientes');
    await usuario.click(document.querySelector<HTMLElement>('.herramientas__boton[aria-label="Nueva tarea"]')!);
    expect(await screen.findByRole('dialog', { name: 'Nueva tarea' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/linea-de-tiempo');
  });

  it('Cancelar y Escape cierran sin crear nada', async () => {
    const { api, usuario } = await abrirConAlta();
    await usuario.click(await principal().findByRole('button', { name: 'Nueva tarea en «Portal de clientes»' }));
    await usuario.type(await screen.findByRole('textbox', { name: 'Título' }), 'No va');
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Nueva tarea' })).toBeNull();
    await usuario.click(principal().getByRole('button', { name: 'Nueva tarea en «Portal de clientes»' }));
    await screen.findByRole('dialog', { name: 'Nueva tarea' });
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nueva tarea' })).toBeNull());
    expect(altas(api)).toHaveLength(0);
  });

  it('por persona no hay «+» en los renglones', async () => {
    await abrirConAlta('/linea-de-tiempo?vista=persona', [...TAREAS, MADRE, HIJA]);
    await principal().findByText('Ana Pereyra', { selector: '.renglon__titulo' });
    expect(principal().queryByRole('button', { name: /^Nueva (sub)?tarea en/ })).toBeNull();
  });
});

describe('Pausas en la línea', () => {
  it('una tarea pausada se corta en el hueco y la barra dice cuándo está en pausa', async () => {
    // «Cobranzas» va del martes 20 de octubre al martes 3 de noviembre; la pausa son el viernes 23 y el lunes 26.
    await abrir('/linea-de-tiempo', TAREAS, { 'GET /api/pausas': ok({ 2: [{ id: 500, tareaId: 2, despues: 3, dias: 2 }] }) });
    const barra = await waitFor(() => {
      const b = document.querySelector<HTMLElement>('button[data-tarea-id="2"]');
      expect(b?.getAttribute('aria-label')).toContain('en pausa del 23 oct al 26 oct');
      return b!;
    });
    expect(barra).toHaveClass('barra--pausada');
    // La ventana arranca el lunes 12 (48 px por día): el hueco va del viernes 23 al lunes 26, cuatro días.
    const hueco = document.querySelector<HTMLElement>('[data-hueco-de="2"]');
    expect(hueco?.style.left).toBe(`${11 * 48}px`);
    expect(hueco?.style.width).toBe(`${4 * 48}px`);
    // Una tarea sin pausas no tiene hueco.
    expect(document.querySelector('[data-hueco-de="3"]')).toBeNull();
  });
});
