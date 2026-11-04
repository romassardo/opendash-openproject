import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { cifrar, descifrar } from '../seguridad/cifrado.js';
import { clientePara } from './clientes.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const OTRA_CLAVE = Buffer.alloc(32, 2);

describe('clientePara', () => {
  let db: Database;
  const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const crearCliente = vi.fn((_token: string) => ({}) as ClienteOp);
  const vencido = () => db.prepare('select token_vencido from usuarios where id = 9').pluck().get();
  const guardarToken = (tokenCifrado: string) =>
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (9, 'ana', 'A', 'h', ?, 0, '2026-10-19')")
      .run(tokenCifrado);

  beforeEach(() => {
    db = abrirDb(':memory:');
    crearCliente.mockClear();
    registro.warn.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it('descifra el token y crea el cliente con él', () => {
    guardarToken(cifrar('token-de-ana', config.claveCifrado));
    expect(clientePara({ config, db, crearCliente }, 9)).not.toBeNull();
    expect(crearCliente).toHaveBeenCalledWith('token-de-ana');
  });

  it('un token v1 se vuelve a cifrar como v2 al usarlo', () => {
    guardarToken(cifrar('token-de-ana', config.claveCifrado));
    expect(clientePara({ config, db, crearCliente }, 9)).not.toBeNull();
    const guardado = db.prepare('select token_cifrado from usuarios where id = 9').pluck().get() as string;
    expect(guardado.startsWith('v2.')).toBe(true);
    expect(descifrar(guardado, config.claveCifrado, 'usuario:9')).toBe('token-de-ana');
    crearCliente.mockClear();
    expect(clientePara({ config, db, crearCliente }, 9)).not.toBeNull();
    expect(crearCliente).toHaveBeenCalledWith('token-de-ana');
  });

  it('un token v2 atado a otra persona se marca vencido', () => {
    guardarToken(cifrar('token-de-otra', config.claveCifrado, 'usuario:3'));
    expect(clientePara({ config, db, crearCliente, registro }, 9)).toBeNull();
    expect(vencido()).toBe(1);
  });

  it('si el token no se puede descifrar (cambió la clave), lo marca vencido y no rompe', () => {
    guardarToken(cifrar('token-de-ana', OTRA_CLAVE));
    expect(clientePara({ config, db, crearCliente, registro }, 9)).toBeNull();
    expect(vencido()).toBe(1);
    expect(crearCliente).not.toHaveBeenCalled();
    // El aviso del log no lleva el token.
    expect(registro.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(registro.warn.mock.calls[0])).not.toContain('token-de-ana');
    expect(registro.warn.mock.calls[0]![0]).toMatchObject({ motivo: 'token-no-descifrable', usuarioId: 9 });
  });

  it('un dato cifrado dañado también queda como token vencido', () => {
    guardarToken('no-es-un-dato-cifrado');
    expect(clientePara({ config, db, crearCliente }, 9)).toBeNull();
    expect(vencido()).toBe(1);
  });

  it('sin usuario o con el token ya vencido no crea cliente', () => {
    expect(clientePara({ config, db, crearCliente }, 9)).toBeNull();
    guardarToken(cifrar('t', config.claveCifrado));
    db.prepare('update usuarios set token_vencido = 1 where id = 9').run();
    expect(clientePara({ config, db, crearCliente }, 9)).toBeNull();
    expect(crearCliente).not.toHaveBeenCalled();
  });
});
