import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi, EVENTO_TOKEN_VENCIDO, hayDesactualizados, pedir, subirArchivo, tokenVencido } from './cliente.js';
import { falla, limpiarEntorno, ok, simularApi } from '../../pruebas/fabricas/web.js';

afterEach(limpiarEntorno);

describe('pedir', () => {
  it('devuelve los datos del sobre y manda JSON', async () => {
    const api = simularApi({ 'POST /api/eco': (cuerpo) => ok({ recibido: cuerpo }) });
    await expect(pedir('POST', '/api/eco', { a: 1 })).resolves.toEqual({ recibido: { a: 1 } });
    expect(api.llamadas).toEqual([{ metodo: 'POST', ruta: '/api/eco', cuerpo: { a: 1 } }]);
  });

  it('sin cuerpo no declara JSON (Fastify rechaza un JSON vacío)', async () => {
    simularApi({ 'POST /api/auth/salir': ok({}) });
    await pedir('POST', '/api/auth/salir');
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
  });

  it('lanza ErrorApi con el código y el mensaje del servidor', async () => {
    simularApi({ 'GET /api/x': falla(409, 'conflicto', 'Alguien cambió esta tarea') });
    const error = await pedir('GET', '/api/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ codigo: 'conflicto', mensaje: 'Alguien cambió esta tarea', estado: 409 });
  });

  it('ante token-vencido avisa con un evento en window', async () => {
    simularApi({ 'GET /api/tareas': falla(401, 'token-vencido', 'venció') });
    const oyente = vi.fn();
    window.addEventListener(EVENTO_TOKEN_VENCIDO, oyente);
    await expect(pedir('GET', '/api/tareas')).rejects.toMatchObject({ codigo: 'token-vencido' });
    window.removeEventListener(EVENTO_TOKEN_VENCIDO, oyente);
    expect(oyente).toHaveBeenCalledOnce();
  });

  it('sin red responde sin-conexion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(pedir('GET', '/api/tareas')).rejects.toMatchObject({ codigo: 'sin-conexion', estado: 0 });
  });

  it('una respuesta que no es el sobre es un error interno', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })));
    await expect(pedir('GET', '/api/tareas')).rejects.toMatchObject({ codigo: 'interno', estado: 502 });
  });

  it('un sobre de error sin mensaje de texto no se toma como válido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, codigo: 'conflicto' }), { status: 409 })));
    await expect(pedir('GET', '/api/x')).rejects.toMatchObject({ codigo: 'interno', estado: 409 });
  });

  it('si la consulta desactualizada después falla, la marca se limpia', async () => {
    let respuesta = ok([], true);
    simularApi({ 'GET /api/tareas': () => respuesta });
    await pedir('GET', '/api/tareas');
    expect(hayDesactualizados()).toBe(true);
    respuesta = falla(401, 'token-vencido', 'venció');
    await expect(pedir('GET', '/api/tareas')).rejects.toBeInstanceOf(ErrorApi);
    expect(hayDesactualizados()).toBe(false);
  });

  it('las rutas con id y con parámetros comparten una sola marca', async () => {
    simularApi({ 'GET /api/tareas/1': ok({}, true), 'GET /api/tareas/2': ok({}, false) });
    await pedir('GET', '/api/tareas/1');
    expect(hayDesactualizados()).toBe(true);
    await pedir('GET', '/api/tareas/2?x=1');
    expect(hayDesactualizados()).toBe(false);
  });

  it('el token vencido pausa los refrescos hasta la próxima respuesta buena', async () => {
    let respuesta = falla(401, 'token-vencido', 'venció');
    simularApi({ 'GET /api/tareas': () => respuesta });
    await pedir('GET', '/api/tareas').catch(() => {});
    expect(tokenVencido()).toBe(true);
    respuesta = ok([]);
    await pedir('GET', '/api/tareas');
    expect(tokenVencido()).toBe(false);
  });

  it('una respuesta buena de una ruta que no usa el token no levanta la pausa', async () => {
    simularApi({ 'GET /api/tareas': falla(401, 'token-vencido', 'venció'), 'GET /api/horas': ok({}), 'GET /api/horas/equipo': ok({}) });
    await pedir('GET', '/api/tareas').catch(() => {});
    await pedir('GET', '/api/horas');
    await pedir('GET', '/api/horas/equipo?dias=7');
    expect(tokenVencido()).toBe(true);
  });

  it('recuerda si la última respuesta de cada consulta vino desactualizada', async () => {
    let viejo = true;
    simularApi({ 'GET /api/tareas': () => ok([], viejo), 'GET /api/catalogo': ok({}) });
    await pedir('GET', '/api/tareas');
    await pedir('GET', '/api/catalogo');
    expect(hayDesactualizados()).toBe(true);
    viejo = false;
    await pedir('GET', '/api/tareas');
    expect(hayDesactualizados()).toBe(false);
  });
});

describe('subirArchivo', () => {
  class Xhr {
    static ultimo: Xhr;
    upload = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    abortado = false;
    open() { Xhr.ultimo = this; }
    setRequestHeader() {}
    send() {}
    abort() { this.abortado = true; this.onabort?.(); }
  }
  const preparar = () => vi.stubGlobal('XMLHttpRequest', Xhr);

  it.each(['onerror', 'ontimeout'] as const)('la promesa termina con %s', async (evento) => {
    preparar();
    const promesa = subirArchivo('/api/x', new Blob(['x']), () => {});
    Xhr.ultimo[evento]?.();
    await expect(promesa).rejects.toBeInstanceOf(ErrorApi);
  });

  it('abortar la señal corta el pedido y rechaza', async () => {
    preparar();
    const corte = new AbortController();
    const promesa = subirArchivo('/api/x', new Blob(['x']), () => {}, corte.signal);
    corte.abort();
    await expect(promesa).rejects.toBeInstanceOf(ErrorApi);
    expect(Xhr.ultimo.abortado).toBe(true);
  });

  it('con la señal ya abortada ni arranca', async () => {
    preparar();
    Xhr.ultimo = undefined as never;
    const corte = new AbortController();
    corte.abort();
    await expect(subirArchivo('/api/x', new Blob(['x']), () => {}, corte.signal)).rejects.toBeInstanceOf(ErrorApi);
    expect(Xhr.ultimo).toBeUndefined();
  });
});
