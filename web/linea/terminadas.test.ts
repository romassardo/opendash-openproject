import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTerminadasVisibles } from './terminadas.js';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useTerminadasVisibles', () => {
  it('recuerda las franjas abiertas en el navegador', () => {
    const primero = renderHook(() => useTerminadasVisibles());
    expect(primero.result.current.terminadasVisibles.size).toBe(0);
    act(() => primero.result.current.alternar('persona-9'));
    expect(primero.result.current.terminadasVisibles.has('persona-9')).toBe(true);
    primero.unmount();
    const segundo = renderHook(() => useTerminadasVisibles());
    expect(segundo.result.current.terminadasVisibles.has('persona-9')).toBe(true);
    act(() => segundo.result.current.alternar('persona-9'));
    expect(segundo.result.current.terminadasVisibles.has('persona-9')).toBe(false);
  });

  it('con el almacenamiento roto arranca todo plegado y no rompe', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('roto'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('roto'); });
    const { result } = renderHook(() => useTerminadasVisibles());
    expect(result.current.terminadasVisibles.size).toBe(0);
    act(() => result.current.alternar('todas'));
    expect(result.current.terminadasVisibles.has('todas')).toBe(true);
  });
});
