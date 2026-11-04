// E2E de las horas de trabajo contra el OpenProject de Docker: cronómetro por tarea, carga en OpenProject,
// corrección, varias tareas a la vez, Inicio y Equipo. El reloj del servidor es el real, así que el paso del
// tiempo se simula retrocediendo el comienzo de los tramos en la base (ver retrocederTramosAbiertos).
import { expect, test, type Page } from '@playwright/test';
import { duracionTexto } from '../../compartido/horas.js';
import { cargasEnOp, entrar, leerSembrado, olvidarTramosCerrados, retrocederTramosAbiertos, sumaHoras, terminarTodo, trabajarEn } from './ayudas.js';

let T1 = 0, T2 = 0, T5 = 0;
test.beforeAll(() => {
  [T1, T2, , , T5] = leerSembrado().tareas as [number, number, number, number, number];
});

const TITULO = (n: number): string => `Tarea de prueba ${n}`;

test.beforeEach(async ({ page }) => {
  // Sin la explicación del permiso de inactividad (el diálogo no es lo que se prueba acá).
  await page.addInitScript(() => {
    try { localStorage.setItem('opendash.inactividad.permiso', 'ahora-no'); } catch { /* sin almacenamiento */ }
  });
  await entrar(page);
});

test.afterEach(async ({ page }) => {
  await terminarTodo(page);
  // Lo que cerró esta prueba no cuenta para la siguiente (los tramos no se superponen en el día).
  olvidarTramosCerrados();
});

const totalHoyServidor = (page: Page): Promise<number> =>
  page.evaluate(async () => ((await (await fetch('/api/horas')).json()) as { datos: { totalHoySegundos: number } }).datos.totalHoySegundos);

test('▶ en una tarea, Terminar, y la carga aparece en OpenProject', async ({ page }) => {
  const antes = await cargasEnOp(T5);
  await trabajarEn(page, T5, TITULO(5));
  retrocederTramosAbiertos(90);
  await page.reload();
  // El tablero de fondo también muestra el reloj chico de la tarjeta: se mira el del panel.
  await expect(page.getByRole('dialog', { name: TITULO(5) }).getByRole('timer', { name: `Tiempo trabajado en ${TITULO(5)}` })).toHaveText(/^1:30:\d\d$/);

  await page.getByRole('button', { name: 'Terminar' }).click();
  await expect(page.getByRole('timer')).toHaveCount(0);

  await expect.poll(async () => sumaHoras(await cargasEnOp(T5)) - sumaHoras(antes)).toBeCloseTo(1.5, 1);
  expect((await cargasEnOp(T5)).length).toBe(antes.length + 1);
});

test('corregir cambia la misma carga', async ({ page }) => {
  const antes = await cargasEnOp(T2);
  await trabajarEn(page, T2, TITULO(2));
  retrocederTramosAbiertos(30);
  await page.reload();
  await page.getByRole('button', { name: 'Terminar' }).click();
  await expect.poll(async () => (await cargasEnOp(T2)).length).toBe(antes.length + 1);
  const entrada = (await cargasEnOp(T2)).find((c) => !antes.some((a) => a.id === c.id))!;
  expect(entrada.horas).toBeCloseTo(0.5, 1);

  await page.goto('/inicio');
  await page.getByRole('button', { name: `Corregir ${TITULO(2)}` }).click();
  await page.getByLabel('Horas', { exact: true }).fill('1');
  await page.getByLabel('Minutos', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();

  await expect.poll(async () => (await cargasEnOp(T2)).find((c) => c.id === entrada.id)?.horas).toBeCloseTo(1, 2);
  // La corrección edita la entrada que ya existía: no se creó otra.
  expect((await cargasEnOp(T2)).length).toBe(antes.length + 1);
});

test('con varias a la vez, cada tarea carga su tiempo entero', async ({ page }) => {
  const antes = { a: sumaHoras(await cargasEnOp(T2)), b: sumaHoras(await cargasEnOp(T5)) };
  await page.goto('/configuracion');
  const varias = page.getByRole('switch', { name: 'Varias tareas a la vez' });
  await varias.click();
  await expect(varias).toHaveAttribute('aria-checked', 'true');
  try {
    await trabajarEn(page, T2, TITULO(2));
    await trabajarEn(page, T5, TITULO(5));
    // Con la opción prendida la primera sigue corriendo.
    await page.goto('/inicio');
    await expect(page.getByRole('timer')).toHaveCount(2);

    retrocederTramosAbiertos(60);
    await page.reload();
    await expect(page.getByRole('timer')).toHaveCount(2);
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Terminar' }).first().click();
    await expect(page.getByRole('timer')).toHaveCount(0);

    await expect.poll(async () => sumaHoras(await cargasEnOp(T2)) - antes.a).toBeGreaterThan(0.9);
    await expect.poll(async () => sumaHoras(await cargasEnOp(T5)) - antes.b).toBeGreaterThan(0.9);
    // Una hora de reloj con las dos en marcha: cada una carga la hora entera (el día, de reloj, suma una).
    expect(sumaHoras(await cargasEnOp(T2)) - antes.a).toBeCloseTo(1, 1);
    expect(sumaHoras(await cargasEnOp(T5)) - antes.b).toBeCloseTo(1, 1);
  } finally {
    await page.goto('/configuracion');
    if ((await varias.getAttribute('aria-checked')) === 'true') await varias.click();
    await expect(varias).toHaveAttribute('aria-checked', 'false');
  }
});

test('en Inicio, Trabajando ahora y Horas hoy', async ({ page }) => {
  await page.goto('/inicio');
  const base = await totalHoyServidor(page);
  await trabajarEn(page, T1, TITULO(1));
  retrocederTramosAbiertos(45);
  await page.goto('/inicio');

  const tarjeta = page.getByRole('region', { name: 'Trabajando ahora' });
  await expect(tarjeta).toContainText(TITULO(1));
  await expect(tarjeta.getByRole('timer')).toHaveText(/^0:4[5-9]:\d\d$/);
  // «Horas hoy» suma lo de antes más los 45 minutos que lleva el reloj, y sigue corriendo: se compara contra
  // lo que dice el servidor en cada intento, con un margen para el tic que pasa entre la lectura y el dibujo.
  const total = await totalHoyServidor(page);
  expect(total - base).toBeGreaterThanOrEqual(45 * 60);
  const horasHoy = page.locator('dl.contador').filter({ hasText: 'Horas hoy' }).locator('b');
  await expect.poll(async () => {
    const delServidor = await totalHoyServidor(page);
    const texto = (await horasHoy.innerText()).trim();
    return [-60, 0, 60].some((desvio) => texto === duracionTexto(delServidor + desvio));
  }).toBe(true);

  // Fuera de Inicio queda la isla con el reloj.
  await page.goto('/equipo');
  await expect(page.getByRole('link', { name: /^Trabajando en Tarea de prueba 1: \d+:\d\d:\d\d\. Ir a Inicio$/ })).toBeVisible();
});

test('al llegar al tope, el aviso deja seguir con horas extra y el reloj vuelve a correr', async ({ page }) => {
  test.setTimeout(240_000); // el aviso aparece cuando la ronda del servidor (cada 60 s) termina de cargar el tramo
  // El botón es para un tope de hoy: el navegador tiene que estar en el mismo día que el reloj de prueba del servidor.
  const reloj = process.env.OPENDASH_AHORA_PRUEBA;
  if (reloj !== undefined) await page.clock.setFixedTime(new Date(reloj));
  await trabajarEn(page, T2, TITULO(2));
  retrocederTramosAbiertos(8 * 60);
  const seguir = page.getByRole('button', { name: 'Seguir con horas extra' });
  await expect(async () => {
    await page.goto('/equipo');
    await expect(seguir).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 180_000 });
  await expect(page.getByText(`Hoy «${TITULO(2)}» se frenó solo al llegar a las 8 h`)).toBeVisible();
  await seguir.click();
  await expect(page.getByRole('link', { name: new RegExp(String.raw`^Trabajando en ${TITULO(2)}: \d+:\d\d:\d\d\. Ir a Inicio$`) })).toBeVisible();
  await expect(seguir).toHaveCount(0);
  const estado = await page.evaluate(async () => ((await (await fetch('/api/horas')).json()) as { datos: { horasExtra: boolean; totalHoySegundos: number } }).datos);
  expect(estado.horasExtra).toBe(true);
  expect(estado.totalHoySegundos).toBeGreaterThanOrEqual(8 * 3600);
});

test('Equipo muestra Trabajando', async ({ page }) => {
  await trabajarEn(page, T5, TITULO(5));
  await page.goto('/equipo');
  await expect(page.getByRole('heading', { name: 'Equipo', exact: true })).toBeVisible();
  const mia = page.locator('article.tarjeta-persona[data-yo]');
  await expect(mia).toContainText(`Trabajando en «${TITULO(5)}»`);
  // Puede haber más gente trabajando en la misma base: alcanza con que esté al menos quien mira.
  await expect.poll(async () => Number(await page.locator('dl.contador').filter({ hasText: 'Trabajando' }).locator('b').first().innerText())).toBeGreaterThanOrEqual(1);
});
