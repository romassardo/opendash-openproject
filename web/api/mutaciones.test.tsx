import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoHoras, Yo } from '../../compartido/tipos.js';
import * as cliente from './cliente.js';
import { CLAVES, crearClienteConsultas } from './consultas.js';
import { useAccionesHoras, useAgregarFeriado, useFijarProyecto, useGuardarCalendario, useGuardarTablero, useQuitarFeriado, quitarTareaDeLaCache } from './mutaciones.js';

vi.mock('./cliente.js', async (original) => ({
  ...(await original<typeof import('./cliente.js')>()),
  pedir: vi.fn(),
  tokenVencido: vi.fn(() => false),
}));

const YO: Yo = {
  id: 9, login: 'apereyra', nombre: 'Ana', tema: 'oscuro', fijados: [11], cargaInicialLista: true,
  rol: '', capacidadHoras: 40, variasALaVez: false, recibeAvisos: false, avisoReunionMin: 5, tieneCalendario: false, calendario: null,
};
const ESTADO: EstadoHoras = { enMarcha: [], hoy: [], avisos: [], totalHoySegundos: 0, jornadaSegundos: 28800, variasALaVez: false, horasExtra: false, ultimoDia: null };

let qc: ReturnType<typeof crearClienteConsultas>;
const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = crearClienteConsultas();
  vi.mocked(cliente.pedir).mockReset();
});
afterEach(() => qc.clear());

describe('useFijarProyecto', () => {
  it('fijar un proyecto actualiza yo al instante y revierte si falla', async () => {
    qc.setQueryData(CLAVES.yo, YO);
    let rechazar: (e: Error) => void = () => {};
    vi.mocked(cliente.pedir).mockImplementation(() => new Promise((_, no) => { rechazar = no; }));
    const { result } = renderHook(() => useFijarProyecto(), { wrapper: envoltorio });

    let promesa: Promise<unknown> = Promise.resolve();
    act(() => { promesa = result.current.mutateAsync({ proyectoId: 12, fijado: true }).catch(() => {}); });
    // Antes de que responda el servidor ya figura fijado.
    await waitFor(() => expect((qc.getQueryData(CLAVES.yo) as Yo).fijados).toEqual([11, 12]));
    expect(cliente.pedir).toHaveBeenCalledWith('PUT', '/api/cuenta/fijados', { proyectoId: 12, fijado: true });

    await act(async () => { rechazar(new Error('falló')); await promesa; });
    expect((qc.getQueryData(CLAVES.yo) as Yo).fijados).toEqual([11]);
  });

  it('desfijar quita el proyecto al instante', async () => {
    qc.setQueryData(CLAVES.yo, YO);
    vi.mocked(cliente.pedir).mockResolvedValue({ fijados: [] });
    const { result } = renderHook(() => useFijarProyecto(), { wrapper: envoltorio });
    await act(async () => { await result.current.mutateAsync({ proyectoId: 11, fijado: false }); });
    expect((qc.getQueryData(CLAVES.yo) as Yo).fijados).toEqual([]);
  });
});

describe('useAccionesHoras', () => {
  it('trabajar manda la tarea y vuelve a pedir las horas', async () => {
    vi.mocked(cliente.pedir).mockResolvedValue({});
    const invalidar = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useAccionesHoras(), { wrapper: envoltorio });
    await act(async () => { await result.current.trabajar(4); });
    expect(cliente.pedir).toHaveBeenCalledWith('POST', '/api/horas', { tareaId: 4 });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVES.horas });
  });

  it('cada acción llama a su ruta', async () => {
    vi.mocked(cliente.pedir).mockResolvedValue({});
    const { result } = renderHook(() => useAccionesHoras(), { wrapper: envoltorio });
    const llama = async (accion: () => Promise<void>, ...esperado: unknown[]) => {
      await act(async () => { await accion(); });
      expect(cliente.pedir).toHaveBeenLastCalledWith(...esperado);
    };
    await llama(() => result.current.pausar(3), 'POST', '/api/horas/3/pausa');
    await llama(() => result.current.seguir(3), 'POST', '/api/horas/3/seguir');
    await llama(() => result.current.terminar(3), 'POST', '/api/horas/3/terminar');
    await llama(() => result.current.corregir(3, 600), 'PATCH', '/api/horas/3', { segundos: 600 });
    await llama(() => result.current.pasar(3, 8), 'PATCH', '/api/horas/3', { tareaId: 8 });
    await llama(() => result.current.descartar(3), 'POST', '/api/horas/3/descartar');
    await llama(() => result.current.reintentar(3), 'POST', '/api/horas/3/reintentar');
    await llama(() => result.current.vistoAviso(3), 'POST', '/api/horas/3/aviso-visto');
  });

  it('la inactividad manda la hora y deja el estado devuelto', async () => {
    vi.mocked(cliente.pedir).mockResolvedValue(ESTADO);
    const { result } = renderHook(() => useAccionesHoras(), { wrapper: envoltorio });
    await act(async () => { await result.current.inactividad('2026-10-19T15:40:00Z', false); });
    expect(cliente.pedir).toHaveBeenCalledWith('POST', '/api/horas/inactividad', { desde: '2026-10-19T15:40:00Z', seguia: false });
  });
});

describe('useGuardarTablero', () => {
  it('guardar el mapeo invalida el catálogo y las tareas', async () => {
    vi.mocked(cliente.pedir).mockResolvedValue({});
    const invalidar = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useGuardarTablero(), { wrapper: envoltorio });
    const mapeo = { nuevo: 1, curso: 7, pausa: 4, cerrado: 12 };
    await act(async () => { await result.current.mutateAsync(mapeo); });
    expect(cliente.pedir).toHaveBeenCalledWith('PUT', '/api/ajustes/tablero', mapeo);
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVES.catalogo });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVES.tareas });
  });
});

describe('feriados y calendario', () => {
  const LISTA = { feriados: [], actualizado: null };

  it.each([
    ['agregar un feriado', () => useAgregarFeriado(), { fecha: '2026-12-08', nombre: 'Inmaculada' }, LISTA],
    ['quitar un feriado', () => useQuitarFeriado(), '2026-12-08', LISTA],
    ['guardar el calendario', () => useGuardarCalendario(), { url: null }, { tieneCalendario: false, calendario: null }],
  ])('%s vuelve a pedir el equipo', async (_nombre, usar, datos, respuesta) => {
    vi.mocked(cliente.pedir).mockResolvedValue(respuesta);
    const invalidar = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => usar() as { mutateAsync: (d: unknown) => Promise<unknown> }, { wrapper: envoltorio });
    await act(async () => { await result.current.mutateAsync(datos); });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CLAVES.equipo });
  });
});

describe('quitarTareaDeLaCache', () => {
  it('recarga las horas y el detalle de las sucesoras de lo que se borró, no el de lo borrado', () => {
    qc.setQueryData(CLAVES.tareas, {
      tareas: [{ id: 8, madreId: null }, { id: 21, madreId: 8 }, { id: 2, madreId: null }, { id: 5, madreId: null }],
      dependencias: [
        { id: 51, sucesoraId: 2, predecesoraId: 8, lag: 0 },
        { id: 53, sucesoraId: 5, predecesoraId: 21, lag: 0 },
        { id: 54, sucesoraId: 21, predecesoraId: 8, lag: 0 },
      ],
    });
    const invalidar = vi.spyOn(qc, 'invalidateQueries');
    quitarTareaDeLaCache(qc, 8);
    const claves = invalidar.mock.calls.map(([filtro]) => filtro?.queryKey);
    expect(claves).toContainEqual(CLAVES.horas);
    expect(claves).toContainEqual(CLAVES.tarea(2));
    expect(claves).toContainEqual(CLAVES.tarea(5));
    expect(claves).not.toContainEqual(CLAVES.tarea(8));
    expect(claves).not.toContainEqual(CLAVES.tarea(21));
  });
});
