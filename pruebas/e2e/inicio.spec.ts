// E2E de Inicio contra el OpenProject de Docker: el saludo al entrar (el cronómetro se prueba en horas.spec.ts).
import { expect, test } from '@playwright/test';
import { hoyArgentina, semanaDe, sumarDias } from '../../compartido/fechas.js';
import { entrar } from './ayudas.js';

test.beforeEach(async ({ page }) => {
  await entrar(page);
});

test('entrar lleva a Inicio con el saludo', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: /^(Buen día|Buenas tardes|Buenas noches), / })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Resumen de hoy' })).toBeVisible();
});

test('«Quién falta» muestra las vacaciones cargadas y las saca al borrarlas', async ({ page }) => {
  const reloj = process.env.OPENDASH_AHORA_PRUEBA;
  const hoy = hoyArgentina(reloj === undefined ? new Date() : new Date(reloj));
  const tarjeta = page.getByRole('region', { name: 'Quién falta' });
  await expect(tarjeta.getByText('Solo cuenta lo que cada uno carga en OpenDash')).toBeVisible();

  // Desde el lunes de esta semana hasta dentro de dos semanas: cubre de lunes a viernes la semana que muestra la tarjeta.
  const lunes = semanaDe(hoy).lunes;
  const respuesta = await page.request.post('/api/cuenta/vacaciones', { data: { desde: lunes, hasta: sumarDias(hoy, 14) } });
  expect(respuesta.ok()).toBe(true);
  // La API devuelve la lista de vacaciones de la persona: la creada es la que empieza el lunes.
  const { datos: lista } = (await respuesta.json()) as { datos: { id: number; desde: string }[] };
  const creada = lista.find((v) => v.desde === lunes);
  expect(creada).toBeDefined();
  const fila = tarjeta.getByRole('link', { name: 'Vos · toda la semana' });
  try {
    await page.reload();
    await expect(fila).toBeVisible();
    await expect(fila).toHaveAttribute('href', /\/equipo\/\d+$/);
  } finally {
    // Solo la vacación que creó esta prueba.
    const borrada = await page.request.delete(`/api/cuenta/vacaciones/${creada!.id}`);
    expect(borrada.ok()).toBe(true);
  }
  await page.reload();
  // No se exige la tarjeta vacía: la semana puede traer feriados.
  await expect(tarjeta.getByText('Solo cuenta lo que cada uno carga en OpenDash')).toBeVisible();
  await expect(fila).toHaveCount(0);
});
