export type TipoImagen = 'image/png' | 'image/jpeg' | 'image/webp';

export const MAX_BYTES_IMAGEN = 3 * 1024 * 1024;

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const empieza = (bytes: Buffer, firma: number[], desde = 0): boolean => firma.every((b, i) => bytes[desde + i] === b);

/** El tipo real de la imagen según sus primeros bytes, o `null` si no es png, jpg ni webp. Lo que diga el cliente no cuenta. */
export function tipoPorBytes(bytes: Buffer): TipoImagen | null {
  if (empieza(bytes, FIRMA_PNG)) return 'image/png';
  if (empieza(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // WebP: «RIFF» + tamaño de 4 bytes + «WEBP».
  if (empieza(bytes, [0x52, 0x49, 0x46, 0x46]) && empieza(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}
