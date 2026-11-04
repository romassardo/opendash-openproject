import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Reunion, Yo } from '../../compartido/tipos.js';
import { crearClienteConsultas } from '../api/consultas.js';
import { limpiarEntorno, ok, prepararEntorno, simularApi, YO } from '../../pruebas/fabricas/web.js';
import { VigilanteReuniones } from './VigilanteReuniones.js';
import { usePermisoAvisos } from './usePermisoAvisos.js';

const CLAVE = 'opendash.reuniones.permiso';
const enMinutos = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const reunionProxima = (extra: Partial<Reunion> = {}): Reunion => ({
  id: 'r1', titulo: 'Semanal', lugar: null, inicio: enMinutos(3), fin: enMinutos(60),
  diaEntero: false, libre: false, enlace: 'https://teams.microsoft.com/l/x', plataforma: 'teams', ...extra,
});
const yoCon = (extra: Partial<Yo> = {}): Yo => ({ ...YO, tieneCalendario: true, avisoReunionMin: 5, ...extra });
const calendarioCon = (reuniones: Reunion[]) => ({ 'GET /api/calendario': ok({ reuniones, estado: null, ventana: null }) });

interface Falsa { titulo: string; cerrada: boolean; onclick: (() => void) | null }
const creadas: Falsa[] = [];
let permisoActual = 'granted';
let pedidoRechazado = false;

function instalarNotificacion(): void {
  class NotificacionFalsa {
    static get permission() { return permisoActual; }
    static async requestPermission() {
      if (pedidoRechazado) throw new Error('no');
      permisoActual = 'granted';
      return 'granted';
    }
    titulo: string;
    cerrada = false;
    onclick: (() => void) | null = null;
    constructor(titulo: string) { this.titulo = titulo; creadas.push(this); }
    close(): void { this.cerrada = true; }
  }
  vi.stubGlobal('Notification', NotificacionFalsa);
}

function montar(yo: Yo) {
  const qc = crearClienteConsultas();
  return render(<QueryClientProvider client={qc}><VigilanteReuniones yo={yo} /></QueryClientProvider>);
}

beforeEach(() => {
  creadas.length = 0;
  permisoActual = 'granted';
  pedidoRechazado = false;
  prepararEntorno('/');
  document.title = 'OpenDash';
  instalarNotificacion();
});

afterEach(() => {
  cleanup();
  limpiarEntorno();
  vi.restoreAllMocks();
});

const pedidosDeCalendario = (llamadas: { ruta: string }[]) => llamadas.filter((l) => l.ruta === '/api/calendario').length;
const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('VigilanteReuniones montado', () => {
  it('con avisoReunionMin null no pide el calendario ni muestra nada', async () => {
    const api = simularApi(calendarioCon([reunionProxima()]));
    montar(yoCon({ avisoReunionMin: null }));
    await esperar(50);
    expect(pedidosDeCalendario(api.llamadas)).toBe(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(creadas).toHaveLength(0);
  });

  it('pide el calendario con la cabecera de fondo: no cuenta como actividad', async () => {
    const api = simularApi(calendarioCon([reunionProxima()]));
    montar(yoCon());
    await waitFor(() => expect(pedidosDeCalendario(api.llamadas)).toBeGreaterThan(0));
    const pedidos = api.pedidos.filter((p) => p.ruta === '/api/calendario');
    expect(pedidos.every((p) => p.cabeceras['x-opendash-fondo'] === '1')).toBe(true);
  });

  it('sin calendario de Outlook no lo pide', async () => {
    const api = simularApi(calendarioCon([reunionProxima()]));
    montar(yoCon({ tieneCalendario: false }));
    await esperar(50);
    expect(pedidosDeCalendario(api.llamadas)).toBe(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('avisa de una reunión próxima y el clic en la Notification abre el enlace sin opener', async () => {
    simularApi(calendarioCon([reunionProxima()]));
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    const enfocar = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    montar(yoCon());
    expect(await screen.findByRole('status')).toHaveTextContent('Semanal');
    await waitFor(() => expect(creadas).toHaveLength(1));
    act(() => creadas[0]?.onclick?.());
    expect(enfocar).toHaveBeenCalled();
    expect(abrir).toHaveBeenCalledWith('https://teams.microsoft.com/l/x', '_blank', 'noopener');
    expect(creadas[0]?.cerrada).toBe(true);
  });

  it('si el permiso se da después de que sonó el aviso, la Notification sale entonces', async () => {
    permisoActual = 'default';
    simularApi(calendarioCon([reunionProxima()]));
    montar(yoCon());
    expect(await screen.findByRole('dialog')).toHaveTextContent('¿Te avisamos de las reuniones?');
    expect(creadas).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Permitir' }));
    await waitFor(() => expect(creadas).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('el título de la pestaña no pisa el que puso otra pantalla', async () => {
    simularApi(calendarioCon([reunionProxima()]));
    const { unmount } = montar(yoCon());
    await screen.findByRole('status');
    await waitFor(() => expect(document.title).toMatch(/^🔔 Semanal/));
    document.title = 'Otra pantalla';
    unmount();
    expect(document.title).toBe('Otra pantalla');
  });
});

describe('Pregunta del permiso', () => {
  const montarConPregunta = async () => {
    permisoActual = 'default';
    simularApi(calendarioCon([reunionProxima()]));
    montar(yoCon());
    return screen.findByRole('dialog');
  };

  it('un Escape con el foco fuera del diálogo no lo rechaza ni guarda nada', async () => {
    await montarConPregunta();
    const otro = document.createElement('input');
    document.body.appendChild(otro);
    otro.focus();
    fireEvent.keyDown(otro, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(localStorage.getItem(CLAVE)).toBeNull();
    otro.remove();
  });

  it('un Escape con el foco adentro lo oculta por esta sesión, sin guardar «Ahora no»', async () => {
    const dialogo = await montarConPregunta();
    expect(dialogo.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('«Ahora no» se guarda y la pregunta no vuelve al montar de nuevo', async () => {
    await montarConPregunta();
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(localStorage.getItem(CLAVE)).toBe('ahora-no');
    cleanup();
    montar(yoCon());
    await screen.findByRole('status');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('no usa la posición de las preguntas del cronómetro', async () => {
    const dialogo = await montarConPregunta();
    expect(dialogo).not.toHaveClass('horas-pregunta');
  });
});

describe('usePermisoAvisos', () => {
  it('«Ahora no» queda guardado, deja de preguntar y lo ven los demás', () => {
    permisoActual = 'default';
    const { result } = renderHook(() => usePermisoAvisos());
    const otro = renderHook(() => usePermisoAvisos());
    expect(result.current.preguntar).toBe(true);
    act(() => result.current.ahoraNo());
    expect(localStorage.getItem(CLAVE)).toBe('ahora-no');
    expect(result.current.preguntar).toBe(false);
    expect(result.current.rechazado).toBe(true);
    expect(otro.result.current.preguntar).toBe(false);
  });

  it('con «Ahora no» guardado de antes, no pregunta al montar', () => {
    permisoActual = 'default';
    localStorage.setItem(CLAVE, 'ahora-no');
    const { result } = renderHook(() => usePermisoAvisos());
    expect(result.current.preguntar).toBe(false);
  });

  it('pedir borra el «Ahora no» y actualiza el estado', async () => {
    permisoActual = 'default';
    localStorage.setItem(CLAVE, 'ahora-no');
    const { result } = renderHook(() => usePermisoAvisos());
    expect(result.current.rechazado).toBe(true);
    await act(async () => { await result.current.pedir(); });
    expect(localStorage.getItem(CLAVE)).toBeNull();
    expect(result.current.estado).toBe('granted');
  });

  it('tolera que el navegador rechace el pedido', async () => {
    permisoActual = 'default';
    pedidoRechazado = true;
    const { result } = renderHook(() => usePermisoAvisos());
    await act(async () => { await result.current.pedir(); });
    expect(result.current.estado).toBe('default');
  });

  it('sin Notification da «no-disponible»', () => {
    vi.stubGlobal('Notification', undefined);
    const { result } = renderHook(() => usePermisoAvisos());
    expect(result.current.estado).toBe('no-disponible');
    expect(result.current.preguntar).toBe(false);
  });
});
