// E2E de la tanda 4 contra el OpenProject de Docker: lo que antes obligaba a entrar a OpenProject (adjuntos, borrar
// tareas, crear proyectos, miembros y versiones) se hace desde OpenDash. Las tareas de borrado y los proyectos nuevos
// se crean y se limpian en cada prueba para no tocar las tareas sembradas que usan las otras specs.
import { expect, test, type Page } from '@playwright/test';
import { api, ejecutarRails } from '../../scripts/op-prueba.js';
import { entrar, leerSembrado, versionEnOp } from './ayudas.js';

const s = () => leerSembrado();

async function opAdmin(metodo: string, ruta: string, cuerpo?: unknown): Promise<{ estado: number; json: any }> {
  const { url, token } = s();
  return api(url, token, metodo, ruta, cuerpo);
}

async function opOk(metodo: string, ruta: string, cuerpo?: unknown): Promise<any> {
  const { estado, json } = await opAdmin(metodo, ruta, cuerpo);
  if (estado >= 400) throw new Error(`${metodo} ${ruta} -> ${estado}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

/** Crea una tarea tipo Task en el proyecto de prueba, directo en OpenProject, con madre opcional. */
async function crearTareaEnOp(titulo: string, madre?: number): Promise<number> {
  const tipos = await opOk('GET', '/api/v3/types');
  const tipo = (tipos._embedded.elements as Array<{ id: number; name: string }>).find((t) => t.name === 'Task')!.id;
  const t = await opOk('POST', '/api/v3/work_packages', {
    subject: titulo,
    _links: {
      project: { href: `/api/v3/projects/${s().proyectoId}` },
      type: { href: `/api/v3/types/${tipo}` },
      ...(madre === undefined ? {} : { parent: { href: `/api/v3/work_packages/${madre}` } }),
    },
  });
  return t.id as number;
}

const adjuntosEnOp = async (tareaId: number): Promise<string[]> =>
  ((await opOk('GET', `/api/v3/work_packages/${tareaId}/attachments`))._embedded.elements as Array<{ fileName: string }>).map((a) => a.fileName);

/** Borra directo en OpenProject el adjunto de prueba, por si la prueba falló antes de borrarlo desde OpenDash. */
async function quitarAdjuntosDeOp(tareaId: number, nombre: string): Promise<void> {
  const col = await opOk('GET', `/api/v3/work_packages/${tareaId}/attachments`);
  for (const a of col._embedded.elements as Array<{ id: number; fileName: string }>) {
    if (a.fileName === nombre) await opAdmin('DELETE', `/api/v3/attachments/${a.id}`);
  }
}

async function abrirTarea(page: Page, id: number): Promise<void> {
  await page.goto(`/tareas/${id}`);
  await expect(page.getByRole('textbox', { name: 'Título', exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await entrar(page);
});

test('adjuntar un archivo, bajarlo y borrarlo', async ({ page }) => {
  const [, , , , T5] = s().tareas as [number, number, number, number, number];
  const nombre = 'nota-e2e.txt';
  try {
    await abrirTarea(page, T5);

    const contenido = 'Contenido de la nota de prueba';
    await page.getByLabel('Elegir archivos').setInputFiles({ name: nombre, mimeType: 'text/plain', buffer: Buffer.from(contenido) });
    const lista = page.getByRole('list', { name: 'Adjuntos', exact: true });
    const enlace = lista.getByRole('link', { name: nombre });
    await expect(enlace).toBeVisible();
    await expect.poll(() => adjuntosEnOp(T5)).toContain(nombre);

    // Bajar: un .txt va como adjunto descargable, con el nombre bien escrito y el contenido intacto.
    const href = await enlace.getAttribute('href');
    const respuesta = await page.request.get(href!);
    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()['content-disposition']).toContain('attachment');
    expect(respuesta.headers()['content-disposition']).toContain(`filename*=UTF-8''${nombre}`);
    expect(await respuesta.text()).toBe(contenido);

    // Borrar: pide confirmación y desaparece también de OpenProject.
    await lista.getByRole('button', { name: `Borrar ${nombre}` }).click();
    const confirmar = lista.getByRole('group', { name: `Confirmar el borrado de ${nombre}` });
    await expect(confirmar).toContainText(`¿Borrar “${nombre}”? No se puede deshacer`);
    await confirmar.getByRole('button', { name: 'Borrar', exact: true }).click();
    await expect(page.getByText('Sin adjuntos')).toBeVisible();
    await expect.poll(() => adjuntosEnOp(T5)).not.toContain(nombre);
  } finally {
    await quitarAdjuntosDeOp(T5, nombre);
  }
});

test('borrar una tarea con una subtarea', async ({ page }) => {
  // El servidor trae lo nuevo de OpenProject cada 45 s: la espera de la caché puede llevarse más de un turno.
  test.setTimeout(150_000);
  const sufijo = Date.now();
  const titulo = `Tarea a borrar ${sufijo}`;
  const madre = await crearTareaEnOp(titulo);
  const hija = await crearTareaEnOp(`Subtarea a borrar ${sufijo}`, madre);

  // La caché se pone al día al volver a cargar la lista: hay que esperar a la madre Y a la hija, porque el resumen cuenta desde la caché.
  await expect(async () => {
    await page.goto(`/tareas/${madre}`);
    const detalle = page.getByRole('dialog', { name: titulo });
    await expect(detalle).toBeVisible({ timeout: 4000 });
    await expect(detalle.getByText(`Subtarea a borrar ${sufijo}`)).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 100_000 });

  await page.getByRole('button', { name: 'Borrar tarea' }).click();
  const dialogo = page.getByRole('alertdialog');
  await expect(dialogo).toContainText(`¿Seguro que querés borrar «${titulo}»?`);
  await expect(dialogo).toContainText('Se borran también 1 subtarea');
  await dialogo.getByRole('button', { name: 'Borrar', exact: true }).click();

  await expect(page.getByText(`Borraste «${titulo}»`)).toBeVisible();
  await expect.poll(async () => (await opAdmin('GET', `/api/v3/work_packages/${madre}`)).estado).toBe(404);
  await expect.poll(async () => (await opAdmin('GET', `/api/v3/work_packages/${hija}`)).estado).toBe(404);
});

test('crear un proyecto desde la plantilla y abrirlo', async ({ page }) => {
  test.setTimeout(180_000);
  const nombre = `Proyecto E2E ${Date.now()}`;
  try {
    await page.goto('/proyectos');
    await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Nuevo proyecto' });
    await dialogo.getByLabel('Nombre').fill(nombre);
    await dialogo.getByLabel('Empezar de').selectOption({ label: 'Plantilla de prueba' });
    await dialogo.getByRole('button', { name: 'Crear', exact: true }).click();

    // Si algo no se copió el diálogo lo lista y espera; si no, navega solo.
    const abrir = dialogo.getByRole('button', { name: 'Abrir el proyecto' });
    await Promise.race([
      page.waitForURL(/\/proyectos\/\d+$/, { timeout: 150_000 }),
      abrir.waitFor({ state: 'visible', timeout: 150_000 }),
    ]);
    if (!/\/proyectos\/\d+$/.test(page.url())) {
      await abrir.click();
      await expect(page).toHaveURL(/\/proyectos\/\d+$/);
    }
    await expect(page.getByRole('heading', { name: nombre, exact: true })).toBeVisible();
    // Las tareas de la plantilla vinieron con la copia.
    await expect(page.getByText('Plantilla 1', { exact: true }).first()).toBeVisible();
  } finally {
    ejecutarRails(`Project.where(name: ${JSON.stringify(nombre)}).each(&:destroy)\n`);
  }
});

test('agregar un miembro y cambiarle el rol', async ({ page }) => {
  const login = `miembroe2e${Date.now()}`;
  const nombreCompleto = 'Marta Miembra';
  ejecutarRails(`
u = User.new(login: '${login}', firstname: 'Marta', lastname: 'Miembra', mail: '${login}@example.com')
u.password = 'Clave-solo-de-prueba-12345'
u.password_confirmation = 'Clave-solo-de-prueba-12345'
u.admin = false
u.save!
u.update_column(:status, Principal.statuses[:active])
puts "USUARIO_ID=#{u.id}"
`);
  try {
    await page.goto(`/proyectos/${s().proyectoId}?vista=gestion`);
    const miembros = page.getByRole('region', { name: 'Miembros' });
    await miembros.getByRole('button', { name: 'Agregar persona' }).click();
    await miembros.getByLabel('Persona').selectOption({ label: nombreCompleto });
    const rol = miembros.getByLabel('Rol', { exact: true });
    const roles = await rol.locator('option').allTextContents();
    expect(roles.length).toBeGreaterThan(1);
    await expect(rol).toHaveValue('');
    await rol.selectOption({ label: 'Member' });
    await miembros.getByRole('button', { name: 'Agregar', exact: true }).click();

    const lista = miembros.getByRole('list', { name: 'Miembros del proyecto' });
    await expect(lista).toContainText(nombreCompleto);
    const selector = lista.getByLabel(`Cambiar rol de ${nombreCompleto}`);
    const actual = await selector.inputValue();
    expect(await selector.locator('option').count()).toBeGreaterThanOrEqual(2);
    const otro = await selector.locator('option').evaluateAll(
      (os, a) => (os as HTMLOptionElement[]).find((o) => o.value !== a)!.value, actual,
    );
    await selector.selectOption(otro);
    await expect(selector).toHaveValue(otro);

    // En OpenProject la membresía quedó con el rol nuevo.
    await expect.poll(async () => {
      const filtro = encodeURIComponent(JSON.stringify([{ project: { operator: '=', values: [String(s().proyectoId)] } }]));
      const col = await opOk('GET', `/api/v3/memberships?pageSize=100&filters=${filtro}`);
      const m = (col._embedded.elements as any[]).find((e) => e._links.principal.title === nombreCompleto);
      return m?._links.roles.map((r: any) => String(r.href.split('/').pop())).join(',');
    }).toBe(otro);
  } finally {
    ejecutarRails(`User.find_by(login: '${login}')&.destroy\n`);
  }
});

test('crear una versión y elegirla en una tarea', async ({ page }) => {
  const [, , , , T5] = s().tareas as [number, number, number, number, number];
  const nombre = `Versión E2E ${Date.now()}`;
  try {
    await page.goto(`/proyectos/${s().proyectoId}?vista=gestion`);
    const versiones = page.getByRole('region', { name: 'Versiones' });
    await versiones.getByRole('button', { name: 'Nueva versión' }).click();
    await versiones.getByLabel('Nombre de la versión').fill(nombre);
    await versiones.getByRole('button', { name: 'Crear', exact: true }).click();
    await expect(versiones.getByRole('list', { name: 'Versiones del proyecto' })).toContainText(nombre);

    await abrirTarea(page, T5);
    const campo = page.getByLabel('Versión', { exact: true });
    await campo.selectOption({ label: nombre });
    await expect.poll(() => versionEnOp(T5)).toBe(nombre);

    // Se deja la tarea como estaba.
    await campo.selectOption({ label: 'Sin versión' });
    await expect.poll(() => versionEnOp(T5)).toBeNull();
  } finally {
    // Sin esto la tarea sembrada y la versión quedarían para las otras specs y para la segunda corrida.
    const t = await opOk('GET', `/api/v3/work_packages/${T5}`);
    if (t._links.version?.href) {
      await opAdmin('PATCH', `/api/v3/work_packages/${T5}`, { lockVersion: t.lockVersion, _links: { version: { href: null } } });
    }
    const col = await opOk('GET', `/api/v3/projects/${s().proyectoId}/versions`);
    for (const v of col._embedded.elements as Array<{ id: number; name: string }>) {
      if (v.name === nombre) await opAdmin('DELETE', `/api/v3/versions/${v.id}`);
    }
  }
});
