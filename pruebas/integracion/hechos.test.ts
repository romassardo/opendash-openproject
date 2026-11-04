// Supuestos de la app que las pruebas unitarias no podían confirmar, medidos contra OpenProject 16.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { duracionDeHoras, horasDeDuracion } from '../../servidor/openproject/mapeo.js';
import { crearClienteOp, type ClienteOp } from '../../servidor/openproject/cliente.js';
import { api } from '../../scripts/op-prueba.js';
import { admin, borrarProyecto, cfg, crearProyecto, crearTareaCruda, crearVersion, cruda, enlace, hecho, lineaDe, rails } from './ayudas.js';

// Usuario sin permisos que se crea solo en el Docker de prueba; estos valores no son secretos reales.
const LOGIN_RESTRINGIDO_SOLO_PRUEBA = 'restringido';
const CLAVE_RESTRINGIDO_SOLO_PRUEBA = 'Passw0rd!Passw0rd!x';

let proyectoId = 0;
beforeAll(async () => {
  proyectoId = await crearProyecto(`int-hechos-${Date.now()}`, 'Integración hechos');
});
afterAll(async () => {
  if (proyectoId !== 0) await borrarProyecto(proyectoId);
});

describe('¿un comentario sube el lockVersion?', () => {
  it('no: comentar y después guardar con el lockVersion anterior da 200 (tarea nueva y tarea ya editada)', async () => {
    const t = await crearTareaCruda(proyectoId, 'Lock y comentarios');
    // Tarea recién creada.
    await admin.comentar(t.id, 'comentario 1');
    const trasComentar = await admin.tarea(t.id);
    hecho('lockVersion: creada / tras comentar', [t.lockVersion, trasComentar.lockVersion]);
    expect(trasComentar.lockVersion).toBe(t.lockVersion);
    const guardada = await admin.actualizarTarea(t.id, t.lockVersion, { titulo: 'Guardada con lock previo al comentario' });
    expect(guardada.titulo).toBe('Guardada con lock previo al comentario');

    // Tarea ya editada (con historial de cambios): mismo resultado.
    await admin.comentar(t.id, 'comentario 2');
    const trasSegundo = await admin.tarea(t.id);
    expect(trasSegundo.lockVersion).toBe(guardada.lockVersion);
    const otra = await admin.actualizarTarea(t.id, guardada.lockVersion, { titulo: 'Otra vez' });
    expect(otra.lockVersion).toBeGreaterThan(guardada.lockVersion);
  });
});

describe('serialización de estimatedTime', () => {
  const casos: Array<[number, string]> = [
    [2, 'PT2H'],
    [1.5, 'PT1H30M'],
    [24, 'P1D'],
    [40, 'P1DT16H'],
    [168, 'P7D'],
    [200, 'P8DT8H'],
  ];
  it.each(casos)('%s h vuelve como %s y horasDeDuracion lo entiende', async (horas, esperado) => {
    const t = await crearTareaCruda(proyectoId, `Estimada ${horas}`);
    expect(duracionDeHoras(horas).length).toBeGreaterThan(0);
    const { json, estado } = await cruda('PATCH', `/api/v3/work_packages/${t.id}`, { lockVersion: t.lockVersion, estimatedTime: duracionDeHoras(horas) });
    expect(estado).toBe(200);
    hecho(`estimatedTime ${horas} h (enviado ${duracionDeHoras(horas)})`, json.estimatedTime);
    expect(json.estimatedTime).toBe(esperado);
    expect(horasDeDuracion(json.estimatedTime)).toBe(horas);
    expect((await admin.tarea(t.id)).estimacionHoras).toBe(horas);
  });
});

describe('versiones compartidas con subproyectos', () => {
  it('el hijo ve la versión del padre y su definingProject es el padre', async () => {
    const padre = await crearProyecto(`int-padre-${Date.now()}`, 'Integración padre');
    const hijo = await crearProyecto(`int-hijo-${Date.now()}`, 'Integración hijo', padre);
    try {
      const version = await crearVersion(padre, 'Compartida', { sharing: 'descendants' });
      const { estado, json } = await cruda('GET', `/api/v3/projects/${hijo}/versions`);
      expect(estado).toBe(200);
      const v = json._embedded.elements.find((e: { id: number }) => e.id === version.id);
      hecho('versión compartida vista desde el hijo', { definingProject: v?._links.definingProject.href });
      expect(v?._links.definingProject.href).toBe(`/api/v3/projects/${padre}`);
      // La app la guarda con el proyecto que la define (aVersion lee definingProject) y la ve cada proyecto con acceso.
      const catalogo = await admin.catalogo();
      expect(catalogo.versiones.find((x) => x.id === version.id)).toMatchObject({ nombre: 'Compartida', proyectoId: padre });
      // Una tarea del hijo puede usarla.
      const t = await crearTareaCruda(hijo, 'Hijo con versión del padre', {}, { version: enlace('versions', version.id) });
      expect((await admin.tarea(t.id)).versionId).toBe(version.id);
    } finally {
      await borrarProyecto(hijo);
      await borrarProyecto(padre);
    }
  });
});

describe('puedeLeerTareas con un usuario restringido', () => {
  let restringido: ClienteOp;
  let tokenRestringido = '';
  beforeAll(() => {
    // Credenciales SOLO DE PRUEBA: usuario descartable del Docker local (nunca existen en el OpenProject real).
    // Se revocan los tokens anteriores y se crea uno nuevo: queda siempre uno solo por usuario.
    const salida = rails(`
      u = User.find_by(login: '${LOGIN_RESTRINGIDO_SOLO_PRUEBA}') || User.new(login: '${LOGIN_RESTRINGIDO_SOLO_PRUEBA}', firstname: 'Res', lastname: 'Tringido', mail: 'restringido@example.com')
      u.password = '${CLAVE_RESTRINGIDO_SOLO_PRUEBA}'
      u.password_confirmation = '${CLAVE_RESTRINGIDO_SOLO_PRUEBA}'
      u.admin = false
      u.save!
      u.update_column(:status, Principal.statuses[:active])
      Token::API.where(user_id: u.id).destroy_all
      puts "TOKEN_RES=#{Token::API.create!(user: u).plain_value}"
    `);
    tokenRestringido = lineaDe(salida, 'TOKEN_RES');
    restringido = crearClienteOp({ baseUrl: cfg.url, token: tokenRestringido });
  });

  it('true en un proyecto público; false en uno privado donde no es miembro (404, no 403)', async () => {
    const visibles = await restringido.proyectos();
    hecho('proyectos que ve el restringido', visibles.map((p) => p.identificador));
    expect(visibles.some((p) => p.id === cfg.proyectoId)).toBe(false);
    expect(visibles.length).toBeGreaterThan(0);
    for (const p of visibles) expect(await restringido.puedeLeerTareas(p.id)).toBe(true);
    expect(await restringido.puedeLeerTareas(cfg.proyectoId)).toBe(false);
    const crudo = await api(cfg.url, tokenRestringido, 'GET', `/api/v3/projects/${cfg.proyectoId}/work_packages?pageSize=1&filters=%5B%5D`);
    hecho('GET work_packages de un proyecto privado ajeno', crudo.estado);
    expect(crudo.estado).toBe(404);
    expect(await admin.puedeLeerTareas(cfg.proyectoId)).toBe(true);
  });

  it('tareas() del restringido no incluye las del proyecto privado', async () => {
    const mias = (await restringido.tareas()).tareas;
    expect(mias.some((t) => t.proyectoId === cfg.proyectoId)).toBe(false);
    await expect(restringido.tarea(cfg.tareas[0]!)).rejects.toMatchObject({ tipo: 'no-encontrado' });
  });
});

describe('proyectos archivados', () => {
  it('un proyecto archivado sigue en /projects (activo=false) y sus versiones dan 403, pero catalogo() carga igual', async () => {
    const id = await crearProyecto(`int-archivado-${Date.now()}`, 'Integración archivado');
    try {
      const arch = await cruda('PATCH', `/api/v3/projects/${id}`, { active: false });
      hecho('archivar con PATCH active=false', arch.estado);
      expect(arch.estado).toBe(200);
      const listado = (await admin.proyectos()).find((p) => p.id === id);
      expect(listado).toMatchObject({ activo: false });
      const versiones = await cruda('GET', `/api/v3/projects/${id}/versions`);
      hecho('versiones de un proyecto archivado', versiones.estado);
      expect(versiones.estado).toBe(403);
      // catalogo() omite los inactivos y carga completo (arreglo Ruling 24).
      const catalogo = await admin.catalogo();
      expect(catalogo.proyectos.some((p) => p.id === id && !p.activo)).toBe(true);
      expect(catalogo.versiones.filter((v) => v.proyectoId === cfg.proyectoId)).toHaveLength(2);
    } finally {
      await borrarProyecto(id);
    }
    await expect(admin.catalogo()).resolves.toBeDefined();
  });
});

describe('proyectos plantilla', () => {
  it('el filtro templated=t se acepta: catalogo() trae plantillasOp con los proyectos marcados', async () => {
    const id = await crearProyecto(`int-plantilla-${Date.now()}`, 'Integración plantilla');
    try {
      // La API v3 ignora `templated` en un PATCH (responde 200 sin marcarlo): se marca por Rails.
      rails(`Project.find(${id}).update_column(:templated, true)
puts 'MARCADO'
`);
      const filtrada = await cruda('GET', `/api/v3/projects?filters=${encodeURIComponent(JSON.stringify([{ templated: { operator: '=', values: ['t'] } }]))}`);
      hecho('filtro templated=t', filtrada.estado);
      expect(filtrada.estado).toBe(200);
      const catalogo = await admin.catalogo();
      expect(catalogo.plantillasOp).toContain(id);
      expect(catalogo.plantillasOp).not.toContain(cfg.proyectoId);
    } finally {
      await borrarProyecto(id);
    }
  });
});

describe('avatar', () => {
  it('OpenProject responde 302 hacia Gravatar (otro origen): el cliente devuelve null y no manda el token afuera', async () => {
    const yo = await admin.yo();
    const res = await fetch(`${cfg.url}/api/v3/users/${yo.id}/avatar`, {
      redirect: 'manual',
      headers: { Authorization: `Basic ${Buffer.from(`apikey:${cfg.token}`).toString('base64')}` },
    });
    await res.body?.cancel();
    hecho('GET /users/{id}/avatar', { estado: res.status, tipo: res.headers.get('content-type'), location: res.headers.get('location') });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).origin).not.toBe(cfg.url);
    expect(await admin.avatar(yo.id)).toBeNull();
  });
});
