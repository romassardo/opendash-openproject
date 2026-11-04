// E2E de «Avisar un problema»: una persona avisa con una imagen, el receptor lo ve en «Problemas avisados», lo marca
// «Arreglado» y la autora lo ve arreglado en «Tus avisos». Dos personas de OpenProject, cada una en su navegador.
import { expect, test, type Page } from '@playwright/test';
import { crearUsuarioConToken, entrar } from './ayudas.js';

// PNG de 1×1 píxel: alcanza para que el servidor lo reconozca por sus primeros bytes.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Pone a `receptores` como lista de quienes reciben los avisos y devuelve la lista que había antes. */
async function fijarReceptores(page: Page, receptores: number[] | 'yo'): Promise<number[]> {
  const resultado = await page.evaluate(async (nuevos) => {
    const leer = async <T,>(ruta: string): Promise<T> => ((await (await fetch(ruta)).json()) as { datos: T }).datos;
    const antes = (await leer<{ avisos: { receptores: number[] } }>('/api/ajustes')).avisos.receptores;
    const lista = nuevos === 'yo' ? [(await leer<{ id: number }>('/api/auth/yo')).id] : nuevos;
    const res = await fetch('/api/ajustes/avisos', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receptores: lista }),
    });
    return { estado: res.status, antes };
  }, receptores);
  expect(resultado.estado).toBe(200);
  return resultado.antes;
}

test('avisar un problema: le llega al receptor, lo marca «Arreglado» y la autora lo ve arreglado', async ({ browser, baseURL }) => {
  test.setTimeout(120_000); // crear a la autora corre rails runner (~10 s)
  const texto = `La lista de tareas no carga ${Date.now()}`;
  const tokenAutora = crearUsuarioConToken(`autora${Date.now()}`);
  let receptoresAntes: number[] = [];
  let receptorPage: Page | null = null;
  const contextoReceptor = await browser.newContext({ baseURL });
  const contextoAutora = await browser.newContext({ baseURL });
  try {
    const receptor = await contextoReceptor.newPage();
    await entrar(receptor);
    receptoresAntes = await fijarReceptores(receptor, 'yo');
    receptorPage = receptor;

    const autora = await contextoAutora.newPage();
    await entrar(autora, tokenAutora);
    await autora.getByRole('button', { name: 'Avisar un problema' }).click();
    const dialogo = autora.getByRole('dialog', { name: 'Avisar un problema' });
    await dialogo.getByLabel('¿Qué pasó o qué te falta?').fill(texto);
    await dialogo.locator('input[type="file"]').setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: PNG });
    await expect(dialogo.getByRole('img', { name: 'Vista previa de la imagen adjunta' })).toBeVisible();
    await dialogo.getByRole('button', { name: 'Enviar' }).click();
    await expect(dialogo.getByRole('status')).toContainText('Gracias, le llegó a');
    await expect(dialogo.getByRole('list').getByRole('listitem').filter({ hasText: texto })).toContainText('Nuevo');
    await dialogo.getByRole('button', { name: 'Cerrar' }).click();

    // El receptor lo ve en «Problemas avisados», con la captura, y lo marca arreglado.
    await receptor.goto('/problemas-avisados');
    await expect(receptor.getByRole('heading', { name: 'Problemas avisados', exact: true })).toBeVisible();
    const fila = receptor.locator('li.problemas__fila').filter({ hasText: texto });
    await expect(fila).toContainText('Nuevo');
    await expect(fila.getByRole('img', { name: 'Captura adjunta al aviso' })).toBeVisible();
    await fila.getByRole('button', { name: 'Arreglado', exact: true }).click();
    await expect(fila.locator('.avisar__estado')).toHaveText('Arreglado');

    // La autora vuelve a abrir el diálogo y ve su aviso arreglado.
    await autora.reload();
    await autora.getByRole('button', { name: 'Avisar un problema' }).click();
    const propios = autora.getByRole('dialog', { name: 'Avisar un problema' });
    await expect(propios.getByRole('list').getByRole('listitem').filter({ hasText: texto })).toContainText('Arreglado');
  } finally {
    // Se devuelve la lista de receptores a como estaba, aunque la prueba haya fallado.
    if (receptorPage) await fijarReceptores(receptorPage, receptoresAntes).catch(() => undefined);
    await contextoReceptor.close();
    await contextoAutora.close();
  }
});
