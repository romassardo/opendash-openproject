// Supuestos del entorno: OpenProject de prueba en Docker (docker-compose.prueba.yml) con estados en inglés
// («In progress», «Closed»), `docker compose` en el PATH (los rails runner lo usan) y Chrome instalado.
// La spec del token revocado tarda ~40 s porque corre tres rails runner.
import { expect, test } from '@playwright/test';
import {
  arrastrar, cambiarTituloEnOp, comentariosEnOp, crearTokenAdmin, esperasEnOp, estadoEnOp, leerSembrado,
  registrar, revocarToken, tarjeta, tituloEnOp, versionEnOp,
} from './ayudas.js';

// Tareas sembradas: t1 y t2 se mueven, t4 (sin responsable) recibe título, comentario y dependencia, t5 se busca.
// Los ids se leen al correr: la preparación global resiembra OpenProject antes de las pruebas.
let T1 = 0, T2 = 0, T4 = 0, T5 = 0;
test.beforeAll(() => {
  [T1, T2, , T4, T5] = leerSembrado().tareas as [number, number, number, number, number];
});

test('primera vez con token, ver el tablero y mover una tarea', async ({ page }) => {
  await registrar(page);
  await expect(tarjeta(page, T1)).toContainText('Tarea de prueba 1');
  await arrastrar(page, T1, 'En curso');
  await expect.poll(() => estadoEnOp(T1)).toBe('In progress');
  await expect(page.getByRole('region', { name: 'En curso', exact: true }).locator(`[data-tarea-id="${T1}"]`)).toBeVisible();
});

test('mover a Cerrado también pasa la versión a Finalizado', async ({ page }) => {
  await registrar(page);
  await arrastrar(page, T2, 'Cerrado');
  await expect.poll(() => estadoEnOp(T2)).toBe('Closed');
  await expect.poll(() => versionEnOp(T2)).toBe('Finalizado');
});

test('conflicto: otro cambia la tarea y al guardar no se pisa', async ({ page }) => {
  await registrar(page);
  await page.goto(`/tareas/${T4}`);
  const titulo = page.getByRole('textbox', { name: 'Título', exact: true });
  await expect(titulo).toHaveValue(/Tarea de prueba 4/);

  // La persona empieza a editar; mientras tanto alguien cambia el título directo en OpenProject.
  await titulo.fill('Mi título desde la app');
  await cambiarTituloEnOp(T4, 'Título de otra persona');
  await titulo.press('Enter');

  const suya = page.getByRole('group', { name: 'Tu versión del título' });
  await expect(suya).toContainText('Mi título desde la app');
  await expect(titulo).toHaveValue('Título de otra persona');
  expect(await tituloEnOp(T4)).toBe('Título de otra persona');

  await suya.getByRole('button', { name: 'Reaplicar' }).click();
  await expect.poll(() => tituloEnOp(T4)).toBe('Mi título desde la app');
  await expect(suya).toBeHidden();
});

test('token revocado: la app pide uno nuevo', async ({ page }) => {
  test.setTimeout(120_000); // cada rails runner tarda ~10 s
  const propio = crearTokenAdmin();
  await registrar(page, propio);
  revocarToken(propio);
  await page.reload();

  const dialogo = page.getByRole('dialog', { name: 'Tu token de OpenProject venció' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Token nuevo').fill(crearTokenAdmin());
  await dialogo.getByRole('button', { name: 'Guardar token' }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Tareas', exact: true })).toBeVisible();
  await expect(tarjeta(page, T1)).toBeVisible();
});

test('detalle: comentar y agregar una dependencia «Espera a…»', async ({ page }) => {
  await registrar(page);
  await page.goto(`/tareas/${T4}`);

  await page.getByRole('textbox', { name: 'Nuevo comentario' }).fill('Comentario desde E2E');
  await page.getByRole('button', { name: 'Comentar', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Comentarios' })).toContainText('Comentario desde E2E');
  await expect.poll(() => comentariosEnOp(T4)).toContain('Comentario desde E2E');

  const espera = page.getByRole('combobox', { name: 'Agregar a «Espera a…»' });
  await espera.fill('prueba 5');
  await page.getByRole('option', { name: /Tarea de prueba 5/ }).click();
  await expect(page.getByRole('list', { name: 'Espera a…' })).toContainText('Tarea de prueba 5');
  await expect.poll(() => esperasEnOp(T4)).toEqual([T5]);
});

test('búsqueda con Ctrl+K abre el detalle de la tarea', async ({ page }) => {
  await registrar(page);
  await page.keyboard.press('Control+k');
  const campo = page.getByRole('combobox', { name: 'Buscar tareas, proyectos y personas' });
  await expect(campo).toBeFocused();
  await campo.fill('prueba 5');
  await expect(page.getByRole('option', { name: /Tarea de prueba 5/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/tareas/${T5}$`));
  await expect(page.getByRole('textbox', { name: 'Título', exact: true })).toHaveValue(/Tarea de prueba 5/);
});
