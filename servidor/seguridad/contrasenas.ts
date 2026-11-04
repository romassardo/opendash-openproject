import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PARAMETROS = { N: 16384, r: 8, p: 1 } as const;
const LARGO_CLAVE = 64;
const LARGO_SAL = 16;

function derivar(contrasena: string, sal: Buffer): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(contrasena, sal, LARGO_CLAVE, PARAMETROS, (error, clave) => {
      if (error) rechazar(error);
      else resolver(clave);
    });
  });
}

export async function hashear(contrasena: string): Promise<string> {
  const sal = randomBytes(LARGO_SAL);
  const clave = await derivar(contrasena, sal);
  return `scrypt$${sal.toString('base64')}$${clave.toString('base64')}`;
}

export async function verificar(contrasena: string, hash: string): Promise<boolean> {
  const partes = hash.split('$');
  if (partes.length !== 3 || partes[0] !== 'scrypt') return false;
  const sal = Buffer.from(partes[1] ?? '', 'base64');
  const esperado = Buffer.from(partes[2] ?? '', 'base64');
  if (sal.length === 0 || esperado.length !== LARGO_CLAVE) return false;
  const obtenido = await derivar(contrasena, sal);
  return timingSafeEqual(obtenido, esperado);
}
