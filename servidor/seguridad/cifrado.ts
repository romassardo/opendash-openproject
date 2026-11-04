import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION_SIN_AAD = 'v1';
const VERSION_CON_AAD = 'v2';
const LARGO_IV = 12;
const LARGO_TAG = 16;

/**
 * Con `aad` (p. ej. `usuario:7`) el dato queda atado a su dueño: copiado a la fila de otra persona no se descifra.
 * Sin `aad` produce el formato `v1` de siempre.
 */
export function cifrar(texto: string, clave: Buffer, aad?: string): string {
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv('aes-256-gcm', clave, iv);
  if (aad !== undefined) cifrador.setAAD(Buffer.from(aad));
  const datos = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  const version = aad === undefined ? VERSION_SIN_AAD : VERSION_CON_AAD;
  return [version, iv.toString('base64url'), tag.toString('base64url'), datos.toString('base64url')].join('.');
}

/** Acepta `v1` (sin AAD, de antes) y `v2` (exige el mismo `aad` con el que se cifró). */
export function descifrar(blob: string, clave: Buffer, aad?: string): string {
  const partes = blob.split('.');
  const version = partes[0];
  if (partes.length !== 4 || (version !== VERSION_SIN_AAD && version !== VERSION_CON_AAD)) {
    throw new Error('Formato de dato cifrado inválido');
  }
  if (version === VERSION_CON_AAD && aad === undefined) {
    throw new Error('Formato de dato cifrado inválido');
  }
  const [, ivB64, tagB64, datosB64] = partes as [string, string, string, string];
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== LARGO_IV || tag.length !== LARGO_TAG) {
    throw new Error('Formato de dato cifrado inválido');
  }
  const descifrador = createDecipheriv('aes-256-gcm', clave, iv);
  if (version === VERSION_CON_AAD && aad !== undefined) descifrador.setAAD(Buffer.from(aad));
  descifrador.setAuthTag(tag);
  return Buffer.concat([descifrador.update(Buffer.from(datosB64, 'base64url')), descifrador.final()]).toString('utf8');
}
