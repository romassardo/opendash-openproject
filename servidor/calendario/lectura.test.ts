import { describe, expect, it, vi } from 'vitest';
import { HOSTS_OUTLOOK, enlacePermitido, leerCalendario } from './lectura.js';

const URL_OK = 'https://outlook.office365.com/owa/calendar/a/b/reachcalendar.ics';
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

describe('enlacePermitido', () => {
  it('acepta https de los hosts de Outlook', () => {
    expect(HOSTS_OUTLOOK).toEqual(['outlook.office365.com', 'outlook.office.com', 'outlook.live.com']);
    expect(enlacePermitido(URL_OK, [])).toBe(true);
    expect(enlacePermitido('https://outlook.live.com/x.ics', [])).toBe(true);
  });
  it('rechaza http, otros dominios y direcciones internas', () => {
    expect(enlacePermitido(URL_OK.replace('https', 'http'), [])).toBe(false);
    expect(enlacePermitido('https://outlook.office365.com.otro.com/x.ics', [])).toBe(false);
    expect(enlacePermitido('https://otro-outlook.office365.com/x.ics', [])).toBe(false);
    expect(enlacePermitido('https://192.0.2.10/x.ics', [])).toBe(false);
    expect(enlacePermitido('https://u:p@outlook.office.com/x.ics', [])).toBe(false);
    expect(enlacePermitido('https://outlook.office.com:8443/x.ics', [])).toBe(false);
    expect(enlacePermitido('https://outlook.office.com./x.ics', [])).toBe(false);
    expect(enlacePermitido('no es una url', [])).toBe(false);
  });
  it('los orígenes de prueba admiten http, exactos y sin credenciales', () => {
    const origenes = ['http://127.0.0.1:5198'];
    expect(enlacePermitido('http://127.0.0.1:5198/c.ics', [])).toBe(false);
    expect(enlacePermitido('http://127.0.0.1:5198/c.ics', origenes)).toBe(true);
    expect(enlacePermitido('http://127.0.0.1:5199/c.ics', origenes)).toBe(false);
    expect(enlacePermitido('http://u:p@127.0.0.1:5198/c.ics', origenes)).toBe(false);
  });
});

describe('leerCalendario', () => {
  const opciones = (fetch: typeof globalThis.fetch, extra = {}) => ({ origenesPrueba: [], fetch, ...extra });

  it('devuelve el texto de un calendario', async () => {
    const f = vi.fn(async () => new Response(ICS, { status: 200 }));
    expect(await leerCalendario(URL_OK, opciones(f))).toEqual({ ok: true, texto: ICS });
  });
  it('acepta BOM y espacios antes de BEGIN:VCALENDAR', async () => {
    const f = vi.fn(async () => new Response(`﻿  \r\n${ICS}`, { status: 200 }));
    expect((await leerCalendario(URL_OK, opciones(f))).ok).toBe(true);
  });
  it('un enlace no permitido no se pide', async () => {
    const f = vi.fn(async () => new Response(ICS));
    const r = await leerCalendario('https://ejemplo.com/x.ics', opciones(f));
    expect(r).toMatchObject({ ok: false, falla: 'enlace-caido' });
    expect(f).not.toHaveBeenCalled();
  });
  it('un 302 de Outlook es enlace-caido y no se sigue', async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://interno.local/' } }));
    const r = await leerCalendario(URL_OK, opciones(f));
    expect(r).toMatchObject({ ok: false, falla: 'enlace-caido' });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
  });
  it.each([401, 403, 404, 410])('un %i es enlace-caido', async (status) => {
    const f = vi.fn(async () => new Response('x', { status }));
    expect(await leerCalendario(URL_OK, opciones(f))).toMatchObject({ ok: false, falla: 'enlace-caido' });
  });
  it.each([500, 503, 429])('un %i es sin-conexion', async (status) => {
    const f = vi.fn(async () => new Response('x', { status }));
    expect(await leerCalendario(URL_OK, opciones(f))).toMatchObject({ ok: false, falla: 'sin-conexion' });
  });
  it.each([302, 404, 500])('un %i cancela el cuerpo de la respuesta', async (status) => {
    let cancelado = false;
    const cuerpo = new ReadableStream<Uint8Array>({ cancel() { cancelado = true; } });
    const f = vi.fn(async () => new Response(cuerpo, { status }));
    expect((await leerCalendario(URL_OK, opciones(f))).ok).toBe(false);
    expect(cancelado).toBe(true);
  });
  it('una respuesta que no es un calendario es enlace-caido', async () => {
    const f = vi.fn(async () => new Response('<html>iniciá sesión</html>', { status: 200 }));
    expect(await leerCalendario(URL_OK, opciones(f))).toMatchObject({ ok: false, falla: 'enlace-caido' });
  });
  it('más de 5 MB corta la lectura mientras llega, sin esperar el final', async () => {
    let cancelado = false;
    const cuerpo = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(50).fill(65)); },
      cancel() { cancelado = true; },
    });
    const f = vi.fn(async () => new Response(cuerpo, { status: 200 }));
    const r = await leerCalendario(URL_OK, opciones(f, { maxBytes: 120 }));
    expect(r).toMatchObject({ ok: false, falla: 'enlace-caido' });
    expect(cancelado).toBe(true);
  });
  it('un Content-Length mayor al tope ni siquiera lee el cuerpo', async () => {
    const f = vi.fn(async () => new Response(ICS, { status: 200, headers: { 'content-length': '999999' } }));
    expect(await leerCalendario(URL_OK, opciones(f, { maxBytes: 1000 }))).toMatchObject({ ok: false, falla: 'enlace-caido' });
  });
  it('una caída de red es sin-conexion', async () => {
    const f = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await leerCalendario(URL_OK, opciones(f))).toMatchObject({ ok: false, falla: 'sin-conexion' });
  });
  it('más de 10 s (el tiempo configurado) es sin-conexion', async () => {
    const f = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal?.reason));
    }));
    const r = await leerCalendario(URL_OK, opciones(f as unknown as typeof fetch, { tiempoMs: 20 }));
    expect(r).toMatchObject({ ok: false, falla: 'sin-conexion' });
  });
  it('el motivo no lleva el enlace', async () => {
    const f = vi.fn(async () => { throw new Error(`fallo en ${URL_OK}`); });
    const r = await leerCalendario(URL_OK, opciones(f));
    expect(JSON.stringify(r)).not.toContain('reachcalendar');
  });
});
