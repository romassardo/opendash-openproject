// Proyectos, miembros y versiones del cliente real contra el OpenProject de Docker (OpenProject 16).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClienteOp } from '../../servidor/openproject/cliente.js';
import { ErrorOp } from '../../servidor/openproject/errores.js';
import { admin, borrarProyecto, cfg, clienteConRol, crearProyecto, crearTareaCruda, cruda, enlace, exigir } from './ayudas.js';

const plantillaId = cfg.plantilla.plantillaId;

let proyectoId = 0;
let adminId = 0;
let miembro: ClienteOp;
let miembroId = 0;
let lector: ClienteOp;
let lectorId = 0;
const proyectosACerrar: number[] = [];

const idDe = async (c: ClienteOp): Promise<number> => (await c.yo()).id;
const esperarCopia = async (jobId: string) => {
  for (let i = 0; i < 90; i++) {
    const t = await admin.estadoCopia(jobId);
    if (t.estado !== 'en-curso') return t;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('La copia no terminó en 90 s');
};

beforeAll(async () => {
  proyectoId = await crearProyecto(`int-proy-${Date.now()}`, 'Integración proyectos');
  adminId = await idDe(admin);
  miembro = await clienteConRol('Member', proyectoId);
  lector = await clienteConRol('Reader', proyectoId);
  miembroId = await idDe(miembro);
  lectorId = await idDe(lector);
});

afterAll(async () => {
  for (const id of [proyectoId, ...proyectosACerrar]) if (id !== 0) await borrarProyecto(id);
});

describe('miembros contra OpenProject 16', () => {
  it('agregar, cambiar rol y quitar un miembro como Project admin', async () => {
    const roles = await admin.rolesDeProyecto();
    const rolMember = roles.find((r) => r.nombre === 'Member')!;
    const rolAdmin = roles.find((r) => r.nombre === 'Project admin')!;
    expect(roles.map((r) => r.nombre).sort()).toEqual(['Member', 'Project admin', 'Reader']);

    const candidatos = await admin.candidatos(proyectoId);
    const ids = candidatos.map((p) => p.id);
    expect(ids).not.toContain(adminId);
    expect(ids).not.toContain(miembroId);

    const otroId = ids.find((id) => id !== miembroId && id !== lectorId)!;
    const nuevo = await admin.agregarMiembro(proyectoId, otroId, rolMember.id);
    expect(nuevo).toMatchObject({ personaId: otroId, roles: [{ id: rolMember.id }] });
    expect((await admin.miembros(proyectoId)).map((m) => m.personaId)).toContain(otroId);
    expect((await admin.candidatos(proyectoId)).map((p) => p.id)).not.toContain(otroId);

    const cambiado = await admin.cambiarRol(nuevo.id, rolAdmin.id);
    expect(cambiado.roles.map((r) => r.nombre)).toEqual(['Project admin']);

    await admin.quitarMiembro(nuevo.id);
    expect((await admin.miembros(proyectoId)).map((m) => m.personaId)).not.toContain(otroId);
  });

  it('el cuerpo de agregarMiembro apaga el aviso por correo desde _meta (el formulario lo devuelve así)', async () => {
    const rolMember = (await admin.rolesDeProyecto()).find((r) => r.nombre === 'Member')!;
    const otroId = (await admin.candidatos(proyectoId))[0]!.id;
    const { estado, json } = await cruda('POST', '/api/v3/memberships/form', {
      _meta: { sendNotifications: false },
      _links: { project: enlace('projects', proyectoId), principal: enlace('users', otroId), roles: [enlace('roles', rolMember.id)] },
    });
    expect(estado).toBe(200);
    expect((json as { _embedded: { payload: { _meta: { sendNotifications: boolean } } } })._embedded.payload._meta.sendNotifications).toBe(false);
  });

  it('tareasAbiertasDe trae las abiertas de la persona en ese proyecto y deja las cerradas', async () => {
    const abierta = await crearTareaCruda(proyectoId, 'Abierta de admin', {}, { assignee: enlace('users', adminId) });
    const cerrada = await crearTareaCruda(proyectoId, 'Cerrada de admin', {}, { assignee: enlace('users', adminId) });
    const cerrado = (await admin.catalogo()).estados.find((e) => e.cerrado)!;
    await exigir('PATCH', `/api/v3/work_packages/${cerrada.id}`, { lockVersion: cerrada.lockVersion, _links: { status: enlace('statuses', cerrado.id) } });
    const ids = (await admin.tareasAbiertasDe(proyectoId, adminId)).map((t) => t.id);
    expect(ids).toContain(abierta.id);
    expect(ids).not.toContain(cerrada.id);
    expect(await admin.tareasAbiertasDe(proyectoId, miembroId)).toEqual([]);
  });

  it('Member: capacidades en falso y alta da prohibido', async () => {
    const caps = await miembro.capacidades(miembroId, proyectoId);
    expect(caps).toEqual({ crearMiembro: false, cambiarMiembro: false, quitarMiembro: false, copiarProyecto: false });
    const roles = await admin.rolesDeProyecto();
    const otroId = (await admin.candidatos(proyectoId)).find((p) => p.id !== lectorId)!.id;
    const error = await miembro.agregarMiembro(proyectoId, otroId, roles[0]!.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorOp);
    expect((error as ErrorOp).tipo).toBe('prohibido');
    expect(await miembro.puedeCrearProyectos(miembroId)).toBe(false);
  });

  it('Project admin: capacidades de miembros y de copia en verdadero', async () => {
    const caps = await admin.capacidades(adminId, proyectoId);
    expect(caps).toEqual({ crearMiembro: true, cambiarMiembro: true, quitarMiembro: true, copiarProyecto: true });
    expect(await admin.puedeCrearProyectos(adminId)).toBe(true);
  });
});

describe('versiones contra OpenProject 16', () => {
  it('crear, cerrar y borrar una versión vacía', async () => {
    expect(await admin.puedeCrearVersion(proyectoId)).toBe(true);
    const v = await admin.crearVersion(proyectoId, { nombre: 'Sprint 1', inicio: '2026-11-02', fin: '2026-11-13' });
    expect(v).toMatchObject({ nombre: 'Sprint 1', proyectoId, estado: 'abierta', inicio: '2026-11-02', fin: '2026-11-13' });

    const cerrada = await admin.cambiarVersion(v.id, { estado: 'cerrada', fin: '2026-11-20' });
    expect(cerrada).toMatchObject({ estado: 'cerrada', fin: '2026-11-20' });

    const listada = (await admin.versiones(proyectoId)).find((x) => x.id === v.id)!;
    expect(listada).toMatchObject({ estado: 'cerrada', puedeCambiar: true, puedeBorrar: true });

    await admin.borrarVersion(v.id);
    expect((await admin.versiones(proyectoId)).map((x) => x.id)).not.toContain(v.id);
  });

  it('borrar una con tareas da validacion', async () => {
    const v = await admin.crearVersion(proyectoId, { nombre: 'Con tareas', inicio: null, fin: null });
    await crearTareaCruda(proyectoId, 'Tarea en versión', {}, { version: { href: `/api/v3/versions/${v.id}` } });
    const error = await admin.borrarVersion(v.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorOp);
    expect((error as ErrorOp).tipo).toBe('validacion');
  });

  it('Reader y Member: no pueden crear versiones ni cambiarlas', async () => {
    expect(await lector.puedeCrearVersion(proyectoId)).toBe(false);
    expect(await miembro.puedeCrearVersion(proyectoId)).toBe(false);
    const vistas = await lector.versiones(proyectoId);
    expect(vistas.every((v) => !v.puedeCambiar && !v.puedeBorrar)).toBe(true);
  });
});

describe('proyectos contra OpenProject 16', () => {
  it('crear un proyecto vacío', async () => {
    const nombre = `Vacío ${Date.now()}`;
    const p = await admin.crearProyecto(nombre);
    proyectosACerrar.push(p.id);
    expect(p).toMatchObject({ nombre, activo: true });
    expect(p.identificador).toMatch(/^vac/);
  });

  it('copiar la plantilla: job listo, tareas y unión copiadas, sin uniones cruzadas', async () => {
    const nombre = `Copia ${Date.now()}`;
    const jobId = await admin.copiarProyecto(plantillaId, nombre);
    const trabajo = await esperarCopia(jobId);
    expect(trabajo.estado).toBe('listo');
    expect(trabajo.errores).toEqual([]);
    expect(trabajo.proyectoId).not.toBeNull();
    proyectosACerrar.push(trabajo.proyectoId!);

    const copiadas = (await admin.tareas()).tareas.filter((t) => t.proyectoId === trabajo.proyectoId);
    expect(copiadas.map((t) => t.titulo).sort()).toEqual(['Plantilla 1', 'Plantilla 2', 'Plantilla 3']);

    const ids = new Set(copiadas.map((t) => t.id));
    const dependencias = await admin.dependencias();
    expect(dependencias.filter((d) => ids.has(d.sucesoraId) && ids.has(d.predecesoraId))).toHaveLength(1);
    expect(await admin.unionesEntre(plantillaId, trabajo.proyectoId!)).toEqual([]);

    // Con el mismo nombre OpenProject arma otro identificador (con «-1») en vez de rechazar la copia.
    const segunda = await esperarCopia(await admin.copiarProyecto(plantillaId, nombre));
    expect(segunda.estado).toBe('listo');
    proyectosACerrar.push(segunda.proyectoId!);
    expect(segunda.proyectoId).not.toBe(trabajo.proyectoId);
  });

  it('el catálogo marca la plantilla como plantilla', async () => {
    const hal = await exigir('GET', `/api/v3/projects/${plantillaId}`);
    expect(hal.id).toBe(plantillaId);
    expect((await admin.catalogo()).plantillasOp).toContain(plantillaId);
  });
});
