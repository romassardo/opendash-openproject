import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHoy } from './hoy.js';

describe('useHoy', () => {
  beforeEach(() => {
    // 23:59:30 argentinas del 21/10 (02:59:30Z del 22/10).
    vi.useFakeTimers({ now: new Date('2026-10-22T02:59:30Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('da el día argentino y pasa al siguiente a los 60 s', () => {
    const { result } = renderHook(() => useHoy());
    expect(result.current).toBe('2026-10-21');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-10-22');
  });

  it('con la hora cambiada sin avanzar el intervalo, visibilitychange lo actualiza', () => {
    const { result } = renderHook(() => useHoy());
    expect(result.current).toBe('2026-10-21');
    act(() => {
      vi.setSystemTime(new Date('2026-10-22T05:00:00Z'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-10-22');
  });

  it('el foco de la ventana también lo actualiza', () => {
    const { result } = renderHook(() => useHoy());
    act(() => {
      vi.setSystemTime(new Date('2026-10-22T05:00:00Z'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe('2026-10-22');
  });

  it('sin suscriptores no deja el intervalo corriendo', () => {
    const { unmount } = renderHook(() => useHoy());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
