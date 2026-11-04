import { describe, expect, it } from 'vitest';
import { textoArchivoGrande, textoMb } from './adjuntos.js';

const MB = 1024 * 1024;

describe('textoMb', () => {
  it('debajo de 1 MB muestra KB redondeado hacia arriba, con mínimo 1 KB', () => {
    expect(textoMb(0)).toBe('1 KB');
    expect(textoMb(1)).toBe('1 KB');
    expect(textoMb(1024)).toBe('1 KB');
    expect(textoMb(1025)).toBe('2 KB');
    expect(textoMb(2048)).toBe('2 KB');
    expect(textoMb(MB - 1)).toBe('1024 KB');
  });

  it('desde 1 MB muestra MB con una décima, hacia arriba', () => {
    expect(textoMb(MB)).toBe('1 MB');
    expect(textoMb(5 * MB)).toBe('5 MB');
    expect(textoMb(4.25 * MB)).toBe('4,3 MB');
    expect(textoMb(7 * MB)).toBe('7 MB');
  });

  it('el texto del archivo grande no cambia', () => {
    expect(textoArchivoGrande('x.zip', 7 * MB, 5 * MB)).toBe('“x.zip” pesa 7 MB y el máximo es 5 MB');
  });
});
