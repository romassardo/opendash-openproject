import { describe, expect, it } from 'vitest';
import { hashear, verificar } from './contrasenas.js';

describe('contraseñas', () => {
  it('verifica la contraseña correcta y rechaza otra', async () => {
    const h = await hashear('una-clave-larga');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verificar('una-clave-larga', h)).toBe(true);
    expect(await verificar('otra', h)).toBe(false);
  });

  it('usa sal distinta en cada hash', async () => {
    expect(await hashear('x')).not.toBe(await hashear('x'));
  });

  it('un hash con formato inválido no verifica', async () => {
    expect(await verificar('x', 'basura')).toBe(false);
    expect(await verificar('x', 'scrypt$$')).toBe(false);
  });
});
