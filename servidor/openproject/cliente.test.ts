import { describe, expect, it, vi } from 'vitest';
import { halColeccion, halTarea, respuestaJson } from '../../pruebas/fabricas/op.js';
import { hoyArgentina } from '../../compartido/fechas.js';
import { crearClienteOp } from './cliente.js';

const base = { baseUrl: 'http://op.test', token: 't' };
const relacion = (id: number, type: string, from: number, to: number) => ({
  id, type, lag: 0, _links: { from: { href: `/api/v3/work_packages/${from}` }, to: { href: `/api/v3/work_packages/${to}` } },
});

describe('cliente de OpenProject', () => {
  it('recorre todas las páginas de a 100', async () => {
    const urls: string[] = [];
    const fetchFalso = async (url: string) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const elementos = offset === 1 ? Array.from({ length: 100 }, (_, i) => halTarea({ id: i + 1 })) : [halTarea({ id: 101 })];
      return respuestaJson(halColeccion(elementos, 101));
    };
    const c = crearClienteOp({ ...base, fetch: fetchFalso as any });
    expect((await c.tareas()).tareas.length).toBe(101);
    expect(urls.every((u) => u.includes('pageSize=100'))).toBe(true);
    expect(urls.length).toBe(2);
  });
  it('manda lockVersion al actualizar', async () => {
    let cuerpo: any;
    let url = '';
    let metodo = '';
    const c = crearClienteOp({ ...base, fetch: (async (u: string, init: RequestInit) => { url = u; metodo = String(init.method); cuerpo = JSON.parse(String(init.body)); return respuestaJson(halTarea({ id: 5, lockVersion: 4 })); }) as any });
    await c.actualizarTarea(5, 3, { titulo: 'Nuevo título' });
    expect(metodo).toBe('PATCH');
    expect(url).toBe('http://op.test/api/v3/work_packages/5');
    expect(cuerpo).toMatchObject({ lockVersion: 3, subject: 'Nuevo título' });
  });
  it('traduce los cambios a enlaces y duración ISO', async () => {
    let cuerpo: any;
    let url = '';
    let metodo = '';
    const c = crearClienteOp({ ...base, fetch: (async (u: string, init: RequestInit) => { url = u; metodo = String(init.method); cuerpo = JSON.parse(String(init.body)); return respuestaJson(halTarea()); }) as any });
    await c.actualizarTarea(5, 3, { estadoId: 12, responsableId: null, estimacionHoras: 1.5, descripcion: 'x' });
    expect(metodo).toBe('PATCH');
    expect(url).toBe('http://op.test/api/v3/work_packages/5');
    expect(cuerpo).toEqual({
      lockVersion: 3,
      description: { raw: 'x' },
      estimatedTime: 'PT1H30M',
      _links: { status: { href: '/api/v3/statuses/12' }, assignee: { href: null } },
    });
  });
  it('restanteHoras viaja como remainingTime', async () => {
    let cuerpo: any;
    const c = crearClienteOp({ ...base, fetch: (async (_u: string, init: RequestInit) => { cuerpo = JSON.parse(String(init.body)); return respuestaJson(halTarea()); }) as any });
    await c.actualizarTarea(5, 3, { restanteHoras: 0 });
    expect(cuerpo).toEqual({ lockVersion: 3, remainingTime: 'PT0H' });
  });
  it('programacionManual viaja como scheduleManually', async () => {
    let cuerpo: any;
    const c = crearClienteOp({ ...base, fetch: (async (_u: string, init: RequestInit) => { cuerpo = JSON.parse(String(init.body)); return respuestaJson(halTarea()); }) as any });
    await c.actualizarTarea(5, 3, { programacionManual: true });
    expect(cuerpo).toEqual({ lockVersion: 3, scheduleManually: true });
  });
  it('duracionDias viaja como duration ISO 8601 en días hábiles', async () => {
    let cuerpo: any;
    const c = crearClienteOp({ ...base, fetch: (async (_u: string, init: RequestInit) => { cuerpo = JSON.parse(String(init.body)); return respuestaJson(halTarea()); }) as any });
    await c.actualizarTarea(5, 3, { programacionManual: false, duracionDias: 3 });
    expect(cuerpo).toEqual({ lockVersion: 3, scheduleManually: false, duration: 'P3D' });
  });
  it('crearDependencia manda lag solo si no es 0', async () => {
    const cuerpos: any[] = [];
    const c = crearClienteOp({ ...base, fetch: (async (_u: string, init: RequestInit) => { cuerpos.push(JSON.parse(String(init.body))); return respuestaJson(relacion(8, 'follows', 5, 4), 201); }) as any });
    await c.crearDependencia(5, 4, 2);
    await c.crearDependencia(5, 4);
    await c.crearDependencia(5, 4, 0);
    expect(cuerpos[0]).toEqual({ type: 'follows', lag: 2, _links: { to: { href: '/api/v3/work_packages/4' } } });
    expect(cuerpos[1]).not.toHaveProperty('lag');
    expect(cuerpos[2]).not.toHaveProperty('lag');
  });
  it('crearDependencia(5, 4, 2) devuelve el lag de la respuesta o 0 si no lo trae', async () => {
    const con = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ ...relacion(8, 'follows', 5, 4), lag: 2 }, 201)) as any });
    expect((await con.crearDependencia(5, 4, 2)).lag).toBe(2);
    const sin = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ id: 9 }, 201)) as any });
    expect((await sin.crearDependencia(5, 4, 2)).lag).toBe(0);
  });
  it('cambiar la fecha de un hito manda date', async () => {
    let cuerpo: any;
    const c = crearClienteOp({ ...base, fetch: (async (_u: string, init: RequestInit) => { cuerpo = JSON.parse(String(init.body)); return respuestaJson(halTarea()); }) as any });
    await c.actualizarTarea(5, 3, { fecha: '2026-11-02' });
    expect(cuerpo).toEqual({ lockVersion: 3, date: '2026-11-02' });
    await c.actualizarTarea(5, 3, { fecha: null });
    expect(cuerpo).toEqual({ lockVersion: 3, date: null });
  });
  it('autentica con Basic apikey:token', async () => {
    let cabeceras: any;
    const c = crearClienteOp({ ...base, fetch: (async (_u: string, init: RequestInit) => { cabeceras = init.headers; return respuestaJson(halTarea()); }) as any });
    await c.tarea(1);
    expect(cabeceras.Authorization).toBe(`Basic ${Buffer.from('apikey:t').toString('base64')}`);
  });
  it('la lista incremental usa el filtro updatedAt', async () => {
    const urls: string[] = [];
    const c = crearClienteOp({ ...base, fetch: (async (u: string) => { urls.push(u); return respuestaJson(halColeccion([], 0)); }) as any });
    await c.tareas({ actualizadasDesde: '2026-10-01T00:00:00Z' });
    const filtros = JSON.parse(new URL(urls[0]!).searchParams.get('filters')!);
    expect(filtros).toEqual([{ updatedAt: { operator: '<>d', values: ['2026-10-01T00:00:00Z', ''] } }]);
  });
  it('proyectos pide /projects con pageSize=100 y recorre todas las páginas', async () => {
    const urls: string[] = [];
    const hal = (id: number) => ({ _type: 'Project', id, name: `P${id}`, identifier: `p${id}`, active: true });
    const c = crearClienteOp({ ...base, fetch: (async (u: string) => {
      urls.push(u);
      const pagina = new URL(u).searchParams.get('offset');
      return respuestaJson(pagina === '1' ? halColeccion([hal(1)], 2) : halColeccion([hal(2)], 2));
    }) as any });
    const lista = await c.proyectos();
    expect(lista.map((p) => p.id)).toEqual([1, 2]);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]!).pathname).toBe('/api/v3/projects');
    expect(new URL(urls[0]!).searchParams.get('pageSize')).toBe('100');
  });
  it('dependencias: follows y precedes (invertida), ignora el resto', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson(halColeccion([relacion(1, 'follows', 10, 20), relacion(2, 'precedes', 30, 40), relacion(3, 'relates', 50, 60)], 3))) as any });
    expect(await c.dependencias()).toEqual([
      { id: 1, sucesoraId: 10, predecesoraId: 20, lag: 0 },
      { id: 2, sucesoraId: 40, predecesoraId: 30, lag: 0 },
    ]);
  });
  it('crea una dependencia follows', async () => {
    let url = '';
    let cuerpo: any;
    const c = crearClienteOp({ ...base, fetch: (async (u: string, init: RequestInit) => {
      url = u; cuerpo = JSON.parse(String(init.body));
      return respuestaJson(relacion(8, 'follows', 10, 20), 201);
    }) as any });
    expect(await c.crearDependencia(10, 20)).toEqual({ id: 8, sucesoraId: 10, predecesoraId: 20, lag: 0 });
    expect(url).toBe('http://op.test/api/v3/work_packages/10/relations');
    expect(cuerpo).toEqual({ type: 'follows', _links: { to: { href: '/api/v3/work_packages/20' } } });
  });
  it('crearTarea hace POST y omite los opcionales nulos', async () => {
    let url = '';
    let metodo = '';
    let cuerpo: any;
    const c = crearClienteOp({ ...base, fetch: (async (u: string, init: RequestInit) => { url = u; metodo = String(init.method); cuerpo = JSON.parse(String(init.body)); return respuestaJson(halTarea({ id: 9 }), 201); }) as any });
    const t = await c.crearTarea({ titulo: 'Nueva', proyectoId: 11, responsableId: null, madreId: null, fin: null });
    expect(t.id).toBe(9);
    expect(metodo).toBe('POST');
    expect(url).toBe('http://op.test/api/v3/work_packages');
    expect(cuerpo).toEqual({ subject: 'Nueva', _links: { project: { href: '/api/v3/projects/11' } } });
  });
  it('crearTarea manda la versión como enlace', async () => {
    let cuerpo: any;
    const c = crearClienteOp({ ...base, fetch: (async (_u: string, init: RequestInit) => { cuerpo = JSON.parse(String(init.body)); return respuestaJson(halTarea({ id: 9 }), 201); }) as any });
    await c.crearTarea({ titulo: 'Nueva', proyectoId: 11, versionId: 7 });
    expect(cuerpo._links.version).toEqual({ href: '/api/v3/versions/7' });
  });
  it('crearTarea manda el inicio, el fin y la programación manual', async () => {
    let cuerpo: any;
    const c = crearClienteOp({ ...base, fetch: (async (_u: string, init: RequestInit) => { cuerpo = JSON.parse(String(init.body)); return respuestaJson(halTarea({ id: 9 }), 201); }) as any });
    await c.crearTarea({ titulo: 'Nueva', proyectoId: 11, madreId: 30, inicio: '2026-10-27', fin: '2026-11-02', programacionManual: true });
    expect(cuerpo).toEqual({
      subject: 'Nueva', startDate: '2026-10-27', dueDate: '2026-11-02', scheduleManually: true,
      _links: { project: { href: '/api/v3/projects/11' }, parent: { href: '/api/v3/work_packages/30' } },
    });
  });
  it('comentar hace POST a activities con el comentario', async () => {
    let url = '';
    let metodo = '';
    let cuerpo: any;
    const c = crearClienteOp({ ...base, fetch: (async (u: string, init: RequestInit) => { url = u; metodo = String(init.method); cuerpo = JSON.parse(String(init.body)); return respuestaJson({}, 201); }) as any });
    await c.comentar(5, 'hola');
    expect(metodo).toBe('POST');
    expect(url).toBe('http://op.test/api/v3/work_packages/5/activities');
    expect(cuerpo).toEqual({ comment: { raw: 'hola' } });
  });
  it('borrarDependencia hace DELETE sin cuerpo', async () => {
    let url = '';
    let init0: RequestInit = {};
    const c = crearClienteOp({ ...base, fetch: (async (u: string, init: RequestInit) => { url = u; init0 = init; return new Response(null, { status: 204 }); }) as any });
    await c.borrarDependencia(8);
    expect(init0.method).toBe('DELETE');
    expect(init0.body).toBeUndefined();
    expect(url).toBe('http://op.test/api/v3/relations/8');
  });
  it('marcarLeida hace POST a read_ian', async () => {
    let url = '';
    let metodo = '';
    const c = crearClienteOp({ ...base, fetch: (async (u: string, init: RequestInit) => { url = u; metodo = String(init.method); return new Response(null, { status: 204 }); }) as any });
    await c.marcarLeida(3);
    expect(metodo).toBe('POST');
    expect(url).toBe('http://op.test/api/v3/notifications/3/read_ian');
  });
  it('marcarLeida manda Content-Type aunque no lleve cuerpo (OpenProject responde 406 sin él)', async () => {
    const comoOpenProject = async (_u: string, init: RequestInit) => {
      const cabeceras = init.headers as Record<string, string>;
      return cabeceras['Content-Type'] === 'application/json'
        ? new Response(null, { status: 204 })
        : respuestaJson({ message: 'Missing content-type header' }, 406);
    };
    const c = crearClienteOp({ ...base, fetch: comoOpenProject as any });
    await expect(c.marcarLeida(3)).resolves.toBeUndefined();
  });
  it('marcarLeidas hace un solo POST a read_ian con un filtro por id', async () => {
    const pedidos: Array<{ url: string; metodo: string }> = [];
    const c = crearClienteOp({ ...base, fetch: (async (u: string, init: RequestInit) => { pedidos.push({ url: u, metodo: String(init.method) }); return new Response(null, { status: 204 }); }) as any });
    await expect(c.marcarLeidas([3, 4, 5])).resolves.toEqual([]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.metodo).toBe('POST');
    const url = new URL(pedidos[0]!.url);
    expect(url.pathname).toBe('/api/v3/notifications/read_ian');
    expect(JSON.parse(url.searchParams.get('filters')!)).toEqual([{ id: { operator: '=', values: ['3', '4', '5'] } }]);
  });
  it('marcarLeida y marcarLeidas son idempotentes: un vencimiento o una falla de red dan red, no incierto', async () => {
    const vence = (async () => { throw new DOMException('timeout', 'TimeoutError'); }) as any;
    const sinRed = (async () => { throw new TypeError('fetch failed'); }) as any;
    const noJson = (async () => new Response('<html>', { status: 200 })) as any;
    const malaPuerta = (async () => respuestaJson({ message: 'x' }, 504)) as any;
    for (const fetch of [vence, sinRed, noJson, malaPuerta]) {
      const c = crearClienteOp({ ...base, fetch });
      await expect(c.marcarLeida(3)).rejects.toMatchObject({ tipo: 'red' });
      await expect(c.marcarLeidas([3, 4])).rejects.toMatchObject({ tipo: 'red' });
    }
  });
  it('un fallo al leer el cuerpo es tipo red', async () => {
    const cuerpoRoto = { ok: true, status: 200, text: async () => { throw new TypeError('terminated'); } };
    const c = crearClienteOp({ ...base, fetch: (async () => cuerpoRoto) as any });
    await expect(c.tarea(1)).rejects.toMatchObject({ tipo: 'red' });
  });
  it.each([[401, 'no-autorizado'], [403, 'prohibido'], [404, 'no-encontrado'], [409, 'conflicto'], [422, 'validacion'], [502, 'red']])('HTTP %i → %s', async (estado, tipo) => {
    const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ message: 'detalle de OpenProject' }, estado)) as any });
    await expect(c.tarea(1)).rejects.toMatchObject({ tipo });
  });
  it('un fallo de red es tipo red', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => { throw new TypeError('fetch failed'); }) as any });
    await expect(c.tarea(1)).rejects.toMatchObject({ tipo: 'red' });
  });
  it('un POST que vence por tiempo lanza ErrorOp incierto', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => { throw new DOMException('timeout', 'TimeoutError'); }) as any });
    await expect(c.crearTarea({ titulo: 'x', proyectoId: 1 })).rejects.toMatchObject({ tipo: 'incierto' });
  });
  it('un POST con error de red sin respuesta es incierto', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => { throw new TypeError('fetch failed'); }) as any });
    await expect(c.comentar(1, 'hola')).rejects.toMatchObject({ tipo: 'incierto' });
  });
  it.each([[502], [504]])('un POST con HTTP %i es incierto', async (estado) => {
    const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ message: 'x' }, estado)) as any });
    await expect(c.crearTarea({ titulo: 'x', proyectoId: 1 })).rejects.toMatchObject({ tipo: 'incierto', estadoHttp: estado });
  });
  it('un GET que vence sigue siendo red', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => { throw new DOMException('timeout', 'TimeoutError'); }) as any });
    await expect(c.tarea(1)).rejects.toMatchObject({ tipo: 'red' });
  });
  it('un PATCH que vence sigue siendo red', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => { throw new DOMException('timeout', 'TimeoutError'); }) as any });
    await expect(c.actualizarTarea(1, 1, { titulo: 'x' })).rejects.toMatchObject({ tipo: 'red' });
  });
  it('crearDependencia arma la dependencia con los ids pedidos aunque la respuesta no traiga el tipo', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ id: 55, lag: 2 }, 201)) as any });
    expect(await c.crearDependencia(10, 20)).toEqual({ id: 55, sucesoraId: 10, predecesoraId: 20, lag: 2 });
  });
  it('crearDependencia usa lag 0 si la respuesta no lo trae', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ id: 56 }, 201)) as any });
    expect(await c.crearDependencia(10, 20)).toEqual({ id: 56, sucesoraId: 10, predecesoraId: 20, lag: 0 });
  });
  it('422 conserva el mensaje de OpenProject', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ message: 'Estado no es válido' }, 422)) as any });
    await expect(c.actualizarTarea(1, 1, { estadoId: 12 })).rejects.toMatchObject({ tipo: 'validacion', message: 'Estado no es válido' });
  });
  it('422 conserva los campos que OpenProject señala, en un error o en varios', async () => {
    const uno = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ message: 'Versión', _embedded: { details: { attribute: 'version' } } }, 422)) as any });
    await expect(uno.actualizarTarea(1, 1, { versionId: 3 })).rejects.toMatchObject({ tipo: 'validacion', atributos: ['version'] });
    const varios = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ message: 'Varios', _embedded: { errors: [{ _embedded: { details: { attribute: 'dueDate' } } }, { _embedded: { details: { attribute: 'duration' } } }] } }, 422)) as any });
    await expect(varios.actualizarTarea(1, 1, { fin: '2026-10-01' })).rejects.toMatchObject({ atributos: ['dueDate', 'duration'] });
    const ninguno = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ message: 'x' }, 422)) as any });
    await expect(ninguno.actualizarTarea(1, 1, { versionId: 3 })).rejects.toMatchObject({ atributos: [] });
  });
  describe('elementos con forma inesperada', () => {
    const actividad = (id: number) => ({ id, createdAt: '2026-10-19T12:00:00Z', comment: { raw: `c${id}` }, details: [], _links: { user: { href: '/api/v3/users/4' } } });

    it('un paquete de trabajo raro se saltea con una línea en el log y la lista sigue', async () => {
      const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const sinEstado = { ...halTarea({ id: 2 }), _links: { ...(halTarea({ id: 2 }) as { _links: object })._links, status: { href: null } } };
      const sinTitulo = { ...halTarea({ id: 3 }), subject: 42 };
      const c = crearClienteOp({ ...base, registro, token: 'token-secreto', fetch: (async () =>
        respuestaJson(halColeccion([halTarea({ id: 1 }), sinEstado, sinTitulo, halTarea({ id: 4 })]))) as any });
      const lote = await c.tareas();
      expect(lote.tareas.map((t) => t.id)).toEqual([1, 4]);
      expect(lote.salteadas).toEqual([2, 3]);
      expect(registro.warn).toHaveBeenCalledTimes(2);
      const lineas = registro.warn.mock.calls.map((llamada) => String(llamada[1]));
      expect(lineas[0]).toMatch(/paquete de trabajo 2 .*_links\.status/);
      expect(lineas[1]).toMatch(/paquete de trabajo 3 .*subject/);
      expect(registro.warn.mock.calls[0]![0]).toHaveProperty('motivo');
      expect(JSON.stringify(registro.warn.mock.calls)).not.toContain('token-secreto');
    });

    it('tareas devuelve los ids de los elementos salteados y omite los que no tienen id numérico', async () => {
      const sinEstado = { ...halTarea({ id: 7 }), _links: { ...(halTarea({ id: 7 }) as { _links: object })._links, status: { href: null } } };
      const sinId = { ...halTarea({ id: 8 }), id: 'x', subject: 42 };
      const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson(halColeccion([halTarea({ id: 1 }), sinEstado, sinId]))) as any });
      expect(await c.tareas()).toMatchObject({ salteadas: [7] });
    });

    it('una actividad rara se saltea y el resto del historial llega', async () => {
      const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const c = crearClienteOp({ ...base, registro, fetch: (async () =>
        respuestaJson(halColeccion([actividad(1), { id: 2, createdAt: 123 }, { _type: 'Activity' }, actividad(3)]))) as any });
      expect((await c.actividades(8)).map((a) => a.id)).toEqual([1, 3]);
      expect(registro.warn).toHaveBeenCalledTimes(2);
      expect(String(registro.warn.mock.calls[0]![1])).toMatch(/actividad 2 de la tarea 8/);
    });

    it('avisa por el registro inyectado al saltear un elemento raro', async () => {
      const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const sinEstado = { ...halTarea({ id: 2 }), _links: { ...(halTarea({ id: 2 }) as { _links: object })._links, status: { href: null } } };
      const c = crearClienteOp({ ...base, registro, fetch: (async () => respuestaJson(halColeccion([sinEstado]))) as any });
      await c.tareas();
      expect(registro.warn).toHaveBeenCalledTimes(1);
      expect(registro.warn.mock.calls[0]![0]).toMatchObject({ motivo: 'forma-inesperada' });
    });

    it('sin registro inyectado el aviso no sale por consola', async () => {
      const consola = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson(halColeccion([{ ...halTarea({ id: 3 }), subject: 42 }]))) as any });
      expect(await c.tareas()).toEqual({ tareas: [], salteadas: [3] });
      expect(consola).not.toHaveBeenCalled();
      consola.mockRestore();
    });

    it('una sola tarea rara (detalle, escritura) sigue siendo un error', async () => {
      const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ ...halTarea({ id: 5 }), subject: 42 })) as any });
      await expect(c.tarea(5)).rejects.toThrow(/subject/);
    });
  });

  describe('puedeLeerTareas', () => {
    it('200 → true y pide una sola tarea del proyecto', async () => {
      let url = '';
      const c = crearClienteOp({ ...base, fetch: (async (u: string) => { url = u; return respuestaJson(halColeccion([], 0)); }) as any });
      expect(await c.puedeLeerTareas(11)).toBe(true);
      expect(url).toContain('/api/v3/projects/11/work_packages?');
      expect(url).toContain('pageSize=1');
    });
    it.each([[403], [404]])('HTTP %i → false', async (estado) => {
      const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({}, estado)) as any });
      expect(await c.puedeLeerTareas(11)).toBe(false);
    });
    it.each([[401, 'no-autorizado'], [502, 'red']])('HTTP %i se propaga como %s', async (estado, tipo) => {
      const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({}, estado)) as any });
      await expect(c.puedeLeerTareas(11)).rejects.toMatchObject({ tipo });
    });
  });
  describe('asignables', () => {
    const usuario = (id: number) => ({ _type: 'User', id, name: `U${id}`, login: `u${id}` });
    it('asignables pide available_assignees del proyecto y descarta lo que no es persona', async () => {
      const urls: string[] = [];
      const grupo = { _type: 'Group', id: 50, name: 'Equipo' };
      const c = crearClienteOp({ ...base, fetch: (async (u: string) => { urls.push(u); return respuestaJson(halColeccion([usuario(4), grupo, usuario(6)])); }) as any });
      expect((await c.asignables(11))!.map((p) => p.id)).toEqual([4, 6]);
      expect(new URL(urls[0]!).pathname).toBe('/api/v3/projects/11/available_assignees');
      expect(new URL(urls[0]!).searchParams.get('pageSize')).toBe('100');
    });
    it.each([[403], [404]])('asignables devuelve null ante %i (no se sabe quién es asignable)', async (estado) => {
      const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({}, estado)) as any });
      expect(await c.asignables(11)).toBeNull();
    });
    it('un fallo de red se propaga', async () => {
      const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({}, 502)) as any });
      await expect(c.asignables(11)).rejects.toMatchObject({ tipo: 'red' });
    });
  });
  describe('avatar', () => {
    const imagen = (tipo = 'image/png') => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': tipo } });
    const redireccion = (destino: string) => new Response(null, { status: 302, headers: { Location: destino } });

    it('pide la URL fija del usuario con el token y devuelve la imagen', async () => {
      const pedidos: { url: string; init: RequestInit }[] = [];
      const c = crearClienteOp({ ...base, fetch: (async (url: string, init: RequestInit) => { pedidos.push({ url, init }); return imagen(); }) as any });
      const avatar = await c.avatar(7);
      expect(pedidos.map((p) => p.url)).toEqual(['http://op.test/api/v3/users/7/avatar']);
      expect((pedidos[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('apikey:t').toString('base64')}`);
      expect(pedidos[0]!.init.redirect).toBe('manual');
      expect(avatar).toEqual({ tipo: 'image/png', datos: Buffer.from([1, 2, 3]) });
    });

    it('sigue redirecciones del mismo origen', async () => {
      const urls: string[] = [];
      const c = crearClienteOp({ ...base, fetch: (async (url: string) => {
        urls.push(url);
        return urls.length === 1 ? redireccion('/attachments/31/content') : imagen('image/jpeg; charset=binary');
      }) as any });
      expect(await c.avatar(7)).toMatchObject({ tipo: 'image/jpeg' });
      expect(urls).toEqual(['http://op.test/api/v3/users/7/avatar', 'http://op.test/attachments/31/content']);
    });

    it('no sigue redirecciones a otro origen (el token no sale de OpenProject)', async () => {
      const urls: string[] = [];
      const c = crearClienteOp({ ...base, fetch: (async (url: string) => { urls.push(url); return redireccion('https://www.gravatar.com/avatar/abc'); }) as any });
      expect(await c.avatar(7)).toBeNull();
      expect(urls).toHaveLength(1);
    });

    it('404 → null; 401 se propaga', async () => {
      const sinAvatar = crearClienteOp({ ...base, fetch: (async () => respuestaJson({}, 404)) as any });
      expect(await sinAvatar.avatar(7)).toBeNull();
      const vencido = crearClienteOp({ ...base, fetch: (async () => respuestaJson({}, 401)) as any });
      await expect(vencido.avatar(7)).rejects.toMatchObject({ tipo: 'no-autorizado' });
    });

    it('un avatar con content-length mayor al tope se rechaza sin leer el cuerpo', async () => {
      let leido = false;
      const cuerpo = new ReadableStream({ pull(c) { leido = true; c.enqueue(new Uint8Array(10)); } }, { highWaterMark: 0 });
      const c = crearClienteOp({ ...base, fetch: (async () => new Response(cuerpo, { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': String(3 * 1024 * 1024) } })) as any });
      expect(await c.avatar(7)).toBeNull();
      expect(leido).toBe(false);
    });

    it('un avatar que supera el tope sin content-length se corta', async () => {
      let partes = 0;
      let cancelado = false;
      const cuerpo = new ReadableStream({
        pull(c) { partes++; c.enqueue(new Uint8Array(512 * 1024)); },
        cancel() { cancelado = true; },
      });
      const c = crearClienteOp({ ...base, fetch: (async () => new Response(cuerpo, { status: 200, headers: { 'Content-Type': 'image/png' } })) as any });
      expect(await c.avatar(7)).toBeNull();
      expect(cancelado).toBe(true);
      expect(partes).toBeLessThan(10);
    });

    it('corta las redirecciones en bucle', async () => {
      let llamadas = 0;
      const c = crearClienteOp({ ...base, fetch: (async () => { llamadas++; return redireccion('/api/v3/users/7/avatar'); }) as any });
      expect(await c.avatar(7)).toBeNull();
      expect(llamadas).toBeLessThanOrEqual(4);
    });
  });

  describe('catalogo: días no laborables', () => {
    const semana = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, working: day < 6 }));
    function clienteDias(respuesta: (ruta: string) => Response, pedidas: URL[] = []) {
      const registro = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
      const c = crearClienteOp({ ...base, registro: registro as any, fetch: (async (u: string) => {
        const url = new URL(u);
        pedidas.push(url);
        return respuesta(url.pathname);
      }) as any });
      return { c, registro };
    }
    const normal = (ruta: string) => respuestaJson(
      ruta === '/api/v3/days/week' ? halColeccion(semana)
        : ruta === '/api/v3/days/non_working' ? halColeccion([{ date: '2026-11-23', name: 'x' }])
          : halColeccion([]),
    );
    it('arma la semana y los feriados con el filtro por años', async () => {
      const pedidas: URL[] = [];
      const cat = await clienteDias(normal, pedidas).c.catalogo();
      expect(cat.semanaNoLaborable).toEqual([0, 6]);
      expect(cat.diasNoLaborables).toEqual(['2026-11-23']);
      const anio = Number(hoyArgentina(new Date()).slice(0, 4));
      const feriados = pedidas.find((u) => u.pathname === '/api/v3/days/non_working')!;
      expect(JSON.parse(feriados.searchParams.get('filters')!)).toEqual([
        { date: { operator: '<>d', values: [`${anio}-01-01`, `${anio + 1}-12-31`] } },
      ]);
      expect(pedidas.some((u) => u.pathname === '/api/v3/days/week')).toBe(true);
    });
    it.each([
      [403, '/api/v3/days/non_working'], [404, '/api/v3/days/non_working'], [500, '/api/v3/days/non_working'],
      [403, '/api/v3/days/week'], [500, '/api/v3/days/week'],
    ])('con %i en %s quedan sábado y domingo y un aviso', async (estado, rutaFalla) => {
      const { c, registro } = clienteDias((ruta) => (ruta === rutaFalla ? respuestaJson({}, estado) : normal(ruta)));
      const cat = await c.catalogo();
      expect(cat.semanaNoLaborable).toEqual([0, 6]);
      expect(cat.diasNoLaborables).toEqual([]);
      expect(registro.warn).toHaveBeenCalled();
    });
    it('un elemento con forma inesperada también cae a sábado y domingo con aviso', async () => {
      const { c, registro } = clienteDias((ruta) => (ruta === '/api/v3/days/week' ? respuestaJson(halColeccion([{ raro: true }])) : normal(ruta)));
      const cat = await c.catalogo();
      expect(cat.semanaNoLaborable).toEqual([0, 6]);
      expect(cat.diasNoLaborables).toEqual([]);
      expect(registro.warn).toHaveBeenCalled();
    });
  });

  describe('catalogo con proyectos problemáticos', () => {
    const proyecto = (id: number, active: boolean) => ({ id, name: `P${id}`, identifier: `p${id}`, active });
    const version = (id: number, proy: number) => ({ id, name: `V${id}`, _links: { definingProject: { href: `/api/v3/projects/${proy}` } } });
    function clienteCon(versionesDe: (id: string) => Response, pedidas: string[]) {
      return crearClienteOp({ ...base, fetch: (async (u: string) => {
        const ruta = new URL(u).pathname;
        const m = /^\/api\/v3\/projects\/(\d+)\/versions$/.exec(ruta);
        if (m) { pedidas.push(m[1]!); return versionesDe(m[1]!); }
        if (ruta === '/api/v3/projects') return respuestaJson(halColeccion([proyecto(1, true), proyecto(2, true), proyecto(3, false)]));
        return respuestaJson(halColeccion([]));
      }) as any });
    }
    it('omite las versiones de un proyecto que da 403 y conserva las demás', async () => {
      const c = clienteCon((id) => (id === '2' ? respuestaJson({}, 403) : respuestaJson(halColeccion([version(10, 1)]))), []);
      const catalogo = await c.catalogo();
      expect(catalogo.versiones.map((v) => v.id)).toEqual([10]);
      expect(catalogo.proyectos).toHaveLength(3);
    });
    it('no pide versiones de un proyecto inactivo', async () => {
      const pedidas: string[] = [];
      await clienteCon(() => respuestaJson(halColeccion([])), pedidas).catalogo();
      expect(pedidas.sort()).toEqual(['1', '2']);
    });
    it('un error distinto de prohibido o no-encontrado sigue propagándose', async () => {
      const c = clienteCon(() => respuestaJson({}, 401), []);
      await expect(c.catalogo()).rejects.toMatchObject({ tipo: 'no-autorizado' });
    });
  });
});

describe('entradas de tiempo', () => {
  const guardar = (respuesta: () => Response) => {
    const visto: { url: string; metodo: string; cuerpo: any }[] = [];
    const fetchFalso = async (url: string, init: RequestInit) => {
      visto.push({ url, metodo: String(init.method), cuerpo: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return respuesta();
    };
    return { visto, cliente: crearClienteOp({ ...base, fetch: fetchFalso as any }) };
  };

  it('crearEntradaTiempo() manda horas, día, comentario y tarea, y devuelve el id', async () => {
    const { visto, cliente } = guardar(() => respuestaJson({ id: 77 }, 201));
    const r = await cliente.crearEntradaTiempo({ tareaId: 5, dia: '2026-10-26', horasIso: 'PT1H30M', comentario: 'OpenDash · tramo 3' });
    expect(r).toEqual({ id: 77 });
    expect(visto[0]).toMatchObject({ metodo: 'POST', url: 'http://op.test/api/v3/time_entries' });
    expect(visto[0]!.cuerpo).toEqual({
      hours: 'PT1H30M', spentOn: '2026-10-26', comment: { raw: 'OpenDash · tramo 3' },
      _links: { entity: { href: '/api/v3/work_packages/5' } },
    });
  });
  it('un POST sin respuesta es incierto', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => { throw new Error('corte'); }) as any });
    await expect(c.crearEntradaTiempo({ tareaId: 5, dia: '2026-10-26', horasIso: 'PT1H', comentario: 'x' })).rejects.toMatchObject({ tipo: 'incierto' });
  });
  it('editarEntradaTiempo() hace PATCH con las horas', async () => {
    const { visto, cliente } = guardar(() => respuestaJson({ id: 77 }));
    await cliente.editarEntradaTiempo(77, 'PT2H');
    expect(visto[0]).toMatchObject({ metodo: 'PATCH', url: 'http://op.test/api/v3/time_entries/77', cuerpo: { hours: 'PT2H' } });
  });
  it('borrarEntradaTiempo() hace DELETE', async () => {
    const { visto, cliente } = guardar(() => new Response(null, { status: 204 }));
    await cliente.borrarEntradaTiempo(77);
    expect(visto[0]).toMatchObject({ metodo: 'DELETE', url: 'http://op.test/api/v3/time_entries/77' });
  });
  it('entradasDeTiempo() filtra por tarea, día y usuario del token', async () => {
    const elementos = [{ id: 1, comment: { raw: 'OpenDash · tramo 3' } }, { id: 2, comment: { raw: '' } }, { id: 3 }];
    const { visto, cliente } = guardar(() => respuestaJson(halColeccion(elementos, 3)));
    expect(await cliente.entradasDeTiempo({ tareaId: 5, dia: '2026-10-26' })).toEqual([
      { id: 1, comentario: 'OpenDash · tramo 3' }, { id: 2, comentario: '' }, { id: 3, comentario: '' },
    ]);
    const filtros = JSON.parse(new URL(visto[0]!.url).searchParams.get('filters')!);
    expect(filtros).toEqual([
      { entityType: { operator: '=', values: ['WorkPackage'] } },
      { entityId: { operator: '=', values: ['5'] } },
      { spentOn: { operator: '=d', values: ['2026-10-26'] } },
      { user: { operator: '=', values: ['me'] } },
    ]);
  });
});

describe('catalogo: proyectos plantilla', () => {
  function clientePlantillas(plantillas: (url: URL) => Response, pedidas: URL[] = []) {
    return crearClienteOp({ ...base, fetch: (async (u: string) => {
      const url = new URL(u);
      pedidas.push(url);
      if (url.pathname === '/api/v3/projects' && url.searchParams.get('filters')?.includes('templated')) return plantillas(url);
      if (url.pathname === '/api/v3/projects') return respuestaJson(halColeccion([{ id: 1, name: 'P1', identifier: 'p1', active: true }, { id: 2, name: 'P2', identifier: 'p2', active: true }]));
      return respuestaJson(halColeccion([]));
    }) as any });
  }
  it('catalogo() trae plantillasOp con el filtro templated', async () => {
    const pedidas: URL[] = [];
    const cat = await clientePlantillas(() => respuestaJson(halColeccion([{ id: 2, name: 'P2', identifier: 'p2', active: true }])), pedidas).catalogo();
    expect(cat.plantillasOp).toEqual([2]);
    const pedida = pedidas.find((u) => u.searchParams.get('filters')?.includes('templated'))!;
    expect(JSON.parse(pedida.searchParams.get('filters')!)).toEqual([{ templated: { operator: '=', values: ['t'] } }]);
  });
  it.each([400, 403, 500])('si el filtro falla con %i, plantillasOp es [] y el catálogo carga igual', async (estado) => {
    const cat = await clientePlantillas(() => respuestaJson({}, estado)).catalogo();
    expect(cat.plantillasOp).toEqual([]);
    expect(cat.proyectos).toHaveLength(2);
  });
});

describe('adjuntos y borrado de tareas', () => {
  const halAdjunto = (id = 3) => ({ id, fileName: 'a.txt', fileSize: 3, contentType: 'text/plain', createdAt: '2026-10-25T10:00:00Z', _links: { author: { href: '/api/v3/users/1' } } });

  it('subirAdjunto arma el multipart con metadata y file', async () => {
    let init: RequestInit = {};
    let url = '';
    const c = crearClienteOp({ ...base, fetch: (async (u: string, i: RequestInit) => { url = u; init = i; return respuestaJson(halAdjunto(), 201); }) as any });
    const a = await c.subirAdjunto(7, 'informe ñandú.txt', 'text/plain', Buffer.from('hola'));
    expect(a.id).toBe(3);
    expect(url).toBe('http://op.test/api/v3/work_packages/7/attachments');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(JSON.parse(String(form.get('metadata')))).toEqual({ fileName: 'informe ñandú.txt' });
    const archivo = form.get('file') as File;
    expect(archivo.type).toBe('text/plain');
    expect(Buffer.from(await archivo.arrayBuffer()).toString()).toBe('hola');
    // el Content-Type con el boundary lo pone fetch, no nosotros
    expect(Object.keys(init.headers as Record<string, string>).map((h) => h.toLowerCase())).not.toContain('content-type');
  });
  it('bajarAdjunto corta al pasar el tope', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => new Response(Buffer.alloc(50), { headers: { 'content-type': 'text/plain' } })) as any });
    await expect(c.bajarAdjunto(3, 10)).rejects.toMatchObject({ tipo: 'validacion' });
    const ok = await c.bajarAdjunto(3, 100);
    expect(ok.tipo).toBe('text/plain');
    expect(ok.bytes.length).toBe(50);
  });
  it('bajarAdjunto no manda el token a otro origen', async () => {
    const pedidos: string[] = [];
    const c = crearClienteOp({ ...base, fetch: (async (u: string) => {
      pedidos.push(u);
      return new Response(null, { status: 302, headers: { location: 'https://otro.test/x' } });
    }) as any });
    await expect(c.bajarAdjunto(3, 100)).rejects.toBeDefined();
    expect(pedidos).toEqual(['http://op.test/api/v3/attachments/3/content']);
  });
  it('puedeAdjuntar lee el enlace', async () => {
    const con = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ id: 7, _links: { addAttachment: { href: '/x', method: 'post' } } })) as any });
    const sin = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ id: 7, _links: {} })) as any });
    expect(await con.puedeAdjuntar(7)).toBe(true);
    expect(await sin.puedeAdjuntar(7)).toBe(false);
  });
  it('puedeBorrarTarea lee el enlace delete', async () => {
    const con = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ id: 7, _links: { delete: { href: '/x' } } })) as any });
    const sin = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ id: 7, _links: {} })) as any });
    expect(await con.puedeBorrarTarea(7)).toBe(true);
    expect(await sin.puedeBorrarTarea(7)).toBe(false);
  });
  it('borrarTarea da DELETE', async () => {
    let url = '';
    let metodo = '';
    const c = crearClienteOp({ ...base, fetch: (async (u: string, i: RequestInit) => { url = u; metodo = String(i.method); return new Response(null, { status: 204 }); }) as any });
    await c.borrarTarea(7);
    expect([metodo, url]).toEqual(['DELETE', 'http://op.test/api/v3/work_packages/7']);
  });
  it('borrarAdjunto da DELETE y adjuntos() lista', async () => {
    const llamadas: string[] = [];
    const c = crearClienteOp({ ...base, fetch: (async (u: string, i: RequestInit) => {
      llamadas.push(`${i.method} ${u}`);
      return i.method === 'DELETE' ? new Response(null, { status: 204 }) : respuestaJson(halColeccion([halAdjunto(1), halAdjunto(2)], 2));
    }) as any });
    expect((await c.adjuntos(7)).map((a) => a.id)).toEqual([1, 2]);
    await c.borrarAdjunto(2);
    expect(llamadas[1]).toBe('DELETE http://op.test/api/v3/attachments/2');
  });
  it('maximoAdjunto lee la configuración y tiene respaldo', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => respuestaJson({ maximumAttachmentFileSize: 1000 })) as any });
    expect(await c.maximoAdjunto()).toBe(1000);
    const roto = crearClienteOp({ ...base, fetch: (async () => respuestaJson({}, 403)) as any });
    expect(await roto.maximoAdjunto()).toBe(5_242_880);
    expect(await crearClienteOp({ ...base, fetch: (async () => respuestaJson({}, 404)) as any }).maximoAdjunto()).toBe(5_242_880);
    expect(await crearClienteOp({ ...base, fetch: (async () => respuestaJson({ otraCosa: 1 })) as any }).maximoAdjunto()).toBe(5_242_880);
  });
  it('maximoAdjunto no inventa un máximo si el token venció o no hay red', async () => {
    const vencido = crearClienteOp({ ...base, fetch: (async () => respuestaJson({}, 401)) as any });
    await expect(vencido.maximoAdjunto()).rejects.toMatchObject({ tipo: 'no-autorizado' });
    const caido = crearClienteOp({ ...base, fetch: (async () => { throw new Error('sin red'); }) as any });
    await expect(caido.maximoAdjunto()).rejects.toMatchObject({ tipo: 'red' });
  });
  it('bajarAdjunto corta sin leer el cuerpo si content-length pasa el tope', async () => {
    const c = crearClienteOp({ ...base, fetch: (async () => new Response(Buffer.alloc(50), { headers: { 'content-length': '5000' } })) as any });
    await expect(c.bajarAdjunto(3, 100)).rejects.toMatchObject({ tipo: 'validacion' });
  });
  it('bajarAdjunto sigue una redirección al mismo origen', async () => {
    const pedidos: string[] = [];
    const c = crearClienteOp({ ...base, fetch: (async (u: string) => {
      pedidos.push(u);
      return pedidos.length === 1
        ? new Response(null, { status: 302, headers: { location: '/attachments/3/a.txt' } })
        : new Response('hola', { headers: { 'content-type': 'text/plain' } });
    }) as any });
    const r = await c.bajarAdjunto(3, 100);
    expect(r.bytes.toString()).toBe('hola');
    expect(pedidos).toEqual(['http://op.test/api/v3/attachments/3/content', 'http://op.test/attachments/3/a.txt']);
  });
});

describe('proyectos, miembros y versiones', () => {
  const halVersion = (id = 6, extra: Record<string, unknown> = {}) => ({
    id, name: 'v1', status: 'open', startDate: '2026-11-01', endDate: '2026-11-30',
    _links: { definingProject: { href: '/api/v3/projects/11' }, ...extra },
  });
  const registrar = (responder: (u: string, i: RequestInit) => Response | Promise<Response>) => {
    const llamadas: { metodo: string; url: string; cuerpo: any }[] = [];
    const fetchFalso = async (u: string, i: RequestInit) => {
      llamadas.push({ metodo: String(i.method), url: u, cuerpo: typeof i.body === 'string' ? JSON.parse(i.body) : undefined });
      return responder(u, i);
    };
    return { llamadas, cliente: crearClienteOp({ ...base, fetch: fetchFalso as any }) };
  };

  it('capacidades mira los ids de la persona en el proyecto', async () => {
    const { cliente, llamadas } = registrar(() => respuestaJson(halColeccion([
      { id: 'memberships/create/p11-4' }, { id: 'memberships/update/p11-4' }, { id: 'work_packages/read/p11-4' },
    ], 3)));
    expect(await cliente.capacidades(4, 11)).toEqual({ crearMiembro: true, cambiarMiembro: true, quitarMiembro: false, copiarProyecto: false });
    const filtros = JSON.parse(new URL(llamadas[0]!.url).searchParams.get('filters')!);
    expect(filtros).toEqual([{ principal: { operator: '=', values: ['4'] } }, { context: { operator: '=', values: ['p11'] } }]);
  });
  it('capacidades reconoce los ids de OpenProject con workspaces (`w<proyecto>`)', async () => {
    const { cliente } = registrar(() => respuestaJson(halColeccion([
      { id: 'memberships/create/w11-4' }, { id: 'memberships/destroy/w11-4' }, { id: 'projects/copy/w11-4' }, { id: 'memberships/update/w12-4' },
    ], 4)));
    expect(await cliente.capacidades(4, 11)).toEqual({ crearMiembro: true, cambiarMiembro: false, quitarMiembro: true, copiarProyecto: true });
  });
  it('puedeCrearProyectos usa el contexto global', async () => {
    const { cliente, llamadas } = registrar(() => respuestaJson(halColeccion([{ id: 'projects/create/g-4' }], 1)));
    expect(await cliente.puedeCrearProyectos(4)).toBe(true);
    expect(JSON.parse(new URL(llamadas[0]!.url).searchParams.get('filters')!)[1]).toEqual({ context: { operator: '=', values: ['g'] } });
    expect(llamadas).toHaveLength(1);
  });
  it('puedeCrearProyectos sin la capacidad le pregunta al formulario de alta (el rol global estándar no figura en capabilities)', async () => {
    const formulario = (errores: Record<string, unknown>) => respuestaJson({ _type: 'Form', _embedded: { payload: {}, validationErrors: errores } });
    const con = registrar((u) => (u.includes('/capabilities') ? respuestaJson(halColeccion([], 0)) : formulario({})));
    expect(await con.cliente.puedeCrearProyectos(4)).toBe(true);
    expect(con.llamadas[1]).toMatchObject({ metodo: 'POST', url: 'http://op.test/api/v3/projects/form', cuerpo: { name: 'OpenDash' } });
    const conErrorBase = registrar((u) => (u.includes('/capabilities') ? respuestaJson(halColeccion([], 0)) : formulario({ base: { message: 'No autorizado' } })));
    expect(await conErrorBase.cliente.puedeCrearProyectos(4)).toBe(false);
    const prohibido = registrar((u) => (u.includes('/capabilities') ? respuestaJson(halColeccion([], 0)) : respuestaJson({ _type: 'Error' }, 403)));
    expect(await prohibido.cliente.puedeCrearProyectos(4)).toBe(false);
  });
  it('miembros pide de a 100 filtrando por proyecto y deja afuera los grupos', async () => {
    const { cliente, llamadas } = registrar(() => respuestaJson(halColeccion([
      { id: 1, _links: { principal: { href: '/api/v3/users/4' }, roles: [{ href: '/api/v3/roles/3', title: 'Member' }] } },
      { id: 2, _links: { principal: { href: '/api/v3/groups/8' }, roles: [] } },
    ], 2)));
    expect((await cliente.miembros(11)).map((m) => m.personaId)).toEqual([4]);
    const u = new URL(llamadas[0]!.url);
    expect(u.pathname).toBe('/api/v3/memberships');
    expect(u.searchParams.get('pageSize')).toBe('100');
    expect(JSON.parse(u.searchParams.get('filters')!)).toEqual([{ project: { operator: '=', values: ['11'] } }]);
  });
  it('rolesDeProyecto filtra por unit=project', async () => {
    const { cliente, llamadas } = registrar(() => respuestaJson(halColeccion([{ id: 3, name: 'Member' }], 1)));
    expect(await cliente.rolesDeProyecto()).toEqual([{ id: 3, nombre: 'Member' }]);
    expect(JSON.parse(new URL(llamadas[0]!.url).searchParams.get('filters')!)).toEqual([{ unit: { operator: '=', values: ['project'] } }]);
  });
  it('candidatos pide los usuarios activos que no son miembros', async () => {
    const { cliente, llamadas } = registrar(() => respuestaJson(halColeccion([{ _type: 'User', id: 7, name: 'Ana', login: 'ana' }], 1)));
    expect((await cliente.candidatos(11)).map((p) => p.id)).toEqual([7]);
    expect(JSON.parse(new URL(llamadas[0]!.url).searchParams.get('filters')!)).toEqual([
      { status: { operator: '=', values: ['1'] } }, { type: { operator: '=', values: ['User'] } }, { member: { operator: '!', values: ['11'] } },
    ]);
  });
  it('agregarMiembro manda persona y rol, y apaga el aviso por correo desde _meta', async () => {
    const { cliente, llamadas } = registrar(() => respuestaJson({ id: 9, _links: { principal: { href: '/api/v3/users/7' }, roles: [{ href: '/api/v3/roles/3', title: 'Member' }] } }, 201));
    expect((await cliente.agregarMiembro(11, 7, 3)).id).toBe(9);
    expect(llamadas[0]!.url).toBe('http://op.test/api/v3/memberships');
    expect(llamadas[0]!.cuerpo).toEqual({
      _meta: { sendNotifications: false },
      _links: { project: { href: '/api/v3/projects/11' }, principal: { href: '/api/v3/users/7' }, roles: [{ href: '/api/v3/roles/3' }] },
    });
  });
  it('cambiarRol y quitarMiembro', async () => {
    const { cliente, llamadas } = registrar((_u, i) => i.method === 'DELETE' ? new Response(null, { status: 204 })
      : respuestaJson({ id: 9, _links: { principal: { href: '/api/v3/users/7' }, roles: [{ href: '/api/v3/roles/5', title: 'Project admin' }] } }));
    expect((await cliente.cambiarRol(9, 5)).roles[0]!.id).toBe(5);
    await cliente.quitarMiembro(9);
    expect(llamadas.map((l) => `${l.metodo} ${l.url}`)).toEqual(['PATCH http://op.test/api/v3/memberships/9', 'DELETE http://op.test/api/v3/memberships/9']);
    expect(llamadas[0]!.cuerpo).toEqual({ _links: { roles: [{ href: '/api/v3/roles/5' }] } });
  });
  it('versiones del proyecto dice qué se puede hacer con cada una', async () => {
    const { cliente } = registrar(() => respuestaJson(halColeccion([
      halVersion(1, { updateImmediately: { href: '/x' }, delete: { href: '/x' } }), halVersion(2, {}),
    ], 2)));
    const v = await cliente.versiones(11);
    expect(v.map((x) => [x.id, x.puedeCambiar, x.puedeBorrar])).toEqual([[1, true, true], [2, false, false]]);
    expect(v[0]).toMatchObject({ estado: 'abierta', fin: '2026-11-30' });
  });
  it('puedeCrearVersion: el proyecto tiene que figurar en available_projects; 403 es que no', async () => {
    const con = registrar(() => respuestaJson(halColeccion([{ id: 11 }, { id: 2 }], 2))).cliente;
    const otro = registrar(() => respuestaJson(halColeccion([{ id: 2 }], 1))).cliente;
    const prohibido = registrar(() => respuestaJson({}, 403)).cliente;
    expect(await con.puedeCrearVersion(11)).toBe(true);
    expect(await otro.puedeCrearVersion(11)).toBe(false);
    expect(await prohibido.puedeCrearVersion(11)).toBe(false);
  });
  it('crearVersion, cambiarVersion y borrarVersion', async () => {
    const { cliente, llamadas } = registrar((_u, i) => i.method === 'DELETE' ? new Response(null, { status: 204 }) : respuestaJson(halVersion(6)));
    await cliente.crearVersion(11, { nombre: 'v1', inicio: '2026-11-01', fin: null });
    await cliente.cambiarVersion(6, { estado: 'cerrada', nombre: 'v2' });
    await cliente.borrarVersion(6);
    expect(llamadas[0]!.cuerpo).toEqual({ name: 'v1', startDate: '2026-11-01', endDate: null, _links: { definingProject: { href: '/api/v3/projects/11' } } });
    expect([llamadas[1]!.metodo, llamadas[1]!.url, llamadas[1]!.cuerpo]).toEqual(['PATCH', 'http://op.test/api/v3/versions/6', { name: 'v2', status: 'closed' }]);
    expect([llamadas[2]!.metodo, llamadas[2]!.url]).toEqual(['DELETE', 'http://op.test/api/v3/versions/6']);
  });
  it('borrar una versión con tareas da validacion', async () => {
    const { cliente } = registrar(() => respuestaJson({ message: 'The version cannot be deleted as it has work packages attached to it.' }, 422));
    await expect(cliente.borrarVersion(6)).rejects.toMatchObject({ tipo: 'validacion' });
  });
  it('crearProyecto manda solo el nombre', async () => {
    const { cliente, llamadas } = registrar(() => respuestaJson({ id: 30, name: 'Nuevo', identifier: 'nuevo' }, 201));
    expect((await cliente.crearProyecto('Nuevo')).identificador).toBe('nuevo');
    expect(llamadas[0]!.cuerpo).toEqual({ name: 'Nuevo' });
  });
  it('copiarProyecto manda todas las opciones del formulario en verdadero y lee el 303 sin seguirlo', async () => {
    const meta = { copyMembers: false, copyWorkPackages: false, copyVersions: false, sendNotifications: true };
    const { cliente, llamadas } = registrar((u) => u.endsWith('/copy/form')
      ? respuestaJson({ _embedded: { payload: { identifier: 'copia', name: 'Copia', _meta: meta }, validationErrors: {} } })
      : new Response(null, { status: 303, headers: { location: '/api/v3/job_statuses/abc-1' } }));
    expect(await cliente.copiarProyecto(17, 'Copia')).toBe('abc-1');
    expect(llamadas.map((l) => `${l.metodo} ${l.url}`)).toEqual(['POST http://op.test/api/v3/projects/17/copy/form', 'POST http://op.test/api/v3/projects/17/copy']);
    expect(llamadas[1]!.cuerpo).toEqual({ name: 'Copia', identifier: 'copia', _meta: { copyMembers: true, copyWorkPackages: true, copyVersions: true, sendNotifications: false } });
  });
  it('copiarProyecto con identificador repetido da validacion', async () => {
    const { cliente } = registrar((u) => u.endsWith('/copy/form')
      ? respuestaJson({ _embedded: { payload: { identifier: 'copia', name: 'Copia', _meta: {} }, validationErrors: {} } })
      : respuestaJson({ message: 'Identifier has already been taken.' }, 422));
    await expect(cliente.copiarProyecto(17, 'Copia')).rejects.toMatchObject({ tipo: 'validacion', message: 'Identifier has already been taken.' });
  });
  it('copiarProyecto sin Location en el 303 da un error', async () => {
    const { cliente } = registrar((u) => u.endsWith('/copy/form')
      ? respuestaJson({ _embedded: { payload: { name: 'C', _meta: {} } } })
      : new Response(null, { status: 303 }));
    await expect(cliente.copiarProyecto(17, 'C')).rejects.toBeDefined();
  });
  it('estadoCopia traduce el job', async () => {
    const job = (status: string, extra: Record<string, unknown> = {}) => registrar(() => respuestaJson({ status, ...extra })).cliente.estadoCopia('abc');
    expect(await job('in_queue')).toEqual({ estado: 'en-curso', proyectoId: null, errores: [] });
    expect(await job('in_process')).toMatchObject({ estado: 'en-curso' });
    expect(await job('success', { message: 'Created project X', payload: { _links: { project: { href: '/api/v3/projects/31' } } } }))
      .toEqual({ estado: 'listo', proyectoId: 31, errores: [] });
    expect(await job('success', { payload: { _links: { project: { href: '/api/v3/projects/31' } }, errors: ['Tarea 5 no se copió'] } }))
      .toMatchObject({ estado: 'listo', errores: ['Tarea 5 no se copió'] });
    expect(await job('failure', { message: 'Algo falló' })).toEqual({ estado: 'fallo', proyectoId: null, errores: ['Algo falló'] });
    expect(await job('cancelled')).toMatchObject({ estado: 'fallo' });
  });
  it('unionesEntre deja solo las uniones que cruzan entre los dos proyectos', async () => {
    const { cliente } = registrar((u) => {
      if (u.includes('/projects/1/work_packages')) return respuestaJson(halColeccion([{ id: 10 }, { id: 11 }], 2));
      if (u.includes('/projects/2/work_packages')) return respuestaJson(halColeccion([{ id: 20 }, { id: 21 }], 2));
      return respuestaJson(halColeccion([relacion(1, 'follows', 20, 21), relacion(2, 'follows', 20, 10), relacion(3, 'follows', 11, 21)], 3));
    });
    const cruzadas = await cliente.unionesEntre(1, 2);
    expect(cruzadas.map((d) => d.id).sort()).toEqual([2, 3]);
  });
  it('unionesEntre no pide uniones si algún proyecto no tiene tareas', async () => {
    const { cliente, llamadas } = registrar(() => respuestaJson(halColeccion([], 0)));
    expect(await cliente.unionesEntre(1, 2)).toEqual([]);
    expect(llamadas.some((l) => l.url.includes('/relations'))).toBe(false);
  });
});
