import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../App.js';
import { EVENTO_TOKEN_VENCIDO, pedir } from '../api/cliente.js';
import { CATALOGO, falla, limpiarEntorno, ok, prepararEntorno, simularApi, TAREAS, YO } from '../../pruebas/fabricas/web.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const barraLateral = () => screen.findByRole('complementary', { name: 'Barra lateral' });

describe('Marco de la app', () => {
  it('la insignia de Tareas cuenta mis abiertas sin hitos', async () => {
    prepararEntorno('/tareas');
    simularApi();
    render(<App />);
    const lateral = await barraLateral();
    expect(await within(lateral).findByText('7')).toBeInTheDocument();
    expect(within(lateral).getByRole('link', { name: /Tareas/ })).toHaveAttribute('aria-current', 'page');
  });

  it('el menú muestra el número de Para ordenar solo cuando está todo cargado', async () => {
    prepararEntorno('/tareas');
    let soltar: () => void = () => undefined;
    const espera = new Promise<void>((resolver) => { soltar = resolver; });
    const { rutas } = simularApi();
    // El equipo tarda: mientras tanto no hay número (ni un «0» que después salte).
    rutas['GET /api/equipo'] = ok([]);
    const fetchBase = globalThis.fetch;
    vi.stubGlobal('fetch', async (entrada: RequestInfo | URL, init?: RequestInit) => {
      if (String(entrada).includes('/api/equipo')) await espera;
      return fetchBase(entrada, init);
    });
    render(<App />);
    const lateral = await barraLateral();
    const enlace = within(lateral).getByRole('link', { name: /Para ordenar/ });
    await within(within(lateral).getByRole('link', { name: /Tareas/ })).findByText('7');
    expect(enlace.querySelector('.lateral__cuenta')).toBeNull();
    soltar();
    await waitFor(() => expect(enlace.querySelector('.lateral__cuenta')).not.toBeNull());
  });

  it('Nueva reunión de Meet abre una reunión en el acto en otra pestaña', async () => {
    prepararEntorno('/tareas');
    simularApi();
    render(<App />);
    const enlace = await screen.findByRole('link', { name: 'Nueva reunión de Meet' });
    expect(enlace).toHaveAttribute('href', 'https://meet.google.com/new');
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('el botón de tema alterna data-tema', async () => {
    prepararEntorno('/tareas');
    simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    const boton = await screen.findByRole('button', { name: 'Cambiar a tema claro' });
    expect(document.documentElement.dataset.tema).toBe('oscuro');
    await usuario.click(boton);
    expect(document.documentElement.dataset.tema).toBe('claro');
    expect(localStorage.getItem('od:tema')).toBe('claro');
    await usuario.click(screen.getByRole('button', { name: 'Cambiar a tema oscuro' }));
    expect(document.documentElement.dataset.tema).toBe('oscuro');
  });

  it('el tema guardado gana al del servidor', async () => {
    prepararEntorno('/tareas');
    localStorage.setItem('od:tema', 'claro');
    simularApi();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Cambiar a tema oscuro' })).toBeInTheDocument();
    expect(document.documentElement.dataset.tema).toBe('claro');
  });

  it('abre el diálogo de token nuevo ante token-vencido', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/tareas': falla(401, 'token-vencido', 'Tu token de OpenProject venció, cargá uno nuevo') });
    render(<App />);
    const dialogo = await screen.findByRole('dialog', { name: 'Tu token de OpenProject venció' });
    expect(within(dialogo).getByLabelText('Token nuevo')).toBeInTheDocument();
  });

  it('con el token nuevo cierra el diálogo y vuelve a pedir los datos', async () => {
    prepararEntorno('/tareas');
    let vencido = true;
    const api = simularApi({
      'GET /api/tareas': () => (vencido
        ? falla(401, 'token-vencido', 'Tu token de OpenProject venció, cargá uno nuevo')
        : ok({ tareas: TAREAS, dependencias: [] })),
      'PUT /api/auth/token': () => {
        vencido = false;
        return ok({});
      },
    });
    const usuario = userEvent.setup();
    render(<App />);
    const dialogo = await screen.findByRole('dialog', { name: 'Tu token de OpenProject venció' });
    await usuario.type(within(dialogo).getByLabelText('Token nuevo'), 'token-nuevo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar token' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.llamadas).toContainEqual({ metodo: 'PUT', ruta: '/api/auth/token', cuerpo: { token: 'token-nuevo' } });
    expect(await within(await barraLateral()).findByText('7')).toBeInTheDocument();
  });

  it('si OpenProject no acepta el token nuevo lo dice y el diálogo sigue abierto', async () => {
    prepararEntorno('/tareas');
    simularApi({
      'GET /api/tareas': falla(401, 'token-vencido', 'Tu token de OpenProject venció, cargá uno nuevo'),
      'PUT /api/auth/token': falla(400, 'token-invalido', 'Ese token pertenece a otra persona'),
    });
    const usuario = userEvent.setup();
    render(<App />);
    const dialogo = await screen.findByRole('dialog', { name: 'Tu token de OpenProject venció' });
    await usuario.type(within(dialogo).getByLabelText('Token nuevo'), 'ajeno');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar token' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Ese token pertenece a otra persona');
  });

  it('muestra la banda de sin conexión', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/tareas': ok({ tareas: TAREAS, dependencias: [] }, true) });
    render(<App />);
    expect(await screen.findByText('Sin conexión con OpenProject: mostrando lo último guardado')).toBeInTheDocument();
  });

  it('sin la banda cuando los datos están al día', async () => {
    prepararEntorno('/tareas');
    simularApi();
    render(<App />);
    expect(await within(await barraLateral()).findByText('7')).toBeInTheDocument();
    expect(screen.queryByText('Sin conexión con OpenProject: mostrando lo último guardado')).not.toBeInTheDocument();
  });

  it('/ lleva a Inicio', async () => {
    prepararEntorno('/');
    simularApi();
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: /, Ana$/ })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/inicio');
  });

  it('la barra lateral ya no dice Próximamente en Calendario', async () => {
    prepararEntorno('/inicio');
    simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(within(await barraLateral()).getByRole('link', { name: 'Calendario' }));
    expect(await screen.findByRole('heading', { level: 1, name: /\d{4}$/ })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/calendario');
    expect(screen.queryByText('Próximamente')).not.toBeInTheDocument();
  });

  it('un fijado de la barra lateral lleva a su proyecto', async () => {
    prepararEntorno('/tareas');
    simularApi();
    render(<App />);
    const lateral = await barraLateral();
    expect(await within(lateral).findByRole('link', { name: 'Portal de clientes' })).toHaveAttribute('href', '/proyectos/11');
  });

  it('muestra los proyectos fijados y la tarjeta del usuario', async () => {
    prepararEntorno('/tareas');
    simularApi();
    render(<App />);
    const lateral = await barraLateral();
    expect(await within(lateral).findByRole('link', { name: 'Portal de clientes' })).toBeInTheDocument();
    expect(within(lateral).getByText('Fijados')).toBeInTheDocument();
    expect(within(lateral).getByText(YO.nombre)).toBeInTheDocument();
  });

  it('sin fijados no muestra la sección', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/auth/yo': ok({ ...YO, fijados: [] }) });
    render(<App />);
    const lateral = await barraLateral();
    expect(await within(lateral).findByText(YO.nombre)).toBeInTheDocument();
    expect(within(lateral).queryByText('Fijados')).not.toBeInTheDocument();
  });

  it('cerrar sesión avisa al servidor y vuelve al ingreso', async () => {
    prepararEntorno('/tareas');
    const api = simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(await screen.findByRole('button', { name: /Ana Pereyra/ }));
    await usuario.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/ingreso');
    expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/auth/salir', cuerpo: undefined });
  });

  describe('menú de cuenta', () => {
    const abrirMenu = async () => {
      prepararEntorno('/tareas');
      simularApi();
      const usuario = userEvent.setup();
      render(<App />);
      const boton = await screen.findByRole('button', { name: /Cuenta de Ana Pereyra/ });
      await usuario.click(boton);
      return { usuario, boton, menu: await screen.findByRole('menu', { name: 'Cuenta' }) };
    };

    it('muestra «Instalar OpenDash» solo cuando se puede', async () => {
      const { boton, usuario, menu } = await abrirMenu();
      expect(within(menu).queryByRole('menuitem', { name: 'Instalar OpenDash' })).toBeNull();
      await usuario.keyboard('{Escape}');
      // El entorno de prueba hace que toda consulta de medios coincida; acá no es modo app.
      const matchMediaPrevio = window.matchMedia;
      window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
      try {
        const prompt = vi.fn(async () => undefined);
        const evento = new Event('beforeinstallprompt', { cancelable: true });
        Object.assign(evento, { prompt });
        act(() => {
          window.dispatchEvent(evento);
        });
        await usuario.click(boton);
        const opcion = await screen.findByRole('menuitem', { name: 'Instalar OpenDash' });
        expect(within(await screen.findByRole('menu', { name: 'Cuenta' })).getAllByRole('menuitem')[0]).toBe(opcion);
        await usuario.click(opcion);
        expect(prompt).toHaveBeenCalledTimes(1);
      } finally {
        // El evento guardado vive a nivel de módulo: se lo limpia para que no pase a las demás pruebas.
        act(() => {
          window.dispatchEvent(new Event('appinstalled'));
        });
        window.matchMedia = matchMediaPrevio;
      }
    });

    it('abrir el menú de cuenta enfoca la primera opción', async () => {
      const { boton, menu } = await abrirMenu();
      const opciones = within(menu).getAllByRole('menuitem');
      expect(opciones.map((o) => o.textContent)).toEqual(['Configuración', 'Cerrar sesión']);
      expect(opciones[0]).toHaveFocus();
      expect(boton).toHaveAttribute('aria-controls', menu.id);
      expect(boton).toHaveAttribute('aria-haspopup', 'menu');
    });

    it('aria-controls está presente también con el menú cerrado', async () => {
      prepararEntorno('/tareas');
      simularApi();
      render(<App />);
      const boton = await screen.findByRole('button', { name: /Cuenta de Ana Pereyra/ });
      expect(boton).toHaveAttribute('aria-controls', 'menu-cuenta');
      expect(boton).toHaveAttribute('aria-expanded', 'false');
    });

    it('las flechas recorren las opciones del menú, de forma circular', async () => {
      const { usuario, menu } = await abrirMenu();
      const [configuracion, salir] = within(menu).getAllByRole('menuitem');
      await usuario.keyboard('{ArrowDown}');
      expect(salir).toHaveFocus();
      await usuario.keyboard('{ArrowDown}');
      expect(configuracion).toHaveFocus();
      await usuario.keyboard('{ArrowUp}');
      expect(salir).toHaveFocus();
    });

    it('Escape cierra el menú y devuelve el foco al botón', async () => {
      const { usuario, boton } = await abrirMenu();
      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(boton).toHaveFocus();
      expect(boton).toHaveAttribute('aria-expanded', 'false');
    });

    it('Tab cierra el menú', async () => {
      const { usuario } = await abrirMenu();
      await usuario.tab();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('si la sesión se pierde en plena pantalla vuelve al ingreso', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/tareas': falla(401, 'no-sesion', 'Tenés que iniciar sesión') });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/ingreso');
  });

  it('la banda se va cuando la misma consulta vuelve fresca o falla', async () => {
    prepararEntorno('/tareas');
    let respuesta = ok({ tareas: TAREAS, dependencias: [] }, true);
    simularApi({ 'GET /api/tareas': () => respuesta });
    render(<App />);
    const texto = 'Sin conexión con OpenProject: mostrando lo último guardado';
    expect(await screen.findByText(texto)).toBeInTheDocument();
    respuesta = ok({ tareas: TAREAS, dependencias: [] }, false);
    await act(() => pedir('GET', '/api/tareas'));
    expect(screen.queryByText(texto)).not.toBeInTheDocument();
    respuesta = ok({ tareas: TAREAS, dependencias: [] }, true);
    await act(() => pedir('GET', '/api/tareas'));
    expect(screen.getByText(texto)).toBeInTheDocument();
    respuesta = falla(503, 'sin-conexion', 'Sin conexión con OpenProject');
    await act(() => pedir('GET', '/api/tareas').catch(() => {}));
    expect(screen.queryByText(texto)).not.toBeInTheDocument();
  });

  it('el diálogo de token es modal: el fondo queda inerte y Tab no sale del diálogo', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/tareas': falla(401, 'token-vencido', 'Tu token de OpenProject venció, cargá uno nuevo') });
    const usuario = userEvent.setup();
    const { container } = render(<App />);
    const dialogo = await screen.findByRole('dialog', { name: 'Tu token de OpenProject venció' });
    const campo = within(dialogo).getByLabelText('Token nuevo');
    await waitFor(() => expect(campo).toHaveFocus());
    expect(container.querySelector('.marco')).toHaveAttribute('inert');
    await usuario.type(campo, 'nuevo');
    const salir = within(dialogo).getByRole('button', { name: 'Cerrar sesión' });
    const guardar = within(dialogo).getByRole('button', { name: 'Guardar token' });
    await usuario.tab();
    expect(salir).toHaveFocus();
    await usuario.tab();
    expect(guardar).toHaveFocus();
    await usuario.tab();
    expect(campo).toHaveFocus();
    await usuario.tab({ shift: true });
    expect(guardar).toHaveFocus();
  });

  it('al cerrarse el diálogo el foco vuelve adonde estaba y el fondo deja de estar inerte', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'PUT /api/auth/token': ok({}) });
    const usuario = userEvent.setup();
    const { container } = render(<App />);
    const tema = await screen.findByRole('button', { name: 'Cambiar a tema claro' });
    act(() => tema.focus());
    act(() => {
      window.dispatchEvent(new Event(EVENTO_TOKEN_VENCIDO));
    });
    const dialogo = await screen.findByRole('dialog', { name: 'Tu token de OpenProject venció' });
    await usuario.type(within(dialogo).getByLabelText('Token nuevo'), 'nuevo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar token' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(tema).toHaveFocus();
    expect(container.querySelector('.marco')).not.toHaveAttribute('inert');
  });

  it('sin tema guardado adopta el del servidor y lo recuerda', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/auth/yo': ok({ ...YO, tema: 'claro' }) });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Cambiar a tema oscuro' })).toBeInTheDocument();
    expect(document.documentElement.dataset.tema).toBe('claro');
    expect(localStorage.getItem('od:tema')).toBe('claro');
  });

  it('la tarjeta del usuario muestra su foto por el proxy propio', async () => {
    prepararEntorno('/tareas');
    const conFoto = { ...CATALOGO, personas: CATALOGO.personas.map((p) => (p.id === YO.id ? { ...p, avatarUrl: '/api/personas/9/avatar' } : p)) };
    simularApi({ 'GET /api/catalogo': ok(conFoto) });
    render(<App />);
    const lateral = await barraLateral();
    await waitFor(() => expect(lateral.querySelector('img')).toHaveAttribute('src', '/api/personas/9/avatar'));
  });

  describe('refresco periódico', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const pedidosDeTareas = (llamadas: { ruta: string }[]) => llamadas.filter((l) => l.ruta === '/api/tareas').length;

    it('sin problemas vuelve a pedir las tareas a los 30 s', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      prepararEntorno('/tareas');
      const api = simularApi();
      render(<App />);
      expect(await within(await barraLateral()).findByText('7')).toBeInTheDocument();
      const antes = pedidosDeTareas(api.llamadas);
      await act(() => vi.advanceTimersByTimeAsync(31_000));
      expect(pedidosDeTareas(api.llamadas)).toBeGreaterThan(antes);
    });

    it('con el token vencido deja de pedir cada 30 s', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      prepararEntorno('/tareas');
      // Como el servidor real: con el token vencido, toda ruta que lo usa responde token-vencido.
      const vencido = falla(401, 'token-vencido', 'Tu token de OpenProject venció, cargá uno nuevo');
      const api = simularApi({ 'GET /api/auth/yo': ok({ ...YO, tieneCalendario: true }) });
      // Todo lo que usa el token responde token-vencido; solo el perfil y el calendario siguen andando.
      for (const clave of Object.keys(api.rutas)) {
        if (clave.startsWith('GET ') && clave !== 'GET /api/auth/yo' && clave !== 'GET /api/calendario') api.rutas[clave] = vencido;
      }
      api.rutas['GET /api/calendario'] = ok({ reuniones: [{ id: 'r1', titulo: 'Semanal', lugar: null, inicio: new Date(Date.now() + 3 * 60_000).toISOString(), fin: new Date(Date.now() + 60 * 60_000).toISOString(), diaEntero: false, libre: false, enlace: null, plataforma: null }], estado: null, ventana: null });
      render(<App />);
      await screen.findByRole('dialog', { name: 'Tu token de OpenProject venció' });
      await waitFor(() => expect(api.llamadas.map((l) => l.ruta)).toContain('/api/notificaciones'));
      await waitFor(() => expect(api.llamadas.map((l) => l.ruta)).toContain('/api/calendario'));
      // El aviso de la reunión aparece aunque el resto responda token-vencido.
      expect(await screen.findByText(/Semanal/, { selector: '[role="status"] *' })).toBeInTheDocument();
      const sinCalendario = () => api.llamadas.filter((l) => l.ruta !== '/api/calendario').length;
      const delCalendario = () => api.llamadas.filter((l) => l.ruta === '/api/calendario').length;
      const antes = sinCalendario();
      const calendarioAntes = delCalendario();
      await act(() => vi.advanceTimersByTimeAsync(125_000));
      expect(sinCalendario()).toBe(antes);
      // El calendario no usa el token de OpenProject: el aviso de reuniones sigue pidiéndolo.
      expect(delCalendario()).toBeGreaterThan(calendarioAntes);
    });
  });

  it('marca la campanita si hay notificaciones sin leer', async () => {
    prepararEntorno('/tareas');
    simularApi();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Notificaciones, hay sin leer' })).toBeInTheDocument();
  });
});
