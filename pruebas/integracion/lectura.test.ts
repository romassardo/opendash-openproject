// Camino de lectura del cliente real contra el OpenProject de Docker (OpenProject 16).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, borrarProyecto, cfg, crearProyecto, crearTareaCruda, cruda, enlace, exigir, hecho, rails } from './ayudas.js';

const MASIVAS = 105;
let proyectoMasivo = 0;

beforeAll(async () => {
  proyectoMasivo = await crearProyecto(`int-lectura-${Date.now()}`, 'Integración lectura');
  // 105 tareas de una vez con rails runner (por API serían 105 llamadas); alcanza para forzar dos páginas de 100.
  rails(`
    p = Project.find(${proyectoMasivo})
    u = User.find_by!(login: 'admin')
    t = Type.find_by!(name: 'Task')
    s = Status.find_by!(name: 'New')
    pr = IssuePriority.find_by!(name: 'Normal')
    ${MASIVAS}.times { |i| WorkPackage.create!(project: p, type: t, status: s, priority: pr, author: u, subject: "Masiva \#{i}") }
    puts 'MASIVAS_OK'
  `);
});

afterAll(async () => {
  if (proyectoMasivo !== 0) await borrarProyecto(proyectoMasivo);
});

describe('lectura contra OpenProject 16', () => {
  it('yo(): trae login y nombre del admin', async () => {
    const yo = await admin.yo();
    expect(yo.login).toBe('admin');
    expect(yo.id).toBeGreaterThan(0);
  });

  it('catalogo(): estados, tipos, prioridades, proyectos, versiones y personas con los nombres que usa la app', async () => {
    const c = await admin.catalogo();
    const estados = Object.fromEntries(c.estados.map((e) => [e.nombre, e.cerrado]));
    hecho('estados', estados);
    // La app busca estos nombres en inglés; los dos cerrados de fábrica son Closed y Rejected.
    expect(estados).toMatchObject({ New: false, 'In progress': false, 'On hold': false, Closed: true, Rejected: true });
    hecho('tipos', c.tipos.map((t) => `${t.nombre}${t.esHito ? '(hito)' : ''}`));
    expect(c.tipos.find((t) => t.nombre === 'Task')?.esHito).toBe(false);
    expect(c.tipos.find((t) => t.nombre === 'Milestone')?.esHito).toBe(true);
    hecho('prioridades', c.prioridades.map((p) => `${p.nombre}${p.alta ? '(alta)' : ''}`));
    expect(c.prioridades.filter((p) => p.alta).map((p) => p.nombre).sort()).toEqual(['High', 'Immediate']);
    expect(c.proyectos.some((p) => p.id === cfg.proyectoId)).toBe(true);
    const versionesPrueba = c.versiones.filter((v) => v.proyectoId === cfg.proyectoId).map((v) => v.nombre).sort();
    expect(versionesPrueba).toEqual(['En curso', 'Finalizado']);
    const adminPersona = c.personas.find((p) => p.login === 'admin');
    expect(adminPersona).toBeDefined();
    // `avatar` viene como URL de Gravatar (otro origen): la app no la usa directamente.
    hecho('avatar del admin en /principals', adminPersona?.avatarUrl ?? null);
  });

  it('asignables(): available_assignees del proyecto de prueba incluye al admin', async () => {
    const personas = (await admin.asignables(cfg.proyectoId)) ?? [];
    hecho('asignables de Prueba', personas.map((p) => p.login));
    expect(personas.some((p) => p.login === 'admin')).toBe(true);
  });

  it('proyectos(): incluye Prueba como activo', async () => {
    const proyectos = await admin.proyectos();
    const prueba = proyectos.find((p) => p.id === cfg.proyectoId);
    expect(prueba).toMatchObject({ nombre: 'Prueba', identificador: 'prueba', activo: true });
  });

  it(`tareas(): recorre más de una página (${MASIVAS}+ tareas con pageSize=100)`, async () => {
    const todas = (await admin.tareas()).tareas;
    const masivas = todas.filter((t) => t.proyectoId === proyectoMasivo);
    hecho('total de tareas leídas', todas.length);
    expect(todas.length).toBeGreaterThan(100);
    expect(masivas).toHaveLength(MASIVAS);
    expect(new Set(todas.map((t) => t.id)).size).toBe(todas.length); // sin repetidas entre páginas
  });

  it('tareas({ actualizadasDesde }): el filtro incremental trae solo lo cambiado', async () => {
    // Todo se mide en el proyecto de este archivo y con la hora del servidor (no la del equipo), así
    // que otras escrituras en la instancia no cambian el resultado.
    const previa = await crearTareaCruda(proyectoMasivo, 'Previa');
    await new Promise((r) => setTimeout(r, 1500));
    const nueva = await crearTareaCruda(proyectoMasivo, 'Incremental', {}, { type: enlace('types', 1) });
    const cambiadas = (await admin.tareas({ actualizadasDesde: new Date(Date.parse(previa.updatedAt) + 1000).toISOString() }))
      .tareas.filter((t) => t.proyectoId === proyectoMasivo);
    hecho('filtro incremental (en este proyecto)', cambiadas.map((t) => t.id));
    expect(cambiadas.map((t) => t.id)).toEqual([nueva.id]); // ni las 105 masivas ni la previa
  });

  it('tarea(): mapea la tarea sembrada con responsable, fechas y madre', async () => {
    const [t1, , t3, t4] = cfg.tareas as [number, number, number, number];
    const uno = await admin.tarea(t1);
    expect(uno).toMatchObject({ titulo: 'Tarea de prueba 1', inicio: '2026-10-19', fin: '2026-10-23', proyectoId: cfg.proyectoId });
    expect(uno.responsableId).not.toBeNull();
    expect((await admin.tarea(t3)).madreId).toBe(t1);
    const cuatro = await admin.tarea(t4);
    expect(cuatro).toMatchObject({ responsableId: null, inicio: null, fin: null, madreId: null });
  });

  it('dependencias(): las dos «follows» sembradas', async () => {
    const [t1, t2, , , t5] = cfg.tareas as [number, number, number, number, number];
    const deps = (await admin.dependencias()).filter((d) => d.predecesoraId === t1);
    expect(deps.map((d) => d.sucesoraId).sort()).toEqual([t2, t5].sort());
  });

  it('dependencias(): el campo de demora en 16.x se llama `lag` (null sin demora, número con demora) y aDependencia lo mapea', async () => {
    const a = await crearTareaCruda(cfg.proyectoId, 'Lag A');
    const b = await crearTareaCruda(cfg.proyectoId, 'Lag B');
    const c = await crearTareaCruda(cfg.proyectoId, 'Lag C');
    const sinDemora = await exigir('POST', `/api/v3/work_packages/${b.id}/relations`, { type: 'follows', _links: { to: enlace('work_packages', a.id) } });
    const conDemora = await exigir('POST', `/api/v3/work_packages/${c.id}/relations`, { type: 'follows', lag: 3, _links: { to: enlace('work_packages', a.id) } });
    hecho('relación sin demora', { lag: sinDemora.lag, delay: sinDemora.delay ?? '(no existe)' });
    hecho('relación con demora', { lag: conDemora.lag, delay: conDemora.delay ?? '(no existe)' });
    expect(sinDemora.lag).toBeNull();
    expect(conDemora.lag).toBe(3);
    expect(sinDemora).not.toHaveProperty('delay');
    const deps = await admin.dependencias();
    expect(deps.find((d) => d.id === sinDemora.id)).toMatchObject({ sucesoraId: b.id, predecesoraId: a.id, lag: 0 });
    expect(deps.find((d) => d.id === conDemora.id)).toMatchObject({ sucesoraId: c.id, predecesoraId: a.id, lag: 3 });
    for (const id of [a.id, b.id, c.id]) await cruda('DELETE', `/api/v3/work_packages/${id}`);
  });

  it('actividades(): devuelve el historial de una tarea', async () => {
    const actividades = await admin.actividades(cfg.tareas[0]!);
    hecho('actividades de la tarea 1', actividades.length);
    expect(actividades.length).toBeGreaterThan(0);
    expect(actividades[0]).toMatchObject({ id: expect.any(Number), creada: expect.any(String) });
  });

  it('notificaciones(): la lectura funciona (puede venir vacía en una instancia nueva)', async () => {
    const notificaciones = await admin.notificaciones();
    hecho('notificaciones del admin', notificaciones.length);
    expect(Array.isArray(notificaciones)).toBe(true);
  });
});
