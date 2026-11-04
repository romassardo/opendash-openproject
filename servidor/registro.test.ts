import { describe, expect, it } from 'vitest';
import { crearRegistro, REGISTRO_MUDO } from './registro.js';

describe('registro', () => {
  it('el registro mudo acepta avisos y no devuelve nada', () => {
    expect(REGISTRO_MUDO.info({ motivo: 'x' }, 'a')).toBeUndefined();
    expect(REGISTRO_MUDO.warn({ motivo: 'x' }, 'a')).toBeUndefined();
    expect(REGISTRO_MUDO.error({ motivo: 'x' }, 'a')).toBeUndefined();
  });

  it('crearRegistro usa nivel info en producción y warn en desarrollo', () => {
    expect(crearRegistro(true).level).toBe('info');
    expect(crearRegistro(false).level).toBe('warn');
  });
});
