// E2E del calendario, los feriados y las vacaciones. Outlook y ArgentinaDatos son el servidor falso
// (pruebas/e2e/servidor-falso.ts); OpenProject, el de Docker.
import { expect, test, type Page } from '@playwright/test';
import { diaMesCorto, hoyArgentina } from '../../compartido/fechas.js';
import { entrar } from './ayudas.js';
import { ORIGEN_FALSO } from './puertos.js';

const ENLACE_ICS = `${ORIGEN_FALSO}/calendario.ics`;
const MS_DIA = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` de hoy (hora argentina) corrido `dias` días. */
function enDias(dias: number): string {
  const hoy = hoyArgentina(new Date());
  return new Date(Date.parse(`${hoy}T00:00:00Z`) + dias * MS_DIA).toISOString().slice(0, 10);
}

async function irAConfiguracion(page: Page): Promise<void> {
  await page.goto('/configuracion');
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await entrar(page);
});

// El enlace guardado no debe quedar para otros specs, aunque falle una aserción.
test.afterEach(async ({ page }) => {
  const respuesta = await page.request.put('/api/cuenta/calendario', { data: { url: null } });
  expect(respuesta.ok()).toBe(true);
});

test('guardar el calendario muestra la reunión en curso en Calendario, Inicio y Equipo', async ({ page }) => {
  // En fin de semana el servidor corre su reloj al viernes (playwright.config.ts): el navegador, igual.
  const reloj = process.env.OPENDASH_AHORA_PRUEBA;
  if (reloj !== undefined) await page.clock.setFixedTime(new Date(reloj));
  await irAConfiguracion(page);
  await page.getByLabel('Enlace ICS').fill(ENLACE_ICS);
  await page.getByRole('button', { name: 'Guardar enlace' }).click();
  // El servidor lee el enlace al guardarlo: ya trae la hora de la lectura.
  await expect(page.getByText(/^Guardado · actualizado \d\d:\d\d$/)).toBeVisible();

  await page.goto('/calendario');
  const panel = page.locator('section.cal-panel');
  await expect(panel.getByRole('heading', { name: 'Reunión de prueba' })).toBeVisible();
  await expect(panel.locator('.pildora-ahora')).toHaveText('Ahora');
  const unirse = panel.getByRole('link', { name: 'Unirse a «Reunión de prueba»' });
  await expect(unirse).toHaveAttribute('href', /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//);

  await page.goto('/inicio');
  await expect(page.getByRole('link', { name: /^Próxima: \d{1,2}:\d\d, «Reunión de prueba»\. Se abre en otra pestaña$/ })).toHaveAttribute('href', /teams\.microsoft\.com\/l\/meetup-join/);

  await page.goto('/equipo');
  const mia = page.locator('article.tarjeta-persona').filter({ hasText: 'Vos' });
  await expect(mia.getByText('En reunión', { exact: true })).toBeVisible();
});

test('los feriados de la lista se ven en Configuración y en el Calendario', async ({ page }) => {
  const anio = hoyArgentina(new Date()).slice(0, 4);
  await irAConfiguracion(page);
  // La lista se baja al arrancar el servidor: si todavía no llegó, se recarga hasta que aparezca.
  // Salen este año y el que viene, con el mismo feriado y el mismo «8 dic»: la fila de este año se reconoce por
  // el día de la semana, que cambia de un año al siguiente.
  const diaSemana = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${anio}-12-08T00:00:00Z`))
    .replace(/\./g, '');
  const fila = page
    .getByRole('table', { name: 'Feriados' })
    .getByRole('row', { name: /Inmaculada Concepción de María/ })
    .filter({ hasText: `${diaSemana} ${diaMesCorto(`${anio}-12-08`)}` });
  await expect(async () => {
    await page.reload();
    await expect(fila).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(fila.getByRole('cell').first()).toContainText(diaMesCorto(`${anio}-12-08`));

  await page.goto(`/calendario?dia=${anio}-12-08`);
  await expect(page.getByRole('button', { name: /feriado: Inmaculada Concepción de María/ })).toBeVisible();
});

test('cargar y quitar vacaciones en Mi cuenta', async ({ page }) => {
  const desde = enDias(30);
  const hasta = enDias(34);
  // Dentro del mismo mes el mes del primer día no se repite: «5 – 9 ene».
  const esperado =
    desde.slice(0, 7) === hasta.slice(0, 7) ? `${Number(desde.slice(8))} – ${diaMesCorto(hasta)}` : `${diaMesCorto(desde)} – ${diaMesCorto(hasta)}`;

  await irAConfiguracion(page);
  const formulario = page.getByRole('form', { name: 'Agregar vacaciones' });
  await formulario.getByLabel('Desde').fill(desde);
  await formulario.getByLabel('Hasta').fill(hasta);
  await formulario.getByRole('button', { name: 'Agregar' }).click();

  const quitar = page.getByRole('button', { name: `Quitar vacaciones del ${esperado}` });
  await expect(quitar).toBeVisible();
  await expect(page.getByText(esperado, { exact: true })).toBeVisible();

  await page.reload();
  await expect(quitar).toBeVisible();

  await quitar.click();
  await expect(quitar).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('form', { name: 'Agregar vacaciones' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Quitar vacaciones del / })).toHaveCount(0);
});
