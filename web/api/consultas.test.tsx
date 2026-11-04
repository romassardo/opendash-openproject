import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cliente from './cliente.js';
import { CLAVES, crearClienteConsultas, intervaloDeRefresco, TOPE_SONDEOS_RAPIDOS, useAjustes, useEquipo, useHoras, useHorasEquipo, useTareas, useYo } from './consultas.js';

vi.mock('./cliente.js', async (original) => ({
  ...(await original<typeof import('./cliente.js')>()),
  pedir: vi.fn(),
  tokenVencido: vi.fn(() => false),
}));

describe('intervaloDeRefresco', () => {
  const base = { vencido: false, cargaLista: true, intentos: 0, normalMs: 30_000 as number | false };

  it('con la carga lista usa el intervalo normal aunque la lista esté vacía', () => {
    expect(intervaloDeRefresco(base)).toBe(30_000);
    expect(intervaloDeRefresco({ ...base, normalMs: false })).toBe(false);
  });

  it('con la carga sin terminar pregunta cada 3 s hasta el tope y después vuelve al normal', () => {
    expect(intervaloDeRefresco({ ...base, cargaLista: false })).toBe(3_000);
    expect(intervaloDeRefresco({ ...base, cargaLista: false, intentos: TOPE_SONDEOS_RAPIDOS - 1 })).toBe(3_000);
    expect(intervaloDeRefresco({ ...base, cargaLista: false, intentos: TOPE_SONDEOS_RAPIDOS })).toBe(30_000);
  });

  it('con el token vencido no se sondea', () => {
    expect(intervaloDeRefresco({ ...base, cargaLista: false, vencido: true })).toBe(false);
    expect(intervaloDeRefresco({ ...base, cargaLista: false, vencido: true, intentos: 99, trasTopeMs: 15_000 })).toBe(false);
  });

  it('pasado el tope, si la carga sigue sin terminar usa el intervalo de espera dado', () => {
    const espera = { ...base, normalMs: false as const, cargaLista: false, trasTopeMs: 15_000 };
    expect(intervaloDeRefresco({ ...espera, intentos: TOPE_SONDEOS_RAPIDOS - 1 })).toBe(3_000);
    expect(intervaloDeRefresco({ ...espera, intentos: TOPE_SONDEOS_RAPIDOS })).toBe(15_000);
    expect(intervaloDeRefresco({ ...espera, cargaLista: true, intentos: TOPE_SONDEOS_RAPIDOS })).toBe(false);
  });
});

describe('useYo: no deja de preguntar mientras la carga inicial no termina', () => {
  const pedir = vi.mocked(cliente.pedir);
  let cargaLista = false;
  const llamadasAYo = () => pedir.mock.calls.filter((c) => c[1] === '/api/auth/yo').length;
  const montar = () => {
    const qc = crearClienteConsultas();
    const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return renderHook(() => useYo(), { wrapper: envoltorio });
  };
  const avanzar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    pedir.mockReset();
    cargaLista = false;
    vi.mocked(cliente.tokenVencido).mockReturnValue(false);
    pedir.mockImplementation((async () => ({ id: 1, login: 'a', nombre: 'A', tema: 'oscuro', fijados: [], cargaInicialLista: cargaLista })) as never);
  });
  afterEach(() => vi.useRealTimers());

  it('pasado el tope de sondeos rápidos sigue preguntando cada 15 s, y deja de hacerlo cuando la carga está lista', async () => {
    montar();
    await avanzar(1);
    // 40 sondeos de 3 s (2 minutos) y un margen.
    await avanzar(130_000);
    const tras = llamadasAYo();
    await avanzar(60_000);
    expect(llamadasAYo() - tras).toBe(4);
    cargaLista = true;
    await avanzar(15_000);
    const lista = llamadasAYo();
    await avanzar(120_000);
    expect(llamadasAYo()).toBe(lista);
  });

  it('con el token vencido no pregunta', async () => {
    vi.mocked(cliente.tokenVencido).mockReturnValue(true);
    montar();
    await avanzar(1);
    await avanzar(300_000);
    expect(llamadasAYo()).toBe(1);
  });
});

describe('useTareas: sondeo mientras la carga inicial no termina', () => {
  const pedir = vi.mocked(cliente.pedir);
  const yo = (cargaInicialLista: boolean) => ({ id: 1, login: 'a', nombre: 'A', tema: 'oscuro', fijados: [], cargaInicialLista });
  const responder = (cargaLista: boolean) =>
    pedir.mockImplementation((async (_metodo: string, ruta: string) =>
      ruta === '/api/tareas' ? { tareas: [], dependencias: [] } : yo(cargaLista)) as never);
  const llamadasA = (ruta: string) => pedir.mock.calls.filter((c) => c[1] === ruta).length;

  const montar = () => {
    const qc = crearClienteConsultas();
    const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return renderHook(() => useTareas(), { wrapper: envoltorio });
  };
  const avanzar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    pedir.mockReset();
    vi.mocked(cliente.tokenVencido).mockReturnValue(false);
    responder(false);
  });
  afterEach(() => vi.useRealTimers());

  it('con la carga sin terminar pregunta cada 3 s y al llegar al tope vuelve al intervalo normal', async () => {
    montar();
    await avanzar(1);
    await avanzar(100_000);
    // Los sondeos rápidos no se gastan antes de tiempo (aunque haya muchos renders): ~33 en 100 s.
    expect(llamadasA('/api/tareas')).toBeGreaterThanOrEqual(30);
    // 40 sondeos de 3 s son 2 minutos; pasado ese tope solo queda el refresco de 30 s.
    await avanzar(180_000);
    const hasta = llamadasA('/api/tareas');
    await avanzar(60_000);
    expect(llamadasA('/api/tareas') - hasta).toBeLessThanOrEqual(2);
  });

  it('al terminar la carga inicial vuelve a pedir las tareas enseguida', async () => {
    let yoListo = false;
    pedir.mockImplementation((async (_metodo: string, ruta: string) =>
      ruta === '/api/tareas' ? { tareas: [], dependencias: [] } : yo(yoListo)) as never);
    montar();
    await avanzar(1);
    const antes = llamadasA('/api/tareas');
    yoListo = true;
    // El próximo sondeo de `yo` (3 s) ve la carga lista y las tareas se piden de nuevo sin esperar los 30 s.
    await avanzar(3_100);
    expect(llamadasA('/api/tareas')).toBeGreaterThan(antes);
    const despues = llamadasA('/api/tareas');
    await avanzar(10_000);
    expect(llamadasA('/api/tareas')).toBe(despues);
  });

  it('con la carga lista y la lista vacía usa el intervalo normal', async () => {
    responder(true);
    montar();
    await avanzar(1);
    await avanzar(29_000);
    expect(llamadasA('/api/tareas')).toBe(1);
    await avanzar(2_000);
    expect(llamadasA('/api/tareas')).toBe(2);
  });

  it('con el token vencido no sondea', async () => {
    vi.mocked(cliente.tokenVencido).mockReturnValue(true);
    montar();
    await avanzar(1);
    await avanzar(120_000);
    expect(llamadasA('/api/tareas')).toBe(1);
  });
});

describe('consultas de 1B', () => {
  const pedir = vi.mocked(cliente.pedir);
  const montar = <T,>(uso: () => T) => {
    const qc = crearClienteConsultas();
    const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return renderHook(uso, { wrapper: envoltorio });
  };

  beforeEach(() => {
    pedir.mockReset();
    pedir.mockResolvedValue([] as never);
    vi.mocked(cliente.tokenVencido).mockReturnValue(false);
  });

  it('cada consulta pide su ruta', async () => {
    await act(async () => { montar(() => [useAjustes(), useEquipo(), useHoras(), useHorasEquipo(7)]); });
    const rutas = pedir.mock.calls.map((c) => `${c[0]} ${c[1]}`);
    expect(rutas).toEqual(expect.arrayContaining(['GET /api/ajustes', 'GET /api/equipo', 'GET /api/horas', 'GET /api/horas/equipo?dias=7']));
  });
});
