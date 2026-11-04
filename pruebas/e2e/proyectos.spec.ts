// E2E de Proyectos contra el OpenProject de Docker: fijar un proyecto lo lleva a la barra lateral.
import { expect, test } from '@playwright/test';
import { entrar } from './ayudas.js';

test('fijar un proyecto lo muestra en la barra lateral y abre sus tareas', async ({ page }) => {
  await entrar(page);
  await page.goto('/proyectos');
  await expect(page.getByRole('heading', { name: 'Proyectos', exact: true })).toBeVisible();

  const estrella = page.getByRole('button', { name: 'Fijar Prueba', exact: true });
  await expect(estrella).toHaveAttribute('aria-pressed', 'false');
  await estrella.click();
  await expect(estrella).toHaveAttribute('aria-pressed', 'true');

  const fijados = page.getByRole('region', { name: 'Fijados' });
  await fijados.getByRole('link', { name: 'Prueba', exact: true }).click();
  await expect(page).toHaveURL(/\/proyectos\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Prueba', exact: true })).toBeVisible();
  await expect(page.getByText('Tarea de prueba 1', { exact: true }).first()).toBeVisible();

  // Deja el proyecto sin fijar, como estaba.
  await page.goto('/proyectos');
  await page.getByRole('button', { name: 'Fijar Prueba', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fijar Prueba', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('region', { name: 'Fijados' })).toHaveCount(0);
});
