import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registrar } from './registrar.js';
import { useInstalar } from './useInstalar.js';

function eventoDeInstalacion(prompt = vi.fn(async () => undefined), outcome: 'accepted' | 'dismissed' = 'accepted') {
  const evento = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(evento, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { evento, prompt };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.dispatchEvent(new Event('appinstalled'));
});

describe('useInstalar', () => {
  it('disponible tras beforeinstallprompt', async () => {
    const { result } = renderHook(() => useInstalar());
    expect(result.current.disponible).toBe(false);
    act(() => {
      window.dispatchEvent(eventoDeInstalacion().evento);
    });
    expect(result.current.disponible).toBe(true);
  });

  it('no está disponible si la app ya corre en standalone', () => {
    vi.stubGlobal('matchMedia', (consulta: string) => ({ matches: consulta.includes('standalone'), media: consulta }));
    const { result } = renderHook(() => useInstalar());
    act(() => {
      window.dispatchEvent(eventoDeInstalacion().evento);
    });
    expect(result.current.disponible).toBe(false);
  });

  it('instalar llama a prompt() y descarta el evento', async () => {
    const { evento, prompt } = eventoDeInstalacion();
    const { result } = renderHook(() => useInstalar());
    act(() => {
      window.dispatchEvent(evento);
    });
    await act(async () => {
      await result.current.instalar();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current.disponible).toBe(false);
  });

  it('si la persona cierra el diálogo del navegador, «Instalar» sigue disponible', async () => {
    const { evento, prompt } = eventoDeInstalacion(undefined, 'dismissed');
    const { result } = renderHook(() => useInstalar());
    act(() => {
      window.dispatchEvent(evento);
    });
    await act(async () => {
      await result.current.instalar();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current.disponible).toBe(true);
  });
});

describe('registrar', () => {
  it('no tira si serviceWorker no existe', () => {
    vi.stubGlobal('navigator', {});
    expect(() => registrar()).not.toThrow();
  });

  it('registra /sw.js con alcance / e ignora un fallo', async () => {
    const register = vi.fn(async () => {
      throw new Error('sin permiso');
    });
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    expect(() => registrar()).not.toThrow();
    await Promise.resolve();
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });
});
