// E2E del aviso antes de una reunión. Outlook es el servidor falso (pruebas/e2e/servidor-falso.ts), que con
// `?proxima=1` suma una reunión que empieza dentro de 3 minutos.
import { expect, test } from '@playwright/test';
import { entrar } from './ayudas.js';
import { MINUTOS_REUNION_PROXIMA, ORIGEN_FALSO } from './puertos.js';

test.beforeEach(async ({ page }) => {
  await entrar(page);
});

// El enlace guardado no debe quedar para otros specs, aunque falle una aserción.
test.afterEach(async ({ page }) => {
  const respuesta = await page.request.put('/api/cuenta/calendario', { data: { url: null } });
  expect(respuesta.ok()).toBe(true);
});

test('una reunión que empieza en minutos muestra «En N min · Título · Unirse»', async ({ page }) => {
  // El reloj del servidor falso corre solo desde que arrancó la corrida: se fija el del navegador en el instante
  // exacto (3 minutos antes) en que empieza la reunión del servidor falso, así «En 3 min» no depende de cuánto lleve la corrida.
  const { inicio } = (await (await page.request.get(`${ORIGEN_FALSO}/proxima.json`)).json()) as { inicio: string };
  await page.clock.setFixedTime(new Date(Date.parse(inicio) - MINUTOS_REUNION_PROXIMA * 60_000));
  const guardado = await page.request.put('/api/cuenta/calendario', { data: { url: `${ORIGEN_FALSO}/calendario.ics?proxima=1` } });
  expect(guardado.ok()).toBe(true);

  await page.goto('/tareas');
  const aviso = page.locator('.aviso-reunion');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText(/En [123] min/);
  await expect(aviso).toContainText('Reunión próxima');
  await expect(aviso.getByRole('link', { name: 'Unirse' })).toHaveAttribute('href', 'https://meet.google.com/pro-xima-aaa');

  await aviso.getByRole('button', { name: 'Cerrar aviso' }).click();
  await expect(aviso).toBeHidden();
});
