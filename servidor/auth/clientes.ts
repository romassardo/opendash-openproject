import type { Database } from 'better-sqlite3';
import type { DepsApp } from '../app.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { REGISTRO_MUDO, type Registro } from '../registro.js';
import { cifrar, descifrar } from '../seguridad/cifrado.js';

type DepsCliente = Pick<DepsApp, 'config' | 'db' | 'crearCliente'> & { registro?: Registro };

/** La app le va a pedir a esta persona un token nuevo. */
export function marcarTokenVencido(db: Database, usuarioId: number): void {
  db.prepare('update usuarios set token_vencido = 1 where id = ?').run(usuarioId);
}

export function clientePara(deps: DepsCliente, usuarioId: number): ClienteOp | null {
  const fila = deps.db
    .prepare('select token_cifrado as tokenCifrado, token_vencido as tokenVencido from usuarios where id = ?')
    .get(usuarioId) as { tokenCifrado: string; tokenVencido: number } | undefined;
  if (fila === undefined || fila.tokenVencido === 1) return null;
  let token: string;
  try {
    const aad = `usuario:${usuarioId}`;
    token = descifrar(fila.tokenCifrado, deps.config.claveCifrado, aad);
    // Un token guardado sin atar a su dueño (v1) se vuelve a cifrar atado a esta persona.
    if (fila.tokenCifrado.startsWith('v1.')) {
      deps.db
        .prepare('update usuarios set token_cifrado = ? where id = ?')
        .run(cifrar(token, deps.config.claveCifrado, aad), usuarioId);
    }
  } catch {
    // Cambió OPENDASH_CLAVE_CIFRADO (o el dato se dañó): se le pide un token nuevo en vez de fallar en cada ruta.
    (deps.registro ?? REGISTRO_MUDO).warn({ motivo: 'token-no-descifrable', usuarioId }, '[auth] no se pudo descifrar el token del usuario: se marca como vencido');
    marcarTokenVencido(deps.db, usuarioId);
    return null;
  }
  return deps.crearCliente(token);
}
