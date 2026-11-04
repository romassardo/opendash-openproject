// Anchos de notebook: ninguna pantalla del menú desborda la página en 1100, 1280 y 1366 px de ancho.
// Las capturas quedan en test-results/anchos/ para mirarlas (texto cortado o encimado cuenta aunque no haya scroll).
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { entrar } from './ayudas.js';

const ANCHOS = [1100, 1280, 1366];
const ALTO = 720;
const PANTALLAS = [
  { ruta: '/inicio' },
  { ruta: '/tareas' },
  { ruta: '/para-ordenar' },
  { ruta: '/proyectos' },
  { ruta: '/linea-de-tiempo' },
  { ruta: '/equipo' },
  { ruta: '/metricas' },
  { ruta: '/calendario' },
  { ruta: '/configuracion' },
];

test('las pantallas no desbordan en anchos de notebook', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync('test-results/anchos', { recursive: true });
  await page.setViewportSize({ width: 1280, height: ALTO });
  await entrar(page);

  const desbordes: string[] = [];
  for (const ancho of ANCHOS) {
    await page.setViewportSize({ width: ancho, height: ALTO });
    for (const { ruta } of PANTALLAS) {
      await page.goto(ruta);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // En Inicio, «Quién falta» es la última tarjeta en cargar: se la espera para medir la pantalla completa.
      if (ruta === '/inicio') await expect(page.getByRole('region', { name: 'Quién falta' }).getByText('Cargando…')).toHaveCount(0);
      // Deja terminar la carga de datos y las animaciones de entrada antes de medir.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `test-results/anchos/${ruta.slice(1)}-${ancho}.png` });
      const medidas = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, ventana: window.innerWidth }));
      if (medidas.ancho > medidas.ventana) desbordes.push(`${ruta} a ${ancho}px: la página mide ${medidas.ancho}px`);
      // La esquina de las islas y el aviso de reunión se acomoda con --ancho-herramientas: no puede ser menor que la barra real.
      const barra = await page.evaluate(() => ({
        real: document.querySelector('.herramientas')?.getBoundingClientRect().width ?? 0,
        ancho: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ancho-herramientas')),
      }));
      if (barra.ancho < barra.real) desbordes.push(`${ruta} a ${ancho}px: --ancho-herramientas (${barra.ancho}px) es menor que la barra superior (${barra.real}px)`);
    }
  }
  expect(desbordes).toEqual([]);
});
