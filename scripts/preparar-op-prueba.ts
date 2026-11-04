// Prepara el OpenProject de prueba (docker-compose.prueba.yml): espera a que arranque, crea un token
// de admin con rails runner, siembra el proyecto «Prueba» y escribe pruebas/e2e/.op-prueba.json.
// Uso: npx tsx scripts/preparar-op-prueba.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, ejecutarRails, esperarOp, lineaDe, URL_OP_PRUEBA } from './op-prueba.js';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = resolve(raiz, 'pruebas/e2e/.op-prueba.json');

async function pedir(token: string, metodo: string, ruta: string, cuerpo?: unknown): Promise<any> {
  const { estado, json } = await api(URL_OP_PRUEBA, token, metodo, ruta, cuerpo);
  if (estado >= 400) throw new Error(`${metodo} ${ruta} -> ${estado}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

const enlace = (recurso: string, id: number) => ({ href: `/api/v3/${recurso}/${id}` });

async function idPorNombre(token: string, recurso: string, nombre: string): Promise<number> {
  const col = await pedir(token, 'GET', `/api/v3/${recurso}?pageSize=100`);
  const hallado = col._embedded.elements.find((e: { name: string }) => e.name === nombre);
  if (!hallado) throw new Error(`No hay ${recurso} «${nombre}»`);
  return hallado.id;
}

const hoyArgentina = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de hoy: la línea de tiempo arranca la semana anterior, así que esa semana siempre se ve. */
function lunesDeEstaSemana(): string {
  const hoy = hoyArgentina();
  const dia = new Date(`${hoy}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return sumarDias(hoy, -((dia + 6) % 7));
}

type Crear = (titulo: string, extra?: Record<string, unknown>, enlaces?: Record<string, unknown>) => Promise<any>;

/**
 * Tareas propias de la línea de tiempo (las sembradas arriba tienen jerarquía y OpenProject rechaza más «follows» entre ellas):
 * una cadena A → B → C con C pisada por B (manuales), una cadena X → Y con Y en programación automática, una tarea suelta y un hito; con fechas de esta semana.
 */
async function sembrarLinea(crear: Crear, token: string, tipoHito: number): Promise<Record<string, number>> {
  const lunes = lunesDeEstaSemana();
  const manual = { scheduleManually: true };
  const a = await crear('Línea A', { ...manual, startDate: lunes, dueDate: sumarDias(lunes, 1) });
  const b = await crear('Línea B', { ...manual, startDate: sumarDias(lunes, 2), dueDate: sumarDias(lunes, 3) });
  const c = await crear('Línea C', { ...manual, startDate: sumarDias(lunes, 3), dueDate: sumarDias(lunes, 4) });
  for (const [sucesora, predecesora] of [[b, a], [c, b]]) {
    await pedir(token, 'POST', `/api/v3/work_packages/${sucesora.id}/relations`, {
      type: 'follows',
      _links: { to: enlace('work_packages', predecesora.id) },
    });
  }
  // Al crear la relación OpenProject pasa la sucesora a programación automática y la corre: se la deja de nuevo manual,
  // en las fechas pensadas (C queda pisada por B).
  for (const [tarea, inicio, fin] of [[b, 2, 3], [c, 3, 4]] as const) {
    const actual = await pedir(token, 'GET', `/api/v3/work_packages/${tarea.id}`);
    await pedir(token, 'PATCH', `/api/v3/work_packages/${tarea.id}`, {
      lockVersion: actual.lockVersion, ...manual, startDate: sumarDias(lunes, inicio), dueDate: sumarDias(lunes, fin),
    });
  }
  // Cadena automática, como casi todas las sucesoras reales: X manual y Y que la espera SIN volverla manual
  // (OpenProject la corre sola cuando X se mueve).
  const x = await crear('Línea auto X', { ...manual, startDate: lunes, dueDate: sumarDias(lunes, 1) });
  const y = await crear('Línea auto Y', { startDate: sumarDias(lunes, 2), dueDate: sumarDias(lunes, 3) });
  await pedir(token, 'POST', `/api/v3/work_packages/${y.id}/relations`, { type: 'follows', _links: { to: enlace('work_packages', x.id) } });
  const autoY = await pedir(token, 'GET', `/api/v3/work_packages/${y.id}`);
  if (autoY.scheduleManually) throw new Error('«Línea auto Y» debería quedar en programación automática');
  const suelta = await crear('Línea suelta', { ...manual, startDate: lunes, dueDate: sumarDias(lunes, 1) });
  const suelta2 = await crear('Línea suelta 2', { ...manual, startDate: sumarDias(lunes, 2), dueDate: sumarDias(lunes, 3) });
  const hito = await crear('Línea hito', { ...manual, date: sumarDias(lunes, 4) }, { type: enlace('types', tipoHito) });
  return { a: a.id, b: b.id, c: c.id, autoX: x.id, autoY: y.id, suelta: suelta.id, suelta2: suelta2.id, hito: hito.id };
}

/**
 * Datos para Inicio, Proyectos, Equipo y Métricas: un hito dentro de la versión con fechas («En curso», sembrada arriba),
 * una tarea larga (más de 31 días) y una tarea cerrada.
 * Cerrar la tarea fija su cierre en «hoy»; fecharla 40 días atrás con rails runner resulta inestable, así que no se hace.
 */
async function sembrarPantallas(crear: Crear, token: string, ids: { versionId: number; yo: number; tipoHito: number }): Promise<Record<string, number>> {
  const hoy = hoyArgentina();
  const asignada = { assignee: enlace('users', ids.yo) };
  const hito = await crear('Hito de la entrega', { date: sumarDias(hoy, 14) }, { type: enlace('types', ids.tipoHito), version: enlace('versions', ids.versionId) });
  const larga = await crear('Tarea larga', { scheduleManually: true, startDate: hoy, dueDate: sumarDias(hoy, 45) }, asignada);
  const cerrada = await crear('Tarea cerrada', { scheduleManually: true, startDate: sumarDias(hoy, -3), dueDate: hoy }, asignada);
  const actual = await pedir(token, 'GET', `/api/v3/work_packages/${cerrada.id}`);
  await pedir(token, 'PATCH', `/api/v3/work_packages/${cerrada.id}`, {
    lockVersion: actual.lockVersion,
    _links: { status: enlace('statuses', await idPorNombre(token, 'statuses', 'Closed')) },
  });
  return { version: ids.versionId, hito: hito.id, larga: larga.id, cerrada: cerrada.id };
}

/**
 * Tareas de «Para ordenar»: una sucesora manual pisada por su anterior (P → Q, de la persona), una vencida, una sin
 * fechas y una sin responsable, todas con el prefijo «Orden»; y una atrasada propia para cerrar con el círculo de Inicio.
 */
async function sembrarOrdenar(crear: Crear, token: string, yo: number): Promise<Record<string, number>> {
  const hoy = hoyArgentina();
  // Dos semanas adelante: siempre futuras, así que arreglarlas no las deja «vencidas» en ningún día de la semana.
  const lunes = sumarDias(lunesDeEstaSemana(), 14);
  const manual = { scheduleManually: true };
  const mia = { assignee: enlace('users', yo) };
  const p = await crear('Orden P', { ...manual, startDate: lunes, dueDate: sumarDias(lunes, 1) }, mia);
  const q = await crear('Orden Q', { ...manual, startDate: sumarDias(lunes, 2), dueDate: sumarDias(lunes, 3) }, mia);
  await pedir(token, 'POST', `/api/v3/work_packages/${q.id}/relations`, { type: 'follows', _links: { to: enlace('work_packages', p.id) } });
  // Al crear la relación OpenProject deja a Q automática y la corre detrás de P: se la vuelve a dejar manual y pisada.
  const actual = await pedir(token, 'GET', `/api/v3/work_packages/${q.id}`);
  await pedir(token, 'PATCH', `/api/v3/work_packages/${q.id}`, {
    lockVersion: actual.lockVersion, ...manual, startDate: sumarDias(lunes, 1), dueDate: sumarDias(lunes, 2),
  });
  const vencida = await crear('Orden vencida', { ...manual, startDate: sumarDias(hoy, -16), dueDate: sumarDias(hoy, -14) }, mia);
  const sinFechas = await crear('Orden sin fechas', {}, mia);
  const sinResponsable = await crear('Orden sin responsable', { ...manual, startDate: lunes, dueDate: sumarDias(lunes, 1) });
  const circulo = await crear('Orden círculo', { ...manual, startDate: sumarDias(hoy, -3), dueDate: sumarDias(hoy, -2) }, mia);
  return { p: p.id, q: q.id, vencida: vencida.id, sinFechas: sinFechas.id, sinResponsable: sinResponsable.id, circulo: circulo.id };
}

/**
 * Proyecto «Plantilla de prueba» marcado como plantilla (`templated`), con tres tareas sin fechas ni responsable
 * y una unión (la 2 espera a la 1), como «Proyectos Template» del equipo. Lo usan las pruebas de copia de proyectos.
 */
async function sembrarPlantilla(token: string): Promise<{ plantillaId: number; tareas: number[] }> {
  ejecutarRails("Project.find_by(identifier: 'plantilla-prueba')&.destroy!\n");
  const plantilla = await pedir(token, 'POST', '/api/v3/projects', { name: 'Plantilla de prueba', identifier: 'plantilla-prueba' });
  ejecutarRails(`Project.find(${plantilla.id}).update_columns(templated: true)\n`);
  const yoId = (await pedir(token, 'GET', '/api/v3/users/me')).id as number;
  await pedir(token, 'POST', '/api/v3/memberships', {
    _links: {
      project: enlace('projects', plantilla.id),
      principal: enlace('users', yoId),
      roles: [enlace('roles', await idPorNombre(token, 'roles', 'Project admin'))],
    },
  });
  const tipo = await idPorNombre(token, 'types', 'Task');
  const tareas: number[] = [];
  for (const titulo of ['Plantilla 1', 'Plantilla 2', 'Plantilla 3']) {
    const t = await pedir(token, 'POST', '/api/v3/work_packages', {
      subject: titulo, _links: { project: enlace('projects', plantilla.id), type: enlace('types', tipo) },
    });
    tareas.push(t.id);
  }
  await pedir(token, 'POST', `/api/v3/work_packages/${tareas[1]}/relations`, { type: 'follows', _links: { to: enlace('work_packages', tareas[0]!) } });
  return { plantillaId: plantilla.id, tareas };
}

async function main(): Promise<void> {
  console.log('Esperando a OpenProject (puede tardar varios minutos la primera vez)...');
  await esperarOp();
  const token = lineaDe(ejecutarRails(readFileSync(resolve(raiz, 'scripts/token-admin.rb'), 'utf8')), 'TOKEN_ADMIN');

  // El filtro por identificador no existe en 16.x: se recorren todas las páginas.
  let existe = false;
  for (let pagina = 1; !existe; pagina++) {
    const col = await pedir(token, 'GET', `/api/v3/projects?pageSize=100&offset=${pagina}`);
    const elementos: Array<{ identifier: string }> = col._embedded.elements;
    existe = elementos.some((p) => p.identifier === 'prueba');
    if (elementos.length === 0 || pagina * 100 >= col.total) break;
  }
  if (existe) {
    // Re-ejecutable: borra el proyecto anterior (con sus tareas y versiones) y lo siembra de nuevo.
    ejecutarRails("Project.find_by(identifier: 'prueba')&.destroy!\n");
  }
  const proyecto = await pedir(token, 'POST', '/api/v3/projects', { name: 'Prueba', identifier: 'prueba' });
  const proyectoId: number = proyecto.id;
  // Cargar horas (time_entries) necesita el módulo «Time and costs»; sin él OpenProject responde 403.
  ejecutarRails(`p = Project.find(${proyectoId})
p.enabled_module_names |= ['costs']
p.save!
`);
  // Para ser responsable de una tarea hay que ser miembro del proyecto: el admin entra como «Project admin».
  const yoId = (await pedir(token, 'GET', '/api/v3/users/me')).id as number;
  await pedir(token, 'POST', '/api/v3/memberships', {
    _links: {
      project: enlace('projects', proyectoId),
      principal: enlace('users', yoId),
      roles: [enlace('roles', await idPorNombre(token, 'roles', 'Project admin'))],
    },
  });
  const versiones: Record<string, number> = {};
  for (const nombre of ['En curso', 'Finalizado']) {
    // «En curso» lleva fechas (hoy y 30 días): Proyectos muestra el período de la versión.
    const fechas = nombre === 'En curso' ? { startDate: hoyArgentina(), endDate: sumarDias(hoyArgentina(), 30) } : {};
    const v = await pedir(token, 'POST', '/api/v3/versions', {
      name: nombre,
      ...fechas,
      _links: { definingProject: enlace('projects', proyectoId) },
    });
    versiones[nombre] = v.id;
  }

  const tipo = await idPorNombre(token, 'types', 'Task');
  const yo = yoId;
  const crear = (titulo: string, extra: Record<string, unknown> = {}, enlaces: Record<string, unknown> = {}) =>
    pedir(token, 'POST', '/api/v3/work_packages', {
      subject: titulo,
      ...extra,
      _links: { project: enlace('projects', proyectoId), type: enlace('types', tipo), ...enlaces },
    });

  const t1 = await crear('Tarea de prueba 1', { startDate: '2026-10-19', dueDate: '2026-10-23' }, { assignee: enlace('users', yo) });
  const t2 = await crear('Tarea de prueba 2', { dueDate: '2026-10-30' }, { assignee: enlace('users', yo) });
  const t3 = await crear('Tarea de prueba 3 (hija)', {}, { parent: enlace('work_packages', t1.id), assignee: enlace('users', yo) });
  const t4 = await crear('Tarea de prueba 4 (sin responsable ni fechas)');
  const t5 = await crear('Tarea de prueba 5', {}, { assignee: enlace('users', yo) });
  // t2 y t5 esperan a t1 (dos dependencias «follows»).
  for (const sucesora of [t2, t5]) {
    await pedir(token, 'POST', `/api/v3/work_packages/${sucesora.id}/relations`, {
      type: 'follows',
      _links: { to: enlace('work_packages', t1.id) },
    });
  }

  const linea = await sembrarLinea(crear, token, await idPorNombre(token, 'types', 'Milestone'));

  const pantallas = await sembrarPantallas(crear, token, { versionId: versiones['En curso']!, yo, tipoHito: await idPorNombre(token, 'types', 'Milestone') });

  const ordenar = await sembrarOrdenar(crear, token, yo);

  const plantilla = await sembrarPlantilla(token);

  mkdirSync(dirname(SALIDA), { recursive: true });
  writeFileSync(SALIDA, JSON.stringify({
    url: URL_OP_PRUEBA, token, proyectoId, versiones, tareas: [t1.id, t2.id, t3.id, t4.id, t5.id], linea, pantallas, ordenar, plantilla,
  }, null, 2));
  console.log('OpenProject de prueba listo');
}

main().catch((e) => { console.error(e); process.exit(1); });
