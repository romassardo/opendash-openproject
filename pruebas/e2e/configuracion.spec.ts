// E2E de Configuración contra el OpenProject de Docker: lo que se guarda sobrevive a recargar la página.
import { expect, test } from '@playwright/test';
import { registrar } from './ayudas.js';

test.beforeEach(async ({ page }) => {
  await registrar(page);
  await page.goto('/configuracion');
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
});

test('la capacidad semanal y el rol se guardan y siguen después de recargar', async ({ page }) => {
  await page.getByLabel('Rol', { exact: true }).fill('Soporte');
  await page.getByLabel('Capacidad semanal', { exact: true }).fill('32,5');
  await page.getByLabel('Capacidad semanal', { exact: true }).blur();
  await expect(page.getByText('Guardado', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Capacidad semanal', { exact: true })).toHaveValue('32,5');
  await expect(page.getByLabel('Rol', { exact: true })).toHaveValue('Soporte');
});

test('cambiar la capacidad semanal se refleja en Equipo', async ({ page }) => {
  await page.getByLabel('Capacidad semanal', { exact: true }).fill('28');
  await page.getByLabel('Capacidad semanal', { exact: true }).blur();
  await expect(page.getByText('Guardado', { exact: true }).first()).toBeVisible();
  await page.goto('/equipo');
  await expect(page.getByRole('heading', { name: 'Equipo', exact: true })).toBeVisible();
  const mia = page.locator('article.tarjeta-persona').filter({ hasText: 'Vos' });
  await expect(mia.getByText('/ 28 h', { exact: true })).toBeVisible();
});

test('el tema claro se aplica y queda guardado en la cuenta', async ({ page }) => {
  await page.getByRole('radio', { name: 'Claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro');
  const yo = await page.evaluate(async () => (await (await fetch('/api/auth/yo')).json()) as { datos: { tema: string } });
  expect(yo.datos.tema).toBe('claro');
});

test('elegir un tono para un proyecto lo guarda para el equipo', async ({ page }) => {
  const tonos = page.getByRole('radiogroup', { name: /^Tono de / }).first();
  await tonos.getByRole('radio', { name: 'rosa' }).click();
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: /^Tono de / }).first().getByRole('radio', { name: 'rosa' })).toBeChecked();
});
