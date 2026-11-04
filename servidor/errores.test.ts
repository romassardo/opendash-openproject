import type { Database } from 'better-sqlite3';
import type { FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirDb } from './db/conexion.js';
import { aRespuestaError, MSG_TOKEN_VENCIDO, responderError, responderTokenVencido } from './errores.js';
import { ErrorOp } from './openproject/errores.js';

function respuestaFalsa() {
  const res = { code: vi.fn(), send: vi.fn() };
  res.code.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res;
}

describe('errores compartidos', () => {
  let db: Database;
  const ctx = () => ({ db, usuarioId: 9 });
  const vencido = () => db.prepare('select token_vencido from usuarios where id = 9').pluck().get();

  beforeEach(() => {
    db = abrirDb(':memory:');
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, token_vencido, creado) values (9, 'a', 'A', 'h', 't', 0, '2026-10-19')").run();
  });
  afterEach(() => db.close());

  it('responderTokenVencido responde 401 token-vencido con el mensaje único', () => {
    const res = respuestaFalsa();
    responderTokenVencido(res as unknown as FastifyReply);
    expect(res.code).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({ ok: false, codigo: 'token-vencido', mensaje: MSG_TOKEN_VENCIDO });
    expect(MSG_TOKEN_VENCIDO).toBe('Tu token de OpenProject venció, cargá uno nuevo');
  });

  it('aRespuestaError marca el token vencido ante no-autorizado', () => {
    const r = aRespuestaError(new ErrorOp('no-autorizado', 'x'), ctx());
    expect(r).toEqual({ estado: 401, cuerpo: { ok: false, codigo: 'token-vencido', mensaje: MSG_TOKEN_VENCIDO } });
    expect(vencido()).toBe(1);
  });

  it.each([
    ['prohibido', 403, 'prohibido'],
    ['no-encontrado', 404, 'no-encontrado'],
    ['conflicto', 409, 'conflicto'],
    ['validacion', 422, 'validacion'],
    ['red', 503, 'sin-conexion'],
  ] as const)('%s -> %i %s', (tipo, estado, codigo) => {
    expect(aRespuestaError(new ErrorOp(tipo, 'msg'), ctx())).toMatchObject({ estado, cuerpo: { ok: false, codigo } });
    expect(vencido()).toBe(0);
  });

  it('validacion conserva el mensaje de OpenProject', () => {
    expect(aRespuestaError(new ErrorOp('validacion', 'Título no puede estar vacío'), ctx()).cuerpo).toMatchObject({ mensaje: 'Título no puede estar vacío' });
  });

  it('red dice «Sin conexión con OpenProject»', () => {
    expect(aRespuestaError(new ErrorOp('red', 'x'), ctx()).cuerpo).toMatchObject({ mensaje: 'Sin conexión con OpenProject' });
  });

  it('relanza lo que no es ErrorOp', () => {
    expect(() => aRespuestaError(new Error('raro'), ctx())).toThrow('raro');
  });

  it('responderError envía el estado y el sobre de aRespuestaError', () => {
    const res = respuestaFalsa();
    responderError(res as unknown as FastifyReply, new ErrorOp('conflicto', 'x'), ctx());
    expect(res.code).toHaveBeenCalledWith(409);
    expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ ok: false, codigo: 'conflicto' }));
  });
});
