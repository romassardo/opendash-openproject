import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.doUnmock('marked');
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('TextoMarkdown cuando no bajan las librerías', () => {
  it('registra el error, deja el texto plano y reintenta la carga al montarse de nuevo', async () => {
    vi.resetModules();
    const registro = vi.spyOn(console, 'error').mockImplementation(() => {});
    // El módulo `marked` falla al importarse, como un chunk que no baja.
    vi.doMock('marked', () => {
      throw new Error('chunk caído');
    });
    const { TextoMarkdown, markdownSeguro } = await import('./texto.js');

    const primera = render(<TextoMarkdown texto={'**negrita**'} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(registro).toHaveBeenCalled();
    expect(primera.container.textContent).toBe('**negrita**');
    expect(primera.container.querySelector('strong')).toBeNull();
    primera.unmount();

    // Vuelve la red: al montar otra vez, la carga se reintenta y el markdown se renderiza.
    vi.doUnmock('marked');
    const segunda = render(<TextoMarkdown texto={'**negrita**'} />);
    await act(() => markdownSeguro(''));
    expect(segunda.container.querySelector('strong')?.textContent).toBe('negrita');
  });
});
