// E2E de Métricas contra el OpenProject de Docker: el Excel con la tarea cerrada de la siembra.
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { expect, test } from '@playwright/test';
import { entrar } from './ayudas.js';

test('Descargar Excel baja un archivo con las cinco hojas', async ({ page }) => {
  await entrar(page);
  await page.goto('/metricas');
  await expect(page.getByRole('heading', { name: 'Métricas', exact: true })).toBeVisible();

  const boton = page.getByRole('button', { name: 'Descargar Excel' });
  await expect(boton).toBeEnabled();
  // La primera sincronización con OpenProject puede tardar: se espera a ver la tarea cerrada de la siembra.
  await expect(page.locator('.metricas__total b')).not.toHaveText(/^(0|–)$/, { timeout: 30_000 });
  const descarga = page.waitForEvent('download');
  await boton.click();
  const archivo = await descarga;
  expect(archivo.suggestedFilename()).toMatch(/^opendash-metricas-30d-\d{4}-\d\d-\d\d\.xlsx$/);

  const partes = unzipSync(new Uint8Array(await readFile((await archivo.path())!)));
  const libro = strFromU8(partes['xl/workbook.xml']!);
  for (const hoja of ['Resumen', 'Completadas', 'Abiertas', 'Carga', 'Por día']) expect(libro).toContain(hoja);
  const xmls = Object.values(partes).map((p) => strFromU8(p));
  expect(xmls.some((x) => x.includes('Tarea cerrada'))).toBe(true);
});
