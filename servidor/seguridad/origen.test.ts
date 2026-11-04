import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registrarChequeoOrigen } from './origen.js';

describe('chequeo de origen', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = Fastify({ logger: false });
    registrarChequeoOrigen(app);
    app.post('/api/x', async () => ({ ok: true }));
    app.get('/api/x', async () => ({ ok: true }));
    app.post('/otra', async () => ({ ok: true }));
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const post = (headers: Record<string, string>, url = '/api/x') =>
    app.inject({ method: 'POST', url, headers: { host: 'opendash.test', ...headers }, payload: {} });

  it('un POST con Origin de otro sitio responde 403', async () => {
    const r = await post({ origin: 'http://malo.example' });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ ok: false, codigo: 'prohibido', mensaje: 'La solicitud viene de otro sitio' });
  });

  it('un POST del mismo origen pasa', async () => {
    expect((await post({ origin: 'http://opendash.test' })).statusCode).toBe(200);
  });

  it('un POST con un Origin ilegible responde 403', async () => {
    expect((await post({ origin: 'null' })).statusCode).toBe(403);
  });

  it('un POST sin Origin con Sec-Fetch-Site cross-site responde 403', async () => {
    expect((await post({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
  });

  it('un POST sin Origin ni Sec-Fetch-Site pasa (curl, pruebas)', async () => {
    expect((await post({})).statusCode).toBe(200);
  });

  it('un GET con Origin de otro sitio no se bloquea', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/x', headers: { host: 'opendash.test', origin: 'http://malo.example' } });
    expect(r.statusCode).toBe(200);
  });

  it('una ruta de la API escrita con %61 en vez de la a también se chequea', async () => {
    expect((await post({ origin: 'http://malo.example' }, '/%61pi/x')).statusCode).toBe(403);
  });

  it('fuera de /api/ no se chequea', async () => {
    expect((await post({ origin: 'http://malo.example' }, '/otra')).statusCode).toBe(200);
  });
});
