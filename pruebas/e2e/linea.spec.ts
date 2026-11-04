// E2E de la línea de tiempo contra el OpenProject de Docker. Las tareas «Línea …» las siembra la preparación global
// con fechas de la semana en curso: cadena A → B → C (C pisada por B), una tarea suelta y un hito.
import { expect, test } from '@playwright/test';
import {
  arrastrarBarra, barra, deshacer, esperasEnOp, fechasEnOp, irALinea, leerSembrado, leerTarea, ordenarArrastrando, ordenDeRenglones, registrar, soltarUnion, unirBarras,
} from './ayudas.js';

function sumar(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Los ids se leen al correr: la preparación global resiembra OpenProject antes de las pruebas.
let L = { a: 0, b: 0, c: 0, autoX: 0, autoY: 0, suelta: 0, suelta2: 0, hito: 0 };
test.beforeAll(() => {
  L = leerSembrado().linea;
});

test.beforeEach(async ({ page }) => {
  await registrar(page);
  await irALinea(page);
});

test('la línea de tiempo muestra la cadena sembrada con su conflicto', async ({ page }) => {
  await expect(barra(page, L.a)).toHaveAttribute('aria-label', /^Línea A, /);
  await expect(barra(page, L.b)).toBeVisible();
  await expect(barra(page, L.c)).toHaveAttribute('aria-label', /, en conflicto$/);
  await expect(barra(page, L.b)).not.toHaveAttribute('aria-label', /en conflicto/);
  await expect(page.locator('.flecha--conflicto').first()).toBeAttached();
  await expect(barra(page, L.hito).locator('[data-rombo]')).toBeVisible();
});

test('al bajar por la lista, la cabecera con las fechas queda pegada arriba y la página no se corre de costado', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  const cabecera = page.locator('.linea__cabecera');
  await expect(cabecera).toBeVisible();
  // Media lista más abajo del arranque del lienzo: sin cabecera pegada, las fechas quedarían fuera de la pantalla.
  await page.locator('.linea__lienzo').evaluate((lienzo) => window.scrollTo(0, lienzo.getBoundingClientRect().top + window.scrollY + 150));
  await expect.poll(async () => Math.round((await cabecera.boundingBox())?.y ?? 999)).toBe(0);
  await expect(cabecera.locator('.linea__marca').first()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('arrastrar una barra tres días cambia sus fechas en OpenProject', async ({ page }) => {
  const antes = await fechasEnOp(L.suelta);
  await arrastrarBarra(page, L.suelta, 3, 2);
  await expect.poll(() => fechasEnOp(L.suelta)).toEqual({
    inicio: sumar(antes.inicio!, 3),
    fin: sumar(antes.fin!, 3),
  });
});

// Las tareas que esperan a otra no se arrastran a mano (spec): se mueve A, que no espera a nadie, y la cascada corre B y C.
test('mover una tarea corre a las sucesoras manuales sin diálogo y «Deshacer» devuelve todas', async ({ page }) => {
  const a0 = await fechasEnOp(L.a);
  const b0 = await fechasEnOp(L.b);
  const c0 = await fechasEnOp(L.c);
  await arrastrarBarra(page, L.a, 1, 2);
  await expect.poll(async () => (await fechasEnOp(L.a)).inicio).toBe(sumar(a0.inicio!, 1));
  await expect.poll(async () => (await fechasEnOp(L.b)).inicio).not.toBe(b0.inicio);
  await expect.poll(async () => (await fechasEnOp(L.c)).inicio).not.toBe(c0.inicio);
  const a1 = await fechasEnOp(L.a);
  const b1 = await fechasEnOp(L.b);
  const c1 = await fechasEnOp(L.c);
  expect(b1.inicio! > a1.fin!).toBe(true);
  expect(c1.inicio! > b1.fin!).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await deshacer(page);
  await expect.poll(() => fechasEnOp(L.a)).toEqual(a0);
  await expect.poll(() => fechasEnOp(L.b)).toEqual(b0);
  await expect.poll(() => fechasEnOp(L.c)).toEqual(c0);
});

test('mover una tarea con una sucesora automática la corre OpenProject y la línea la muestra movida, sin diálogo', async ({ page }) => {
  const x0 = await fechasEnOp(L.autoX);
  const y0 = await fechasEnOp(L.autoY);
  await arrastrarBarra(page, L.autoX, 1, 2);
  await expect.poll(async () => (await fechasEnOp(L.autoX)).inicio).toBe(sumar(x0.inicio!, 1));
  // OpenProject reprograma a la sucesora automática por su cuenta.
  await expect.poll(async () => (await fechasEnOp(L.autoY)).inicio).not.toBe(y0.inicio);
  const y1 = await fechasEnOp(L.autoY);
  const x1 = await fechasEnOp(L.autoX);
  expect(y1.inicio! > x1.fin!).toBe(true);
  // La línea la muestra movida, y no ofrece correr nada.
  const corto = (f: string) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${f}T00:00:00Z`)).replace(/\./g, '').trim();
  await expect(barra(page, L.autoY)).toHaveAttribute('aria-label', new RegExp(`del ${corto(y1.inicio!)} al ${corto(y1.fin!)}`));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Y sus fechas las calcula OpenProject: no se puede arrastrar.
  await expect(barra(page, L.autoY).locator('[data-gesto]')).toHaveCount(0);
});

test('el detalle se abre desde una barra', async ({ page }) => {
  await barra(page, L.suelta).click();
  await expect(page).toHaveURL(new RegExp(`/linea-de-tiempo/tareas/${L.suelta}`));
  await expect(page.getByRole('textbox', { name: 'Título', exact: true })).toHaveValue('Línea suelta');
});

test('unir dos tareas arrastrando el puntito crea la relación y «Deshacer» la borra', async ({ page }) => {
  expect(await esperasEnOp(L.suelta2)).not.toContain(L.suelta);
  await unirBarras(page, L.suelta, L.suelta2);
  await expect.poll(() => esperasEnOp(L.suelta2)).toContain(L.suelta);
  await deshacer(page);
  await expect.poll(() => esperasEnOp(L.suelta2)).not.toContain(L.suelta);
});

test('soltar una unión con la × la borra y «Deshacer» la vuelve a crear', async ({ page }) => {
  expect(await esperasEnOp(L.b)).toContain(L.a);
  await soltarUnion(page, L.a, L.b);
  await expect.poll(() => esperasEnOp(L.b)).not.toContain(L.a);
  await deshacer(page);
  await expect.poll(() => esperasEnOp(L.b)).toContain(L.a);
});

test('el «!» de una tarea pisada la corre detrás de su anterior y «Deshacer» la devuelve', async ({ page }) => {
  const b0 = await fechasEnOp(L.b);
  const c0 = await fechasEnOp(L.c);
  expect(c0.inicio! <= b0.fin!).toBe(true);
  const alerta = page.locator(`[data-renglon-tarea="${L.c}"] .renglon__alerta`);
  await expect(alerta).toHaveAttribute('aria-label', /^Empieza antes de que termine «Línea B»\./);
  await alerta.click();
  await expect.poll(async () => (await fechasEnOp(L.c)).inicio! > b0.fin!).toBe(true);
  await expect(alerta).toHaveCount(0);

  await deshacer(page);
  await expect.poll(() => fechasEnOp(L.c)).toEqual(c0);
  await expect(alerta).toBeVisible();
});

test('ordenar la lista con el ⠿ guarda el orden y sobrevive a recargar', async ({ page }) => {
  const antes = await ordenDeRenglones(page);
  const pos = antes.indexOf(L.suelta);
  try {
    await ordenarArrastrando(page, L.suelta, 1);
    const despues = await ordenDeRenglones(page);
    expect(despues.indexOf(L.suelta)).toBe(pos + 1);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Línea de tiempo', exact: true })).toBeVisible();
    await expect.poll(async () => (await ordenDeRenglones(page)).indexOf(L.suelta)).toBe(pos + 1);
  } finally {
    // Se deja como estaba aunque algo falle en el medio, para no alterar las demás pruebas.
    const actual = (await ordenDeRenglones(page)).indexOf(L.suelta);
    if (actual > pos) await ordenarArrastrando(page, L.suelta, pos - actual);
  }
  await expect.poll(async () => (await ordenDeRenglones(page)).indexOf(L.suelta)).toBe(pos);
});

test('«+» en un proyecto crea la tarea en OpenProject con su barra enfocada, y «Deshacer» la borra', async ({ page }) => {
  const encabezado = page.locator('.renglon--encabezado').filter({ hasText: 'Prueba' }).first();
  await encabezado.hover();
  await encabezado.getByRole('button', { name: 'Nueva tarea en «Prueba»' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Nueva tarea' });
  const titulo = `Línea nueva ${Date.now()}`;
  await dialogo.getByRole('textbox', { name: 'Título' }).fill(titulo);
  await dialogo.getByRole('button', { name: 'Crear' }).click();
  await expect(dialogo).toBeHidden();
  const renglon = page.locator('[data-renglon-tarea]').filter({ hasText: titulo });
  await expect(renglon).toBeVisible();
  const id = Number(await renglon.getAttribute('data-renglon-tarea'));
  await expect(barra(page, id)).toBeFocused();
  const enOp = await leerTarea(id);
  expect(enOp.scheduleManually).toBe(true);
  expect(enOp.startDate).toBeTruthy();
  expect(enOp.dueDate).toBeTruthy();
  await deshacer(page);
  await expect.poll(() => leerTarea(id).then(() => 'está', () => 'borrada')).toBe('borrada');
  await expect(renglon).toHaveCount(0);
});

/** El día hábil siguiente (el OpenProject de prueba no tiene feriados: solo saltea el fin de semana). */
function habilSiguiente(fecha: string): string {
  let dia = sumar(fecha, 1);
  while ([0, 6].includes(new Date(`${dia}T00:00:00Z`).getUTCDay())) dia = sumar(dia, 1);
  return dia;
}

test('pausar el último día desde el detalle corre el fin en OpenProject, corta la barra y «Deshacer» lo devuelve', async ({ page }) => {
  const antes = await fechasEnOp(L.suelta2);
  expect(antes.inicio! < antes.fin!).toBe(true);
  await barra(page, L.suelta2).click();
  const pausas = page.getByRole('dialog').getByRole('region', { name: 'Pausas' });
  await pausas.getByLabel('Sin trabajo desde').fill(antes.fin!);
  await pausas.getByLabel('Hasta').fill(antes.fin!);
  await pausas.getByRole('button', { name: 'Pausar' }).click();
  await expect.poll(async () => (await fechasEnOp(L.suelta2)).fin).toBe(habilSiguiente(antes.fin!));
  await expect(pausas.getByRole('listitem')).toHaveCount(1);
  await expect(barra(page, L.suelta2)).toHaveClass(/barra--pausada/);
  await deshacer(page);
  await expect.poll(async () => (await fechasEnOp(L.suelta2)).fin).toBe(antes.fin);
  await expect(pausas.getByRole('listitem')).toHaveCount(0);
});
