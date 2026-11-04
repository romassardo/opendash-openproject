// Ayudas de las pruebas de integración: leen pruebas/e2e/.op-prueba.json (lo escribe
// `npx tsx scripts/preparar-op-prueba.ts`) y hablan solo con el OpenProject de Docker.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api, asegurarLocal, ejecutarRails, lineaDe } from '../../scripts/op-prueba.js';
import { crearClienteOp, type ClienteOp } from '../../servidor/openproject/cliente.js';
import type { CatalogoOp } from '../../compartido/tipos.js';

const RUTA_CONFIG = fileURLToPath(new URL('../e2e/.op-prueba.json', import.meta.url));

export interface ConfigPrueba { url: string; token: string; proyectoId: number; versiones: Record<string, number>; tareas: number[];
  /** Proyecto marcado como plantilla, con tres tareas y una unión (lo siembra `preparar-op-prueba.ts`). */
  plantilla: { plantillaId: number; tareas: number[] } }

function leerConfig(): ConfigPrueba {
  if (!existsSync(RUTA_CONFIG)) {
    throw new Error('Falta pruebas/e2e/.op-prueba.json: levantá el OpenProject de prueba (docker compose -f docker-compose.prueba.yml up -d && npx tsx scripts/preparar-op-prueba.ts)');
  }
  const cfg = JSON.parse(readFileSync(RUTA_CONFIG, 'utf8')) as ConfigPrueba;
  asegurarLocal(cfg.url);
  return cfg;
}

export const cfg = leerConfig();
export const admin: ClienteOp = crearClienteOp({ baseUrl: cfg.url, token: cfg.token });

/** Llamada cruda a la API con el token de admin. */
export const cruda = (metodo: string, ruta: string, cuerpo?: unknown) => api(cfg.url, cfg.token, metodo, ruta, cuerpo);

/** Registra un hecho observado (se ve con el reporter verbose). */
export function hecho(nombre: string, valor: unknown): void {
  console.info(`HECHO ${nombre}: ${typeof valor === 'string' ? valor : JSON.stringify(valor)}`);
}

/** Forma mínima de lo que devuelve la API HAL y que las pruebas leen. */
export interface Hal {
  id: number; lockVersion: number; total: number; lag: number | null; updatedAt: string;
  _embedded: { elements: Array<{ id: number; name: string }> };
  [clave: string]: unknown;
}

export const enlace = (recurso: string, id: number) => ({ href: `/api/v3/${recurso}/${id}` });

export async function exigir(metodo: string, ruta: string, cuerpo?: unknown): Promise<Hal> {
  const { estado, json } = await cruda(metodo, ruta, cuerpo);
  if (estado >= 400) throw new Error(`${metodo} ${ruta} -> ${estado}: ${JSON.stringify(json).slice(0, 600)}`);
  return json;
}

export async function crearProyecto(identificador: string, nombre: string, padreId?: number): Promise<number> {
  const cuerpo: Record<string, unknown> = { name: nombre, identifier: identificador };
  if (padreId !== undefined) cuerpo._links = { parent: enlace('projects', padreId) };
  const id = (await exigir('POST', '/api/v3/projects', cuerpo)).id;
  // Hallado en 16.x: un admin que no es miembro del proyecto no puede figurar como responsable de una tarea.
  const yo = (await exigir('GET', '/api/v3/users/me')).id;
  const roles = (await exigir('GET', '/api/v3/roles?pageSize=100'))._embedded.elements;
  const rol = roles.find((r) => r.name === 'Project admin');
  if (!rol) throw new Error('No hay rol «Project admin»');
  await exigir('POST', '/api/v3/memberships', {
    _links: { project: enlace('projects', id), principal: enlace('users', yo), roles: [enlace('roles', rol.id)] },
  });
  return id;
}

/**
 * Borra el proyecto. La API responde 204 y lo borra en segundo plano; mientras tanto queda archivado y
 * visible (con las versiones en 403), lo que rompería catalogo() en la prueba siguiente: se espera a que
 * desaparezca y, si el trabajo no lo borra, se destruye con rails runner.
 */
export async function borrarProyecto(id: number): Promise<void> {
  await cruda('DELETE', `/api/v3/projects/${id}`);
  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    if ((await cruda('GET', `/api/v3/projects/${id}`)).estado === 404) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  rails(`Project.find_by(id: ${id})&.destroy\nputs 'BORRADO'\n`);
}

export async function crearVersion(proyectoId: number, nombre: string, extra: Record<string, unknown> = {}): Promise<Hal> {
  return exigir('POST', '/api/v3/versions', { name: nombre, ...extra, _links: { definingProject: enlace('projects', proyectoId) } });
}

export async function crearTareaCruda(proyectoId: number, titulo: string, extra: Record<string, unknown> = {}, enlaces: Record<string, unknown> = {}): Promise<Hal> {
  return exigir('POST', '/api/v3/work_packages', {
    subject: titulo,
    ...extra,
    _links: { project: enlace('projects', proyectoId), ...enlaces },
  });
}

export function rails(ruby: string): string {
  return ejecutarRails(ruby);
}
export { lineaDe };

export function idEstado(catalogo: CatalogoOp, nombre: string): number {
  const e = catalogo.estados.find((x) => x.nombre === nombre);
  if (!e) throw new Error(`No hay estado «${nombre}»`);
  return e.id;
}

/**
 * Crea (o reutiliza) un usuario de prueba con un rol en el proyecto y devuelve un cliente con su token.
 * El rol es uno de los de OpenProject: «Project admin», «Member» o «Reader».
 */
export async function clienteConRol(rol: 'Project admin' | 'Member' | 'Reader', proyectoId: number): Promise<ClienteOp> {
  return crearClienteOp({ baseUrl: cfg.url, token: await tokenConRol(rol, proyectoId) });
}

/** Igual que `clienteConRol`, pero devuelve el token (para registrar a esa persona en la app propia). */
export async function tokenConRol(rol: 'Project admin' | 'Member' | 'Reader', proyectoId: number): Promise<string> {
  const login = `prueba-${rol.toLowerCase().replace(/\s+/g, '-')}`;
  const salida = rails([
    `u = User.find_by(login: '${login}')`,
    `u ||= User.new(login: '${login}', firstname: 'Prueba', lastname: '${rol}', mail: '${login}@prueba.local', admin: false, status: 1, password: 'Prueba-clave-123456', password_confirmation: 'Prueba-clave-123456', force_password_change: false)`,
    'u.save!',
    `r = Role.find_by!(name: '${rol}')`,
    `p = Project.find(${proyectoId})`,
    'Member.where(project: p, principal: u).destroy_all',
    'Members::CreateService.new(user: User.find_by!(login: \'admin\'), contract_class: EmptyContract).call(project: p, principal: u, roles: [r])',
    'puts "TOKEN_PRUEBA=#{Token::API.create!(user: u).plain_value}"',
  ].join('\n') + '\n');
  return lineaDe(salida, 'TOKEN_PRUEBA');
}

/** Saca a esa persona de un proyecto (para dejar el proyecto como estaba). */
export function quitarMembresia(rol: 'Project admin' | 'Member' | 'Reader', proyectoId: number): void {
  const login = `prueba-${rol.toLowerCase().replace(/\s+/g, '-')}`;
  rails(`Member.where(project_id: ${proyectoId}, principal: User.find_by(login: '${login}')).destroy_all
puts 'QUITADO'
`);
}
