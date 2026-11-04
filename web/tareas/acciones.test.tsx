import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { CLAVES, type ListaTareas } from '../api/consultas.js';
import { CATALOGO, limpiarEntorno, TAREAS } from '../../pruebas/fabricas/web.js';
import { useMoverTarea } from './acciones.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const respuestaFalla = () => new Response(
  JSON.stringify({ ok: false, codigo: 'transicion-no-permitida', mensaje: 'Estado no es válido' }),
  { status: 422, headers: { 'content-type': 'application/json' } },
);

describe('useMoverTarea: rollback', () => {
  // El POST de mover queda retenido hasta soltarlo a mano.
  function prepararMovimiento() {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tarea = { ...TAREAS[0]!, id: 5, lockVersion: 4, estadoId: 1, actualizada: '2026-10-19T10:00:00.000Z' };
    cliente.setQueryData<ListaTareas>(CLAVES.tareas, { tareas: [tarea], dependencias: [] });
    let soltar: () => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((listo) => { soltar = () => listo(respuestaFalla()); })));
    const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useMoverTarea(() => {}), { wrapper: envoltorio });
    const tareaEn = () => cliente.getQueryData<ListaTareas>(CLAVES.tareas)!.tareas[0]!;
    return { cliente, tarea, result, tareaEn, soltar: () => soltar() };
  }

  it('un movimiento fallido devuelve la tarea a su lugar', async () => {
    const { tarea, result, tareaEn, soltar } = prepararMovimiento();
    let movimiento!: Promise<unknown>;
    await act(async () => { movimiento = result.current(tarea, 'curso', CATALOGO); });
    expect(tareaEn().estadoId).not.toBe(tarea.estadoId);
    await act(async () => { soltar(); await movimiento; });
    expect(tareaEn()).toEqual(tarea);
  });

  it('el rollback de un movimiento fallido no pisa una versión más nueva de la tarea', async () => {
    const { cliente, tarea, result, tareaEn, soltar } = prepararMovimiento();
    let movimiento!: Promise<unknown>;
    await act(async () => { movimiento = result.current(tarea, 'curso', CATALOGO); });
    // Antes de que falle, la caché recibe una versión más nueva (por ejemplo, de otra escritura).
    const nueva = { ...tarea, lockVersion: 9, titulo: 'Título nuevo', actualizada: '2026-10-19T11:00:00.000Z' };
    cliente.setQueryData<ListaTareas>(CLAVES.tareas, { tareas: [nueva], dependencias: [] });
    await act(async () => { soltar(); await movimiento; });
    expect(tareaEn().lockVersion).toBe(9);
    expect(tareaEn().titulo).toBe('Título nuevo');
    expect(cliente.getQueryState(CLAVES.tareas)?.isInvalidated).toBe(true);
  });
});

describe('useMoverTarea: versión cerrada', () => {
  const version = (estado: 'cerrada' | 'bloqueada' | 'abierta') =>
    ({ id: 3, nombre: 'Finalizado', proyectoId: 11, estado, inicio: null, fin: null });
  const mover = async (estado: 'cerrada' | 'bloqueada' | 'abierta', columna: 'cerrado' | 'curso', codigo = 'validacion', atributos: string[] = ['version']) => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tarea = { ...TAREAS[0]!, id: 5, proyectoId: 11, estadoId: 1 };
    cliente.setQueryData<ListaTareas>(CLAVES.tareas, { tareas: [tarea], dependencias: [] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: false, codigo, mensaje: 'Versión no es válida', atributos }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    )));
    const mensajes: string[] = [];
    const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useMoverTarea((m) => mensajes.push(m)), { wrapper: envoltorio });
    await act(async () => { await result.current(tarea, columna, { ...CATALOGO, versiones: [version(estado)] }); });
    return mensajes;
  };

  it('mover a Cerrado con «Finalizado» cerrada muestra el texto fijo', async () => {
    expect(await mover('cerrada', 'cerrado')).toEqual(['La versión «Finalizado» está cerrada en este proyecto: abrila en Versiones']);
  });

  it('con la versión bloqueada lo dice igual', async () => {
    expect(await mover('bloqueada', 'cerrado')).toEqual(['La versión «Finalizado» está bloqueada en este proyecto: abrila en Versiones']);
  });

  it('con la versión abierta o en una columna sin versión deja el mensaje del servidor', async () => {
    expect(await mover('abierta', 'cerrado')).toEqual(['Versión no es válida']);
    expect(await mover('cerrada', 'curso')).toEqual(['Versión no es válida']);
  });

  it('un 422 que no es del campo versión muestra su motivo real, aunque la versión esté cerrada', async () => {
    expect(await mover('cerrada', 'cerrado', 'validacion', ['dueDate'])).toEqual(['Versión no es válida']);
    expect(await mover('cerrada', 'cerrado', 'validacion', [])).toEqual(['Versión no es válida']);
  });

  it('un error que no es de validación no se disfraza', async () => {
    expect(await mover('cerrada', 'cerrado', 'conflicto')).not.toEqual(['La versión «Finalizado» está cerrada en este proyecto: abrila en Versiones']);
  });
});

describe('useMoverTarea: rechazo 422', () => {
  it('vuelve a pedir el catálogo para que el próximo intento use el estado de versiones al día', async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tarea = { ...TAREAS[0]!, id: 5, proyectoId: 11, estadoId: 1 };
    cliente.setQueryData<ListaTareas>(CLAVES.tareas, { tareas: [tarea], dependencias: [] });
    cliente.setQueryData(CLAVES.catalogo, CATALOGO);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: false, codigo: 'validacion', mensaje: 'Versión no es válida' }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    )));
    const envoltorio = ({ children }: { children: ReactNode }) => <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useMoverTarea(() => {}), { wrapper: envoltorio });
    await act(async () => { await result.current(tarea, 'cerrado', CATALOGO); });
    expect(cliente.getQueryState(CLAVES.catalogo)?.isInvalidated).toBe(true);
  });
});
