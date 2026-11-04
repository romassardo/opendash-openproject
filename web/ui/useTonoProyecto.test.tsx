import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tonoPara } from './tonos.js';
import { useTonoProyecto } from './useTonoProyecto.js';

function envoltorio() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
}

describe('useTonoProyecto', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('usa el color de los ajustes', async () => {
    const datos = { estilos: { 5: { color: 'coral', icono: 'carpeta' } }, metricas: {} };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, datos, desactualizado: false }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const { result } = renderHook(() => useTonoProyecto(), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current(5)).toBe('coral'));
  });

  it('sin ajustes usa tonoPara', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { result } = renderHook(() => useTonoProyecto(), { wrapper: envoltorio() });
    expect(result.current(5)).toBe(tonoPara(5));
  });
});
