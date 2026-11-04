import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { AvisoProblema, ContextoAviso } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { LimiteDeErrores } from '../marco/LimiteDeErrores.js';
import { AJUSTES, limpiarEntorno, ok, prepararEntorno, simularApi, YO } from '../../pruebas/fabricas/web.js';
import { anotarError, errorReciente, olvidarError } from './ultimoError.js';
import { armarContexto } from './contexto.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
  olvidarError();
  vi.restoreAllMocks();
});

const CONTEXTO: ContextoAviso = {
  ruta: '/tareas', titulo: 'Tareas', navegador: 'jsdom', ventana: '1024x768', tema: 'oscuro', version: 'sin-git', error: null,
};

const aviso = (id: number, extra: Partial<AvisoProblema> = {}): AvisoProblema => ({
  id, usuarioId: 5, creado: '2026-10-25T12:00:00.000Z', texto: `Problema ${id}`, contexto: CONTEXTO,
  tieneImagen: false, estado: 'nuevo', marcadoPor: null, marcadoEl: null, ...extra,
});

const RECEPTOR = { ...YO, recibeAvisos: true };

async function abrirDialogo(rutas: Parameters<typeof simularApi>[0] = {}, ruta = '/inicio') {
  prepararEntorno(ruta);
  const api = simularApi({ 'GET /api/avisos-problema/mios': ok([]), ...rutas });
  render(<App />);
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole('button', { name: 'Avisar un problema' }));
  const dialogo = await screen.findByRole('dialog', { name: 'Avisar un problema' });
  return { api, usuario, dialogo };
}

const envioDe = (api: { llamadas: { metodo: string; ruta: string; cuerpo: unknown }[] }) =>
  api.llamadas.find((l) => l.metodo === 'POST' && l.ruta === '/api/avisos-problema')?.cuerpo as
    { texto: string; contexto: ContextoAviso; imagen?: { tipo: string; datos: string } } | undefined;

describe('Avisar un problema', () => {
  it('el botón abre el diálogo y Enviar manda texto y contexto', async () => {
    const { api, usuario, dialogo } = await abrirDialogo({ 'POST /api/avisos-problema': ok({ id: 1 }) });
    expect(within(dialogo).getByText('Se adjunta solo:')).toBeInTheDocument();
    await usuario.type(within(dialogo).getByLabelText('¿Qué pasó o qué te falta?'), 'No carga la lista');
    expect(within(dialogo).getByText('17 / 4000')).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar' }));
    expect(await within(dialogo).findByText('Gracias, le llegó a quien recibe los avisos.')).toBeInTheDocument();
    const cuerpo = envioDe(api);
    expect(cuerpo?.texto).toBe('No carga la lista');
    expect(cuerpo?.contexto.ruta).toBe('/inicio');
    expect(cuerpo?.contexto.tema).toBe('oscuro');
    expect(cuerpo?.imagen).toBeUndefined();
  });

  it('con un solo receptor, el agradecimiento lleva su nombre', async () => {
    const ajustes = { ...AJUSTES, avisos: { receptores: [5] } };
    const { usuario, dialogo } = await abrirDialogo({ 'GET /api/ajustes': ok(ajustes), 'POST /api/avisos-problema': ok({ id: 1 }) });
    await usuario.type(within(dialogo).getByLabelText('¿Qué pasó o qué te falta?'), 'Algo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar' }));
    expect(await within(dialogo).findByText('Gracias, le llegó a Martín.')).toBeInTheDocument();
  });

  it('no envía con el texto vacío', async () => {
    const { dialogo } = await abrirDialogo();
    expect(within(dialogo).getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('pegar una imagen la adjunta y se manda en base64', async () => {
    const { api, usuario, dialogo } = await abrirDialogo({ 'POST /api/avisos-problema': ok({ id: 1 }) });
    const texto = within(dialogo).getByLabelText('¿Qué pasó o qué te falta?');
    await usuario.type(texto, 'Mirá esto');
    const chica = new File([new Uint8Array([137, 80, 78, 71])], 'captura.png', { type: 'image/png' });
    fireEvent.paste(texto, { clipboardData: { files: [chica], items: [], types: ['Files'] } });
    expect(await within(dialogo).findByText('captura.png')).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar' }));
    await within(dialogo).findByText(/Gracias/);
    expect(envioDe(api)?.imagen).toEqual({ tipo: 'image/png', datos: 'iVBORw==' });
  });

  it('una imagen de 4 MB muestra el error, no se adjunta y el aviso sale solo con el texto', async () => {
    const { api, usuario, dialogo } = await abrirDialogo({ 'POST /api/avisos-problema': ok({ id: 1 }) });
    const texto = within(dialogo).getByLabelText('¿Qué pasó o qué te falta?');
    await usuario.type(texto, 'Mirá esto');
    const grande = new File([new Uint8Array(4 * 1024 * 1024)], 'enorme.png', { type: 'image/png' });
    fireEvent.paste(texto, { clipboardData: { files: [grande], items: [], types: ['Files'] } });
    expect(await within(dialogo).findByText('La imagen pesa más de 3 MB.')).toBeInTheDocument();
    expect(within(dialogo).queryByText('enorme.png')).not.toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar' }));
    await within(dialogo).findByText(/Gracias/);
    expect(envioDe(api)?.imagen).toBeUndefined();
    expect(envioDe(api)?.texto).toBe('Mirá esto');
  });

  /** Hace que el POST del aviso no responda hasta llamar a `soltar`. */
  function retenerEnvio() {
    const fetchSimulado = globalThis.fetch;
    let soltar: () => void = () => undefined;
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && String(entrada).endsWith('/api/avisos-problema')) {
        return new Promise<Response>((resolver) => { soltar = () => resolver(fetchSimulado(entrada, init)); });
      }
      return fetchSimulado(entrada, init);
    });
    return { soltar: () => soltar() };
  }

  it('mientras se envía no se cierra con Escape, Cancelar, la X ni el velo', async () => {
    const { usuario, dialogo } = await abrirDialogo({ 'POST /api/avisos-problema': ok({ id: 1 }) });
    const envio = retenerEnvio();
    await usuario.type(within(dialogo).getByLabelText('¿Qué pasó o qué te falta?'), 'Algo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar' }));
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await usuario.keyboard('{Escape}');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    fireEvent.pointerDown(dialogo.parentElement!);
    expect(screen.getByRole('dialog', { name: 'Avisar un problema' })).toBeInTheDocument();
    envio.soltar();
    expect(await within(dialogo).findByText(/Gracias/)).toBeInTheDocument();
    await usuario.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Avisar un problema' })).not.toBeInTheDocument();
  });

  it('«Tus avisos» muestra la última lectura aunque la anterior llegue después', async () => {
    prepararEntorno('/inicio');
    simularApi({ 'POST /api/avisos-problema': ok({ id: 1 }) });
    const fetchSimulado = globalThis.fetch;
    const respuestas: ((lista: AvisoProblema[]) => void)[] = [];
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) => {
      if (!String(entrada).endsWith('/api/avisos-problema/mios')) return fetchSimulado(entrada, init);
      return new Promise<Response>((resolver) => {
        respuestas.push((lista) => resolver(new Response(
          JSON.stringify(ok(lista).cuerpo), { status: 200, headers: { 'content-type': 'application/json' } },
        )));
      });
    });
    render(<App />);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Avisar un problema' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Avisar un problema' });
    await usuario.type(within(dialogo).getByLabelText('¿Qué pasó o qué te falta?'), 'Algo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar' }));
    await within(dialogo).findByText(/Gracias/);
    await waitFor(() => expect(respuestas).toHaveLength(2));
    // Primero llega la lectura más nueva; la de antes del envío (vacía) llega tarde y no puede pisarla.
    respuestas[1]!([aviso(7, { texto: 'Recién enviado' })]);
    expect(await within(dialogo).findByText('Recién enviado')).toBeInTheDocument();
    respuestas[0]!([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(within(dialogo).getByText('Recién enviado')).toBeInTheDocument();
  });

  it('un archivo que no es png, jpg ni webp se rechaza', async () => {
    const { dialogo } = await abrirDialogo();
    const entrada = dialogo.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(entrada, { target: { files: [new File(['x'], 'nota.pdf', { type: 'application/pdf' })] } });
    expect(await within(dialogo).findByText('La imagen tiene que ser png, jpg o webp.')).toBeInTheDocument();
  });

  it('«Tus avisos» lista los propios con su estado', async () => {
    const { dialogo } = await abrirDialogo({
      'GET /api/avisos-problema/mios': ok([aviso(2, { texto: 'Se ve mal el menú', estado: 'visto' }), aviso(1, { texto: 'No guarda', estado: 'arreglado' })]),
    });
    const lista = await within(dialogo).findByRole('list', { name: 'Tus avisos' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas[0]).toHaveTextContent('Se ve mal el menú');
    expect(filas[0]).toHaveTextContent('Visto');
    expect(filas[1]).toHaveTextContent('Arreglado');
  });

  it('un error al enviar se muestra en el diálogo', async () => {
    const { usuario, dialogo } = await abrirDialogo({
      'POST /api/avisos-problema': { estado: 429, cuerpo: { ok: false, codigo: 'validacion', mensaje: 'Mandaste muchos avisos seguidos; probá en un rato.' } },
    });
    await usuario.type(within(dialogo).getByLabelText('¿Qué pasó o qué te falta?'), 'Otra vez');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar' }));
    expect(await within(dialogo).findByText('Mandaste muchos avisos seguidos; probá en un rato.')).toBeInTheDocument();
  });

  it('Escape cierra el diálogo', async () => {
    const { usuario } = await abrirDialogo();
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Avisar un problema' })).not.toBeInTheDocument());
  });
});

describe('El puntito del botón', () => {
  it('aparece solo para receptores con avisos nuevos', async () => {
    prepararEntorno('/inicio');
    simularApi({
      'GET /api/auth/yo': ok(RECEPTOR),
      'GET /api/avisos-problema': ok([aviso(1), aviso(2), aviso(3, { estado: 'visto' })]),
    });
    render(<App />);
    const boton = await screen.findByRole('button', { name: 'Avisar un problema' });
    expect(await within(boton).findByText('2')).toBeInTheDocument();
  });

  it('no aparece, ni se pide nada, para quien no recibe los avisos', async () => {
    prepararEntorno('/inicio');
    const api = simularApi();
    render(<App />);
    const boton = await screen.findByRole('button', { name: 'Avisar un problema' });
    await waitFor(() => expect(api.llamadas.some((l) => l.ruta === '/api/auth/yo')).toBe(true));
    expect(boton.querySelector('.herramientas__punto')).toBeNull();
    expect(api.llamadas.some((l) => l.ruta === '/api/avisos-problema')).toBe(false);
  });

  it('sin avisos nuevos no aparece', async () => {
    prepararEntorno('/inicio');
    const api = simularApi({ 'GET /api/auth/yo': ok(RECEPTOR), 'GET /api/avisos-problema': ok([aviso(3, { estado: 'arreglado' })]) });
    render(<App />);
    const boton = await screen.findByRole('button', { name: 'Avisar un problema' });
    await waitFor(() => expect(api.llamadas.some((l) => l.ruta === '/api/avisos-problema')).toBe(true));
    expect(boton.querySelector('.herramientas__punto')).toBeNull();
  });
});

describe('Problemas avisados', () => {
  it('marca Visto y Arreglado', async () => {
    prepararEntorno('/problemas-avisados');
    let actuales = [aviso(1, { texto: 'Se cuelga la línea', tieneImagen: true })];
    const api = simularApi({
      'GET /api/auth/yo': ok(RECEPTOR),
      'GET /api/avisos-problema': () => ok(actuales),
      'PATCH /api/avisos-problema/1': (cuerpo) => {
        const { estado } = cuerpo as { estado: AvisoProblema['estado'] };
        actuales = [aviso(1, { texto: 'Se cuelga la línea', tieneImagen: true, estado, marcadoPor: 9, marcadoEl: '2026-10-25T13:00:00.000Z' })];
        return ok({ estado });
      },
    });
    render(<App />);
    const usuario = userEvent.setup();
    await screen.findByRole('heading', { level: 1, name: 'Problemas avisados' });
    const fila = (await screen.findByText('Se cuelga la línea')).closest('li')!;
    expect(within(fila).getByRole('img', { name: /captura/i })).toHaveAttribute('src', '/api/avisos-problema/1/imagen');
    await usuario.click(within(fila).getByRole('button', { name: 'Visto' }));
    await waitFor(() => expect(api.llamadas.find((l) => l.metodo === 'PATCH')?.cuerpo).toEqual({ estado: 'visto' }));
    await waitFor(() => expect(within(fila).getByRole('button', { name: 'Visto' })).toBeDisabled());
    await usuario.click(within(fila).getByRole('button', { name: 'Arreglado' }));
    await waitFor(() => expect(api.llamadas.filter((l) => l.metodo === 'PATCH').at(-1)?.cuerpo).toEqual({ estado: 'arreglado' }));
    expect(await within(fila).findByText(/Marcó Ana Pereyra/)).toBeInTheDocument();
  });

  it('quien no recibe los avisos ve el motivo y no se le piden', async () => {
    prepararEntorno('/problemas-avisados');
    const api = simularApi();
    render(<App />);
    expect(await screen.findByText('No recibís los avisos de problemas.')).toBeInTheDocument();
    expect(api.llamadas.some((l) => l.ruta === '/api/avisos-problema')).toBe(false);
  });
});

describe('LimiteDeErrores', () => {
  it('ofrece avisar con el error cargado, sin depender del marco', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = simularApi({ 'GET /api/avisos-problema/mios': ok([]), 'POST /api/avisos-problema': ok({ id: 1 }) });
    function Rompe(): never {
      throw new Error('render roto');
    }
    render(<LimiteDeErrores><Rompe /></LimiteDeErrores>);
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Avisar este problema' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Avisar un problema' });
    expect(within(dialogo).getByText(/render roto/)).toBeInTheDocument();
    await usuario.type(within(dialogo).getByLabelText('¿Qué pasó o qué te falta?'), 'Se rompió');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar' }));
    await within(dialogo).findByText(/Gracias/);
    expect(envioDe(api)?.contexto.error).toContain('render roto');
  });

  it('adjunta el error de su pantalla aunque haya pasado más de 10 minutos o se haya anotado otro después', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = simularApi({ 'GET /api/avisos-problema/mios': ok([]), 'POST /api/avisos-problema': ok({ id: 1 }) });
    function Rompe(): never {
      throw new Error('error de esta pantalla');
    }
    render(<LimiteDeErrores><Rompe /></LimiteDeErrores>);
    // Otro límite anotó otro error después, y el de esta pantalla ya venció para errorReciente().
    anotarError(new Error('error de otra pantalla'));
    olvidarError();
    anotarError(new Error('error de otra pantalla'));
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Avisar este problema' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Avisar un problema' });
    await usuario.type(within(dialogo).getByLabelText('¿Qué pasó o qué te falta?'), 'Se rompió');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Enviar' }));
    await within(dialogo).findByText(/Gracias/);
    expect(envioDe(api)?.contexto.error).toContain('error de esta pantalla');
    expect(envioDe(api)?.contexto.error).not.toContain('otra pantalla');
  });
});

describe('Último error y contexto', () => {
  it('errorReciente olvida lo de hace más de 10 minutos', () => {
    const t0 = new Date('2026-10-25T12:00:00Z');
    anotarError(new TypeError('algo falló'), t0);
    expect(errorReciente(new Date(t0.getTime() + 9 * 60_000))).toBe('TypeError: algo falló');
    expect(errorReciente(new Date(t0.getTime() + 10 * 60_000 + 1))).toBeNull();
  });

  it('acepta cualquier cosa que se haya lanzado y recorta lo largo', () => {
    const t0 = new Date('2026-10-25T12:00:00Z');
    anotarError('texto suelto', t0);
    expect(errorReciente(t0)).toBe('texto suelto');
    anotarError(new Error('x'.repeat(5000)), t0);
    expect((errorReciente(t0) ?? '').length).toBeLessThanOrEqual(1500);
  });

  it('armarContexto toma la ruta dada y el error reciente', () => {
    anotarError(new Error('roto'), new Date('2026-10-25T12:00:00Z'));
    const c = armarContexto({ pathname: '/tareas' }, new Date('2026-10-25T12:01:00Z'));
    expect(c.ruta).toBe('/tareas');
    expect(c.error).toBe('Error: roto');
    expect(c.ventana).toMatch(/^\d+x\d+$/);
    expect(['claro', 'oscuro']).toContain(c.tema);
  });
});
