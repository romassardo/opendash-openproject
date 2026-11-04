import { describe, expect, it } from 'vitest';
import { cifrar, descifrar } from './cifrado.js';

describe('cifrado', () => {
  const k = Buffer.alloc(32, 7);

  it('cifra y descifra ida y vuelta', () => {
    const b = cifrar('opapi-123', k);
    expect(b.startsWith('v1.')).toBe(true);
    expect(b).not.toContain('opapi-123');
    expect(descifrar(b, k)).toBe('opapi-123');
  });

  it('dos cifrados del mismo texto son distintos', () => {
    expect(cifrar('x', k)).not.toBe(cifrar('x', k));
  });

  it('descifrar con otra clave falla', () => {
    expect(() => descifrar(cifrar('x', Buffer.alloc(32, 1)), Buffer.alloc(32, 2))).toThrow();
  });

  it('descifrar datos alterados falla', () => {
    const [v, iv, tag, datos] = cifrar('secreto', k).split('.') as [string, string, string, string];
    const buf = Buffer.from(datos, 'base64url');
    buf[0] = (buf[0] ?? 0) ^ 1;
    expect(() => descifrar([v, iv, tag, buf.toString('base64url')].join('.'), k)).toThrow();
  });

  it('un token cifrado para una persona no se descifra en la fila de otra', () => {
    const blob = cifrar('opapi-123', k, 'usuario:1');
    expect(blob.startsWith('v2.')).toBe(true);
    expect(descifrar(blob, k, 'usuario:1')).toBe('opapi-123');
    expect(() => descifrar(blob, k, 'usuario:2')).toThrow();
    expect(() => descifrar(blob, k)).toThrow();
  });

  it('descifrar acepta el formato v1 viejo', () => {
    const viejo = cifrar('opapi-123', k);
    expect(viejo.startsWith('v1.')).toBe(true);
    expect(descifrar(viejo, k, 'usuario:1')).toBe('opapi-123');
  });

  it('rechaza formato inválido', () => {
    expect(() => descifrar('basura', k)).toThrow();
    expect(() => descifrar('v2.a.b.c', k)).toThrow();
  });
});
