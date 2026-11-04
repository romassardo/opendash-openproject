// E2E de «Para ordenar» y del círculo de Inicio contra el OpenProject de Docker. Las tareas «Orden …» las siembra la
// preparación global: P → Q (Q manual y pisada), una vencida, una sin fechas, una sin responsable y una atrasada propia.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { estadoEnOp, fechasEnOp, leerSembrado, leerTarea, registrar } from './ayudas.js';

let O = { p: 0, q: 0, vencida: 0, sinFechas: 0, sinResponsable: 0, circulo: 0 };
test.beforeAll(() => {
  O = leerSembrado().ordenar;
});

function sumar(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana que viene, en hora argentina: un día hábil seguro para las fechas nuevas. */
function lunesProximo(): string {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const dia = new Date(`${hoy}T00:00:00Z`).getUTCDay();
  return sumar(hoy, 7 - ((dia + 6) % 7));
}

const seccion = (page: Page, titulo: string): Locator => page.getByRole('region', { name: new RegExp(`^${titulo}`) });
const fila = (page: Page, titulo: string): Locator => page.locator('li.ordenar__fila').filter({ hasText: titulo });

test.beforeEach(async ({ page }) => {
  await registrar(page);
  await page.goto('/para-ordenar');
  await expect(page.getByRole('heading', { name: 'Para ordenar', exact: true })).toBeVisible();
});

test('muestra una fila de cada sección con su motivo y su botón', async ({ page }) => {
  const pisada = seccion(page, 'Fechas que se pisan').locator('li.ordenar__fila').filter({ hasText: 'Orden Q' });
  await expect(pisada).toContainText('empieza antes de que termine «Orden P»');
  await expect(pisada.getByRole('button', { name: 'Correr detrás' })).toBeVisible();

  const vencida = seccion(page, 'Vencidas').locator('li.ordenar__fila').filter({ hasText: 'Orden vencida' });
  await expect(vencida).toContainText(/venció el \d+\/\d+/);
  await expect(vencida.getByRole('button', { name: 'Cambiar fechas' })).toBeVisible();

  const sinFechas = seccion(page, 'Sin fechas').locator('li.ordenar__fila').filter({ hasText: 'Orden sin fechas' });
  await expect(sinFechas).toContainText('no tiene fechas');
  await expect(sinFechas.getByRole('button', { name: 'Poner fechas' })).toBeVisible();

  const sinAsignar = seccion(page, 'Sin asignar').locator('li.ordenar__fila').filter({ hasText: 'Orden sin responsable' });
  await expect(sinAsignar).toContainText('sin responsable');
  await expect(sinAsignar.getByRole('button', { name: 'Elegir responsable' })).toBeVisible();
});

test('«Correr detrás» corre la tarea pisada detrás de su anterior y la fila se va', async ({ page }) => {
  const p = await fechasEnOp(O.p);
  const q0 = await fechasEnOp(O.q);
  expect(q0.inicio! <= p.fin!).toBe(true);
  await fila(page, 'Orden Q').getByRole('button', { name: 'Correr detrás' }).click();
  await expect.poll(async () => (await fechasEnOp(O.q)).inicio! > p.fin!).toBe(true);
  await expect(fila(page, 'Orden Q')).toHaveCount(0);
});

test('«Cambiar fechas» guarda las fechas nuevas de una tarea vencida y la fila se va', async ({ page }) => {
  const inicio = lunesProximo();
  const fin = sumar(inicio, 2);
  await fila(page, 'Orden vencida').getByRole('button', { name: 'Cambiar fechas' }).click();
  const globo = page.getByRole('dialog', { name: 'Fechas de «Orden vencida»' });
  await globo.getByLabel('Inicio').fill(inicio);
  await globo.getByLabel('Fin').fill(fin);
  await globo.getByRole('button', { name: 'Guardar' }).click();
  await expect.poll(() => fechasEnOp(O.vencida)).toEqual({ inicio, fin });
  await expect(fila(page, 'Orden vencida')).toHaveCount(0);
});

test('«Poner fechas» le da fechas a una tarea sin fechas y la fila se va', async ({ page }) => {
  const inicio = lunesProximo();
  const fin = sumar(inicio, 1);
  await fila(page, 'Orden sin fechas').getByRole('button', { name: 'Poner fechas' }).click();
  const globo = page.getByRole('dialog', { name: 'Fechas de «Orden sin fechas»' });
  await globo.getByLabel('Inicio').fill(inicio);
  await globo.getByLabel('Fin').fill(fin);
  await globo.getByRole('button', { name: 'Guardar' }).click();
  await expect.poll(() => fechasEnOp(O.sinFechas)).toEqual({ inicio, fin });
  await expect(fila(page, 'Orden sin fechas')).toHaveCount(0);
});

test('«Elegir responsable» asigna la tarea y la fila se va de «Sin asignar»', async ({ page }) => {
  expect((await leerTarea(O.sinResponsable))._links.assignee.href).toBeNull();
  await fila(page, 'Orden sin responsable').getByRole('button', { name: 'Elegir responsable' }).click();
  const globo = page.getByRole('dialog', { name: 'Responsable de «Orden sin responsable»' });
  const lista = globo.getByRole('combobox', { name: 'Responsable' });
  // La primera persona de la lista, elegida por su etiqueta; el valor de la opción es el id del usuario.
  const opcion = lista.locator('option:not([value=""])').first();
  const etiqueta = (await opcion.textContent())!;
  const usuarioId = await opcion.getAttribute('value');
  await lista.selectOption({ label: etiqueta });
  await globo.getByRole('button', { name: 'Asignar' }).click();
  await expect.poll(async () => (await leerTarea(O.sinResponsable))._links.assignee.href).toMatch(new RegExp(`/users/${usuarioId}$`));
  await expect(fila(page, 'Orden sin responsable')).toHaveCount(0);
});

test('cerrar con el círculo en Inicio avisa y «Deshacer» devuelve la tarea como estaba', async ({ page }) => {
  expect(await estadoEnOp(O.circulo)).toBe('New');
  await page.goto('/inicio');
  const mias = page.getByRole('region', { name: 'Mis tareas' });
  await mias.getByRole('checkbox', { name: 'Completar «Orden círculo»' }).click();
  await expect.poll(() => estadoEnOp(O.circulo)).toBe('Closed');
  await expect(page.getByText('Cerraste «Orden círculo».')).toBeVisible();

  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(page.getByText('Listo, quedó como estaba.')).toBeVisible();
  await expect.poll(() => estadoEnOp(O.circulo)).toBe('New');
  await expect(mias.getByRole('checkbox', { name: 'Completar «Orden círculo»' })).toBeVisible();
});
