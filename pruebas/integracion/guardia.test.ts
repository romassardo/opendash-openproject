// La guardia que impide hablar con un OpenProject que no sea el Docker local (no necesita el contenedor).
import { describe, expect, it } from 'vitest';
import { api, asegurarLocal, esperarOp } from '../../scripts/op-prueba.js';

describe('guardia de URL local', () => {
  it('acepta localhost y 127.0.0.1 con puerto', () => {
    expect(() => asegurarLocal('http://localhost:8090')).not.toThrow();
    expect(() => asegurarLocal('http://127.0.0.1:8090')).not.toThrow();
  });

  it('rechaza el OpenProject real y variantes engañosas', () => {
    for (const url of ['http://192.0.2.10:8080', 'https://localhost:8090', 'http://localhost', 'http://localhost:8090.evil.com', 'http://evil.com/http://localhost:8090']) {
      expect(() => asegurarLocal(url), url).toThrow(/Docker local/);
    }
  });

  it('api() y esperarOp() lanzan antes de enviar nada', async () => {
    await expect(api('http://192.0.2.10:8080', 'secreto', 'GET', '/api/v3/users/me')).rejects.toThrow(/Docker local/);
    await expect(esperarOp('http://192.0.2.10:8080', 1000)).rejects.toThrow(/Docker local/);
  });
});
