import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { EstadoHoras, Tramo } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { crearClienteConsultas } from '../api/consultas.js';
import { falla, limpiarEntorno, ok, prepararEntorno, simularApi, YO } from '../../pruebas/fabricas/web.js';
import { BotonTrabajar } from './BotonTrabajar.js';
import { CorreccionTramo } from './CorreccionTramo.js';
import { cuandoFue } from './AvisosHoras.js';
import { HorasProvider, useReloj } from './HorasProvider.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
  delete (window as unknown as { IdleDetector?: unknown }).IdleDetector;
  Object.defineProperty(navigator, 'permissions', { value: undefined, configurable: true });
  try { localStorage.clear(); } catch { /* sin almacenamiento */ }
});

const tramoDe = (extra: Partial<Tramo> = {}): Tramo => ({
  id: 1, usuarioId: 9, tareaId: 2, dia: '2026-10-23', inicio: '2026-10-23T12:00:00Z', fin: null, pausado: false, segundos: null,
  frenadoSolo: null, avisoVisto: false, estado: 'abierto', entradaOpId: null, motivo: null, ...extra,
});
const estadoDe = (extra: Partial<EstadoHoras> = {}): EstadoHoras => ({
  enMarcha: [], hoy: [], avisos: [], totalHoySegundos: 0, jornadaSegundos: 28800, variasALaVez: false, horasExtra: false, ultimoDia: null, ...extra,
});
const enMarcha = (segundos = 125): EstadoHoras => estadoDe({ enMarcha: [{ ...tramoDe(), segundosVivos: segundos }], totalHoySegundos: segundos });

type Rutas = Parameters<typeof simularApi>[0];

function definirSeguro(valor: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value: valor, configurable: true });
}

function montarSuelto(ui: React.ReactNode) {
  const qc = crearClienteConsultas();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><HorasProvider>{ui}</HorasProvider></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function abrirApp(ruta: string, rutas: Rutas) {
  prepararEntorno(ruta);
  const api = simularApi(rutas);
  render(<App />);
  await screen.findByRole('heading', { level: 1 });
  return { api, usuario: userEvent.setup() };
}

describe('Cronómetro', () => {
  it('▶ arranca y muestra el reloj con Pausa y Terminar', async () => {
    prepararEntorno('/');
    let estado = estadoDe();
    const api = simularApi({
      'GET /api/horas': () => ok(estado),
      'POST /api/horas': () => { estado = enMarcha(0); return ok(tramoDe()); },
    });
    montarSuelto(<BotonTrabajar tareaId={2} titulo="T2" />);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /Trabajar en esta/ }));
    expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/horas', cuerpo: { tareaId: 2 } });
    expect(await screen.findByRole('button', { name: 'Pausa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminar' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/^0:00:0\d$/);
  });

  it('la isla es una sola píldora: la tarea que corre y cuántas más hay, y no aparece en Inicio', async () => {
    const segundo = { ...tramoDe({ id: 2, tareaId: 3 }), segundosVivos: 60 };
    const estado = estadoDe({ enMarcha: [{ ...tramoDe(), segundosVivos: 125 }, segundo] });
    await abrirApp('/equipo', { 'GET /api/horas': ok(estado) });
    const isla = await screen.findByRole('link', { name: 'Trabajando en T2 y 1 tarea más: 0:02:05. Ir a Inicio' });
    expect(isla).toHaveAttribute('href', '/inicio');
    expect(isla).toHaveTextContent('+1');
    expect(screen.getAllByRole('link', { name: /Trabajando en/ })).toHaveLength(1);
    cleanup();
    limpiarEntorno();
    await abrirApp('/inicio', { 'GET /api/horas': ok(estado) });
    expect(screen.queryByRole('link', { name: /Trabajando en/ })).not.toBeInTheDocument();
  });
});

describe('Esquina de arriba a la derecha', () => {
  it('la isla muestra la tarea que corre aunque la primera esté en pausa', async () => {
    const pausada = { ...tramoDe({ pausado: true }), segundosVivos: 30 };
    const corre = { ...tramoDe({ id: 2, tareaId: 3 }), segundosVivos: 60 };
    await abrirApp('/equipo', { 'GET /api/horas': ok(estadoDe({ enMarcha: [pausada, corre] })) });
    expect(await screen.findByRole('link', { name: /^Trabajando en T3 y 1 tarea más: 0:01:0\d\. Ir a Inicio$/ })).toBeInTheDocument();
  });

  it('con tres tareas en marcha, el aviso de reunión queda en la misma columna, después de la isla', async () => {
    const mas = (id: number) => ({ ...tramoDe({ id, tareaId: id + 1 }), segundosVivos: 60 });
    const estado = estadoDe({ enMarcha: [{ ...tramoDe(), segundosVivos: 125 }, mas(2), mas(3)] });
    const inicio = new Date(Date.now() + 3 * 60_000).toISOString();
    const reunion = {
      id: 'r1', titulo: 'Semanal', lugar: null, inicio, fin: new Date(Date.now() + 3_600_000).toISOString(),
      diaEntero: false, libre: false, enlace: null, plataforma: null,
    };
    await abrirApp('/equipo', {
      'GET /api/horas': ok(estado),
      'GET /api/auth/yo': ok({ ...YO, tieneCalendario: true, avisoReunionMin: 5 }),
      'GET /api/calendario': ok({ reuniones: [reunion], estado: null, ventana: null }),
    });
    const pieza = await waitFor(() => {
      const el = document.querySelector('.aviso-reunion');
      if (!el) throw new Error('sin aviso');
      return el;
    });
    // Una sola píldora aunque haya tres tareas: así la columna no tapa los números de arriba.
    const islas = document.querySelectorAll('.isla');
    expect(islas).toHaveLength(1);
    expect(islas[0]).toHaveTextContent('+2');
    const esquina = pieza.closest('.esquina');
    expect(esquina).not.toBeNull();
    // La isla y el aviso están en la misma columna fija; el aviso va después.
    expect(esquina?.contains(islas[0] ?? null)).toBe(true);
    expect(islas[0]?.compareDocumentPosition(pieza) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('Inactividad', () => {
  const rutasConTramo = (api: { estado: EstadoHoras }): Rutas => ({
    'GET /api/horas': () => ok(api.estado),
    'POST /api/horas': () => { api.estado = enMarcha(0); return ok(tramoDe()); },
    'POST /api/horas/inactividad': () => { api.estado = estadoDe(); return ok(api.estado); },
  });

  it('sin contexto seguro no se pide permiso ni se pregunta', async () => {
    definirSeguro(false);
    const requestPermission = vi.fn(async () => 'granted');
    (window as unknown as { IdleDetector: unknown }).IdleDetector = class { static requestPermission = requestPermission; };
    const api = { estado: estadoDe() };
    prepararEntorno('/');
    simularApi(rutasConTramo(api));
    montarSuelto(<BotonTrabajar tareaId={2} titulo="T2" />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Trabajar en esta/ }));
    await screen.findByRole('button', { name: 'Pausa' });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByText(/sin actividad/)).not.toBeInTheDocument();
  });

  it('con IdleDetector simulado, al volver pregunta y «No, paré» manda la hora', async () => {
    definirSeguro(true);
    const instancias: (EventTarget & { userState: string; screenState: string })[] = [];
    const requestPermission = vi.fn(async () => 'granted');
    (window as unknown as { IdleDetector: unknown }).IdleDetector = class extends EventTarget {
      static requestPermission = requestPermission;
      userState = 'active';
      screenState = 'unlocked';
      constructor() { super(); instancias.push(this); }
      async start(): Promise<void> {}
    };
    const api = { estado: estadoDe() };
    const llamadas = (() => {
      prepararEntorno('/');
      return simularApi(rutasConTramo(api));
    })();
    montarSuelto(<BotonTrabajar tareaId={2} titulo="T2" />);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /Trabajar en esta/ }));
    expect(requestPermission).not.toHaveBeenCalled();
    expect(await screen.findByText('Para preguntarte si seguías trabajando cuando la PC queda sin uso')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Permitir' }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(instancias).toHaveLength(1));
    const detector = instancias[0]!;
    detector.userState = 'idle';
    detector.dispatchEvent(new Event('change'));
    detector.userState = 'active';
    detector.dispatchEvent(new Event('change'));
    expect(await screen.findByText(/Estuviste sin actividad desde las/)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: /^No, paré a las \d\d:\d\d$/ }));
    await waitFor(() => expect(llamadas.llamadas.some((l) => l.ruta === '/api/horas/inactividad')).toBe(true));
    const pedido = llamadas.llamadas.find((l) => l.ruta === '/api/horas/inactividad')!.cuerpo as { desde: string; seguia: boolean };
    expect(pedido.seguia).toBe(false);
    expect(Number.isNaN(Date.parse(pedido.desde))).toBe(false);
  });

  const detectorSimulado = (opciones: { permiso?: 'granted' | 'denied'; falla?: boolean } = {}) => {
    const instancias: (EventTarget & { userState: string; screenState: string })[] = [];
    const requestPermission = vi.fn(async () => opciones.permiso ?? 'granted');
    (window as unknown as { IdleDetector: unknown }).IdleDetector = class extends EventTarget {
      static requestPermission = requestPermission;
      userState = 'active';
      screenState = 'unlocked';
      constructor() { super(); instancias.push(this); }
      async start(): Promise<void> { if (opciones.falla) throw new Error('permiso revocado'); }
    };
    return { instancias, requestPermission };
  };

  it('«Ahora no» no pide el permiso ni vuelve a molestar', async () => {
    definirSeguro(true);
    const { requestPermission } = detectorSimulado();
    const api = { estado: estadoDe() };
    prepararEntorno('/');
    simularApi(rutasConTramo(api));
    montarSuelto(<BotonTrabajar tareaId={2} titulo="T2" />);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /Trabajar en esta/ }));
    await usuario.click(await screen.findByRole('button', { name: 'Ahora no' }));
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByText(/Para preguntarte/)).not.toBeInTheDocument();
    expect(localStorage.getItem('opendash.inactividad.permiso')).toBe('ahora-no');
  });

  it('si start falla se olvida el permiso guardado', async () => {
    definirSeguro(true);
    const { instancias } = detectorSimulado({ falla: true });
    prepararEntorno('/');
    localStorage.setItem('opendash.inactividad.permiso', 'granted');
    simularApi({ 'GET /api/horas': ok(enMarcha()) });
    montarSuelto(<div />);
    await waitFor(() => expect(instancias).toHaveLength(1));
    await waitFor(() => expect(localStorage.getItem('opendash.inactividad.permiso')).toBeNull());
  });

  it('consulta el permiso real: si el navegador lo niega, lo guardado se corrige', async () => {
    definirSeguro(true);
    const { instancias } = detectorSimulado();
    Object.defineProperty(navigator, 'permissions', { value: { query: vi.fn(async () => ({ state: 'denied' })) }, configurable: true });
    prepararEntorno('/');
    localStorage.setItem('opendash.inactividad.permiso', 'granted');
    simularApi({ 'GET /api/horas': ok(enMarcha()) });
    montarSuelto(<div />);
    await waitFor(() => expect(localStorage.getItem('opendash.inactividad.permiso')).toBe('denied'));
    expect(instancias).toHaveLength(0);
  });

  it('al terminar y empezar de nuevo no reaparece una pregunta vieja', async () => {
    definirSeguro(true);
    const { instancias } = detectorSimulado();
    const api = { estado: enMarcha() };
    prepararEntorno('/');
    localStorage.setItem('opendash.inactividad.permiso', 'granted');
    simularApi({
      ...rutasConTramo(api),
      'POST /api/horas/1/terminar': () => { api.estado = estadoDe(); return ok(tramoDe()); },
    });
    montarSuelto(<BotonTrabajar tareaId={2} titulo="T2" />);
    const usuario = userEvent.setup();
    await waitFor(() => expect(instancias).toHaveLength(1));
    instancias[0]!.userState = 'idle';
    instancias[0]!.dispatchEvent(new Event('change'));
    instancias[0]!.userState = 'active';
    instancias[0]!.dispatchEvent(new Event('change'));
    expect(await screen.findByText(/Estuviste sin actividad desde las/)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Terminar' }));
    await usuario.click(await screen.findByRole('button', { name: /Trabajar en esta/ }));
    await screen.findByRole('button', { name: 'Pausa' });
    expect(screen.queryByText(/Estuviste sin actividad desde las/)).not.toBeInTheDocument();
  });
  const volverDeLaInactividad = (detector: EventTarget & { userState: string }): void => {
    detector.userState = 'idle';
    detector.dispatchEvent(new Event('change'));
    detector.userState = 'active';
    detector.dispatchEvent(new Event('change'));
  };

  it('con todo en pausa no se detecta la inactividad ni se pregunta', async () => {
    definirSeguro(true);
    const { instancias } = detectorSimulado();
    prepararEntorno('/');
    localStorage.setItem('opendash.inactividad.permiso', 'granted');
    simularApi({ 'GET /api/horas': ok(estadoDe({ enMarcha: [{ ...tramoDe({ pausado: true }), segundosVivos: 60 }], totalHoySegundos: 60 })) });
    montarSuelto(<div />);
    await new Promise((r) => setTimeout(r, 50));
    expect(instancias).toHaveLength(0);
    expect(screen.queryByText(/Estuviste sin actividad/)).not.toBeInTheDocument();
  });

  it('la pregunta lleva el foco, Escape contesta «Sí, seguía» y el foco vuelve', async () => {
    definirSeguro(true);
    const { instancias } = detectorSimulado();
    const api = { estado: enMarcha() };
    prepararEntorno('/');
    localStorage.setItem('opendash.inactividad.permiso', 'granted');
    const llamadas = simularApi(rutasConTramo(api));
    montarSuelto(<><BotonTrabajar tareaId={2} titulo="T2" /><button type="button">Fuera</button></>);
    await waitFor(() => expect(instancias).toHaveLength(1));
    const fuera = await screen.findByRole('button', { name: 'Fuera' });
    fuera.focus();
    volverDeLaInactividad(instancias[0]!);
    const dialogo = await screen.findByRole('alertdialog');
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(dialogo).toHaveAttribute('aria-describedby');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sí, seguía' })).toHaveFocus());
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(llamadas.llamadas.find((l) => l.ruta === '/api/horas/inactividad')?.cuerpo).toMatchObject({ seguia: true }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fuera).toHaveFocus();
  });

  it('si la respuesta falla, la pregunta sigue con el error y se puede reintentar', async () => {
    definirSeguro(true);
    const { instancias } = detectorSimulado();
    const api = { estado: enMarcha() };
    prepararEntorno('/');
    localStorage.setItem('opendash.inactividad.permiso', 'granted');
    let intentos = 0;
    simularApi({
      ...rutasConTramo(api),
      'POST /api/horas/inactividad': () => {
        intentos += 1;
        if (intentos === 1) return falla(500, 'interno', 'No hay conexión con el servidor');
        api.estado = estadoDe();
        return ok(api.estado);
      },
    });
    montarSuelto(<BotonTrabajar tareaId={2} titulo="T2" />);
    await waitFor(() => expect(instancias).toHaveLength(1));
    volverDeLaInactividad(instancias[0]!);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /^No, paré a las/ }));
    expect(await screen.findByText('No hay conexión con el servidor')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: /^No, paré a las/ }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});

function VerReloj() {
  const { enMarcha, totalHoySegundos } = useReloj();
  return <p data-testid="reloj">{enMarcha.map((t) => t.segundosVivos).join(',')}|{totalHoySegundos}</p>;
}

describe('Reloj vivo', () => {
  it('con varias en marcha cada una suma el tiempo entero y el día, una sola vez', async () => {
    const corre = { ...tramoDe({ id: 2, tareaId: 3 }), segundosVivos: 50 };
    simularApi({ 'GET /api/horas': ok(estadoDe({ enMarcha: [{ ...tramoDe(), segundosVivos: 100 }, corre], totalHoySegundos: 100 })) });
    montarSuelto(<VerReloj />);
    await waitFor(() => expect(screen.getByTestId('reloj')).toHaveTextContent('100,50|100'));
    const base = Date.now();
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(base + 10_000);
    try {
      await waitFor(() => expect(screen.getByTestId('reloj')).toHaveTextContent('110,60|110'), { timeout: 3000 });
    } finally {
      reloj.mockRestore();
    }
  });
});

describe('Avisos y corrección', () => {
  it('aviso de frenado solo con Corregir', async () => {
    const tramo = tramoDe({ fin: '2026-10-23T20:00:00Z', segundos: 28800, frenadoSolo: 'tope', estado: 'cargado' });
    const { usuario } = await abrirApp('/equipo', { 'GET /api/horas': ok(estadoDe({ avisos: [tramo] })) });
    expect(await screen.findByText(/se frenó solo al llegar a las 8 h/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Está bien' })).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Corregir' }));
    expect(screen.getByText('Cargaste 8 h en «T2»')).toBeInTheDocument();
  });

  it('un pendiente recién cerrado no avisa; varios viejos se juntan y se pueden ocultar', async () => {
    const reciente = tramoDe({ id: 5, fin: new Date().toISOString(), segundos: 60, estado: 'pendiente' });
    const { usuario } = await abrirApp('/equipo', { 'GET /api/horas': ok(estadoDe({ avisos: [reciente] })) });
    expect(screen.queryByText(/pendiente/)).not.toBeInTheDocument();
    cleanup();
    limpiarEntorno();
    const viejos = [2, 3, 4].map((id) => tramoDe({ id, fin: '2026-10-23T14:00:00Z', segundos: 7200, estado: 'pendiente' }));
    const otra = await abrirApp('/equipo', { 'GET /api/horas': ok(estadoDe({ avisos: [reciente, ...viejos] })) });
    expect(await screen.findByText('3 tramos pendientes de cargar a OpenProject')).toBeInTheDocument();
    await otra.usuario.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(screen.queryByText(/tramos pendientes/)).not.toBeInTheDocument();
    void usuario;
  });

  it('cuandoFue nombra el día si no es hoy ni ayer', () => {
    expect(cuandoFue('2026-10-26', '2026-10-26')).toBe('Hoy');
    expect(cuandoFue('2026-10-25', '2026-10-26')).toBe('Ayer');
    expect(cuandoFue('2026-10-23', '2026-10-26')).toBe('El viernes');
    expect(cuandoFue('2026-10-10', '2026-10-26')).toBe('El 10/10');
  });

  it('rechazado muestra el motivo y las tres salidas', async () => {
    const tramo = tramoDe({ fin: '2026-10-23T14:00:00Z', segundos: 7200, estado: 'rechazado', motivo: 'No tenés permiso para cargar horas en ese proyecto' });
    await abrirApp('/equipo', { 'GET /api/horas': ok(estadoDe({ avisos: [tramo] })) });
    expect(await screen.findByText(/no se pudo cargar: No tenés permiso/)).toBeInTheDocument();
    for (const nombre of ['Reintentar', 'Pasarlo a otra tarea', 'Descartar']) {
      expect(screen.getByRole('button', { name: nombre })).toBeInTheDocument();
    }
  });

  it('pendiente se ve como «pendiente de cargar»', async () => {
    const tramo = tramoDe({ fin: '2026-10-23T14:00:00Z', segundos: 7200, estado: 'pendiente' });
    await abrirApp('/equipo', { 'GET /api/horas': ok(estadoDe({ avisos: [tramo] })) });
    expect(await screen.findByText(/pendiente de cargar/)).toBeInTheDocument();
  });

  it('corregir manda los segundos y muestra el error de jornada', async () => {
    prepararEntorno('/');
    const api = simularApi({
      'GET /api/horas': ok(estadoDe()),
      'PATCH /api/horas/1': falla(400, 'validacion', 'El día no puede pasar las 8 h'),
    });
    montarSuelto(<CorreccionTramo tramo={tramoDe({ fin: '2026-10-23T14:00:00Z', segundos: 3600, estado: 'cargado' })} />);
    const usuario = userEvent.setup();
    const horas = await screen.findByRole('spinbutton', { name: 'Horas' });
    await usuario.clear(horas);
    await usuario.type(horas, '2');
    const minutos = screen.getByRole('spinbutton', { name: 'Minutos' });
    await usuario.clear(minutos);
    await usuario.type(minutos, '30');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(api.llamadas).toContainEqual({ metodo: 'PATCH', ruta: '/api/horas/1', cuerpo: { segundos: 9000 } });
    expect(await screen.findByText('El día no puede pasar las 8 h')).toBeInTheDocument();
  });
});
