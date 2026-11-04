// Ayudas de las pruebas E2E: datos sembrados, acceso directo a OpenProject y gestos de la interfaz.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { api, ejecutarRails, lineaDe } from '../../scripts/op-prueba.js';

export interface Sembrado {
  url: string;
  token: string;
  proyectoId: number;
  versiones: Record<string, number>;
  tareas: number[];
  /** Tareas propias de la línea de tiempo: cadena manual a → b → c (c pisada por b), cadena autoX → autoY (autoY en programación automática), una suelta y un hito. */
  linea: { a: number; b: number; c: number; autoX: number; autoY: number; suelta: number; suelta2: number; hito: number };
  /** Datos de Inicio, Proyectos, Equipo y Métricas: versión con fechas, hito, tarea larga y tarea cerrada. */
  pantallas: { version: number; hito: number; larga: number; cerrada: number };
  /** «Para ordenar»: P → Q (Q manual y pisada), una vencida, una sin fechas, una sin responsable y una atrasada para el círculo de Inicio. */
  ordenar: { p: number; q: number; vencida: number; sinFechas: number; sinResponsable: number; circulo: number };
}

export const CONTRASENA = 'clave-de-prueba-123';

export function leerSembrado(): Sembrado {
  return JSON.parse(readFileSync(fileURLToPath(new URL('./.op-prueba.json', import.meta.url)), 'utf8')) as Sembrado;
}

async function pedirOp(metodo: string, ruta: string, cuerpo?: unknown): Promise<any> {
  const s = leerSembrado();
  const { estado, json } = await api(s.url, s.token, metodo, ruta, cuerpo);
  if (estado >= 400) throw new Error(`${metodo} ${ruta} -> ${estado}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

/** Tarea de OpenProject leída con el token del sembrado (admin). */
export const leerTarea = (id: number): Promise<any> => pedirOp('GET', `/api/v3/work_packages/${id}`);

export const estadoEnOp = async (id: number): Promise<string> => (await leerTarea(id))._links.status.title;
export const versionEnOp = async (id: number): Promise<string | null> => (await leerTarea(id))._links.version.title ?? null;
export const tituloEnOp = async (id: number): Promise<string> => (await leerTarea(id)).subject;

/** Fechas de la tarea en OpenProject (los hitos traen solo `date`). */
export async function fechasEnOp(id: number): Promise<{ inicio: string | null; fin: string | null }> {
  const t = await leerTarea(id);
  return { inicio: t.startDate ?? t.date ?? null, fin: t.dueDate ?? t.date ?? null };
}

/** Cambia el título directo en OpenProject (a espaldas de la app). */
export async function cambiarTituloEnOp(id: number, titulo: string): Promise<void> {
  const actual = await leerTarea(id);
  await pedirOp('PATCH', `/api/v3/work_packages/${id}`, { lockVersion: actual.lockVersion, subject: titulo });
}

/** Comentarios de la tarea según las actividades de OpenProject. */
export async function comentariosEnOp(id: number): Promise<string[]> {
  const json = await pedirOp('GET', `/api/v3/work_packages/${id}/activities`);
  return json._embedded.elements
    .map((a: any) => a.comment?.raw as string | undefined)
    .filter((c: string | undefined): c is string => c !== undefined && c !== '');
}

/** Tareas que la indicada sigue (relaciones `follows` donde es origen). */
export async function esperasEnOp(id: number): Promise<number[]> {
  const json = await pedirOp('GET', `/api/v3/work_packages/${id}/relations`);
  return json._embedded.elements
    .filter((r: any) => r.type === 'follows' && r._links.from.href.endsWith(`/${id}`))
    .map((r: any) => Number(r._links.to.href.split('/').pop()));
}

/** Crea un token de API para admin (no toca los existentes) y lo devuelve. */
export function crearTokenAdmin(): string {
  const salida = ejecutarRails("t = Token::API.create!(user: User.find_by!(login: 'admin'))\nputs \"TOKEN_ADMIN=#{t.plain_value}\"\n");
  return lineaDe(salida, 'TOKEN_ADMIN');
}

/**
 * Crea una persona descartable de OpenProject (sin permisos de admin) con su token de API y lo devuelve. Credenciales
 * SOLO DE PRUEBA del Docker local. `login` solo lleva letras minúsculas y números.
 */
export function crearUsuarioConToken(login: string): string {
  if (!/^[a-z0-9]+$/.test(login)) throw new Error('El login de prueba solo lleva letras minúsculas y números');
  const salida = ejecutarRails(`
u = User.find_by(login: '${login}') || User.new(login: '${login}', firstname: 'Autora', lastname: 'De avisos', mail: '${login}@example.com')
u.password = 'Clave-solo-de-prueba-12345'
u.password_confirmation = 'Clave-solo-de-prueba-12345'
u.admin = false
u.save!
u.update_column(:status, Principal.statuses[:active])
Token::API.where(user_id: u.id).destroy_all
puts "TOKEN_USUARIO=#{Token::API.create!(user: u).plain_value}"
`);
  return lineaDe(salida, 'TOKEN_USUARIO');
}

/** Borra solo el token indicado (los demás de admin siguen válidos). */
export function revocarToken(token: string): void {
  const valor = JSON.stringify(token);
  const salida = ejecutarRails(
    `t = Token::API.find_by_plaintext_value(${valor})\nt&.destroy!\nputs "REVOCADO=#{t ? 'si' : 'no'}"\n`,
  );
  if (lineaDe(salida, 'REVOCADO') !== 'si') throw new Error('No se encontró el token a revocar');
}

/** Crea la cuenta con el token indicado y deja a la persona en Inicio. */
export async function entrar(page: Page, token: string = leerSembrado().token): Promise<void> {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Primera vez' }).click();
  await page.getByLabel('Token de OpenProject').fill(token);
  await page.getByLabel('Contraseña', { exact: true }).fill(CONTRASENA);
  await page.getByLabel('Repetir contraseña').fill(CONTRASENA);
  await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

/** Entra y va a Tareas (las pruebas de Tareas y de la línea trabajan desde ahí). */
export async function registrar(page: Page, token: string = leerSembrado().token): Promise<void> {
  await entrar(page, token);
  await page.goto('/tareas');
  await expect(page.getByRole('heading', { name: 'Tareas', exact: true })).toBeVisible();
}

export const tarjeta = (page: Page, id: number): Locator => page.locator(`[data-tarea-id="${id}"]`);
export const columna = (page: Page, nombre: string): Locator => page.getByRole('region', { name: nombre, exact: true });

/** Arrastra la tarjeta a la columna con el mouse (down, movimientos intermedios, up). */
export async function arrastrar(page: Page, id: number, destino: string): Promise<void> {
  const origen = tarjeta(page, id);
  await origen.scrollIntoViewIfNeeded();
  await expect(origen).toBeVisible();
  const a = (await origen.boundingBox())!;
  const b = (await columna(page, destino).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(120, b.height / 2), { steps: 15 });
  await page.mouse.up();
}

/** Entra a la línea de tiempo (la sesión ya está abierta). */
export async function irALinea(page: Page): Promise<void> {
  await page.goto('/linea-de-tiempo');
  await expect(page.getByRole('heading', { name: 'Línea de tiempo', exact: true })).toBeVisible();
}

export const barra = (page: Page, id: number): Locator => page.locator(`button[data-tarea-id="${id}"]`);

/** Arrastra la barra `dias` días a la derecha; el ancho de un día sale del ancho de la barra, que dura `diasDeLaBarra`. */
export async function arrastrarBarra(page: Page, id: number, dias: number, diasDeLaBarra: number): Promise<void> {
  const origen = barra(page, id);
  await origen.scrollIntoViewIfNeeded();
  // La entrada escalonada deja la barra oculta hasta su turno: no se arrastra antes de que aparezca del todo.
  await expect(origen).toBeVisible();
  await expect.poll(() => origen.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  // La entrada animada de la pantalla mueve las barras un rato: se espera a que la caja deje de cambiar.
  let caja = (await origen.boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const nueva = (await origen.boundingBox())!;
    const quieta = nueva.x === caja.x && nueva.y === caja.y && nueva.width === caja.width;
    caja = nueva;
    if (quieta) break;
  }
  const px = (caja.width / diasDeLaBarra) * dias;
  const x = caja.x + caja.width / 2;
  const y = caja.y + caja.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + px / 2, y, { steps: 5 });
  await page.mouse.move(x + px, y, { steps: 5 });
  await page.mouse.up();
}

/** Espera a que la entrada escalonada termine y devuelve la caja quieta del elemento. */
async function cajaQuieta(page: Page, el: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await el.scrollIntoViewIfNeeded();
  await expect(el).toBeVisible();
  let caja = (await el.boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const nueva = (await el.boundingBox())!;
    const quieta = nueva.x === caja.x && nueva.y === caja.y && nueva.width === caja.width;
    caja = nueva;
    if (quieta) break;
  }
  return caja;
}

export const renglonTarea = (page: Page, id: number): Locator => page.locator(`[data-renglon-tarea="${id}"]`);

/** Une dos tareas: arrastra el puntito de la barra `antes` hasta el centro del renglón de `despues`. */
export async function unirBarras(page: Page, antes: number, despues: number): Promise<void> {
  const origen = barra(page, antes);
  await expect.poll(() => origen.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await cajaQuieta(page, origen);
  const punto = (await page.locator(`[data-unir="${antes}"]`).boundingBox())!;
  const destino = await cajaQuieta(page, renglonTarea(page, despues));
  const x = punto.x + punto.width / 2;
  const y = punto.y + punto.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y + 10, { steps: 4 });
  await page.mouse.move(destino.x + destino.width / 2, destino.y + destino.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** Arrastra el ⠿ de la tarea `renglones` renglones (positivo hacia abajo). */
export async function ordenarArrastrando(page: Page, id: number, renglones: number): Promise<void> {
  const asa = page.locator(`[data-orden="${id}"]`);
  const fila = renglonTarea(page, id);
  const caja = await cajaQuieta(page, fila);
  const a = (await asa.boundingBox())!;
  const x = a.x + a.width / 2;
  const y = a.y + a.height / 2;
  const dy = caja.height * renglones;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy / 2, { steps: 6 });
  await page.mouse.move(x, y + dy, { steps: 6 });
  await page.mouse.up();
}

/** Toca «Deshacer» en el aviso de la línea. */
export async function deshacer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
}

/** Ids de las tareas en el orden en que aparecen los renglones. */
export const ordenDeRenglones = (page: Page): Promise<number[]> =>
  page.locator('[data-renglon-tarea]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.renglonTarea)));

/** Pasa el mouse por la mitad de la flecha entre dos tareas y suelta la unión con la ×. */
export async function soltarUnion(page: Page, de: number, a: number): Promise<void> {
  const zona = page.locator(`g[data-de="${de}"][data-a="${a}"] .flecha__zona`);
  await expect(zona).toBeAttached();
  // Se baja hasta la flecha y se espera a que la entrada escalonada de las barras termine.
  await zona.scrollIntoViewIfNeeded();
  await cajaQuieta(page, renglonTarea(page, de));
  const punto = await zona.evaluate((el) => {
    const path = el as unknown as SVGGeometryElement;
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM()!;
    return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
  });
  await page.mouse.move(punto.x - 20, punto.y - 20);
  await page.mouse.move(punto.x, punto.y, { steps: 5 });
  const cruz = page.locator('.flecha__soltar');
  await expect(cruz).toBeVisible();
  await cruz.click();
}

/** Una carga de tiempo de OpenProject: id, horas (de la duración ISO) y comentario. */
export interface CargaOp { id: number; horas: number; comentario: string }

function horasDeIso(iso: string): number {
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (m === null) throw new Error(`Duración ISO inesperada: ${iso}`);
  return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600;
}

/** Cargas de tiempo de OpenProject de una tarea (de cualquier persona), leídas con la API. */
export async function cargasEnOp(tareaId: number): Promise<CargaOp[]> {
  const filtros = JSON.stringify([
    { entityType: { operator: '=', values: ['WorkPackage'] } },
    { entityId: { operator: '=', values: [String(tareaId)] } },
  ]);
  const json = await pedirOp('GET', `/api/v3/time_entries?pageSize=100&filters=${encodeURIComponent(filtros)}`);
  return json._embedded.elements.map((e: any) => ({ id: e.id as number, horas: horasDeIso(e.hours as string), comentario: (e.comment?.raw ?? '') as string }));
}

export const sumaHoras = (cargas: readonly CargaOp[]): number => cargas.reduce((total, c) => total + c.horas, 0);

/**
 * Simula que pasó tiempo: retrocede `minutos` el comienzo de los tramos ABIERTOS y de sus pedazos abiertos (el
 * reloj del servidor corre solo, así que no se puede esperar 90 minutos de verdad). Lo ya cerrado no se toca.
 * Depende de los nombres de las tablas `tramos_trabajo` y `pedazos_trabajo` y de sus columnas.
 */
export function retrocederTramosAbiertos(minutos: number): void {
  const carpeta = process.env.OPENDASH_E2E_CARPETA;
  if (carpeta === undefined) throw new Error('Falta OPENDASH_E2E_CARPETA: la corre playwright.config.ts');
  const db = new Database(join(carpeta, 'opendash.db'));
  try {
    db.pragma('busy_timeout = 5000');
    const antes = (iso: string): string => new Date(Date.parse(iso) - minutos * 60_000).toISOString();
    db.transaction(() => {
      for (const t of db.prepare('select id, inicio from tramos_trabajo where fin is null').all() as Array<{ id: number; inicio: string }>) {
        db.prepare('update tramos_trabajo set inicio = ? where id = ?').run(antes(t.inicio), t.id);
        // Solo el pedazo que sigue abierto corre hacia atrás; los pedazos cerrados de una pausa quedan donde estaban.
        for (const p of db.prepare('select id, desde from pedazos_trabajo where tramo_id = ? and hasta is null').all(t.id) as Array<{ id: number; desde: string }>) {
          db.prepare('update pedazos_trabajo set desde = ? where id = ?').run(antes(p.desde), p.id);
        }
      }
    })();
  } finally {
    db.close();
  }
}

/**
 * Deja de contar los tramos ya cerrados: los marca descartados en la base (las entradas ya cargadas en OpenProject
 * quedan como están). Así lo que cerró una prueba no se superpone con lo que corre en la siguiente. Depende de
 * los nombres de la tabla `tramos_trabajo` y de sus columnas `fin` y `estado`.
 */
export function olvidarTramosCerrados(): void {
  const carpeta = process.env.OPENDASH_E2E_CARPETA;
  if (carpeta === undefined) throw new Error('Falta OPENDASH_E2E_CARPETA: la corre playwright.config.ts');
  const db = new Database(join(carpeta, 'opendash.db'));
  try {
    db.pragma('busy_timeout = 5000');
    db.prepare("update tramos_trabajo set estado = 'descartado' where fin is not null").run();
    // Las horas extra de una prueba tampoco: la siguiente vuelve a tener tope.
    db.prepare('delete from horas_extra').run();
  } finally {
    db.close();
  }
}

/** Termina por la API todo lo que la persona tenga en marcha (limpieza entre pruebas). */
export async function terminarTodo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const estado = (await (await fetch('/api/horas')).json()) as { datos?: { enMarcha: Array<{ id: number }> } };
    for (const t of estado.datos?.enMarcha ?? []) await fetch(`/api/horas/${t.id}/terminar`, { method: 'POST' });
  });
}

/** Abre la tarea y aprieta «Trabajar en esta». */
export async function trabajarEn(page: Page, id: number, titulo: string): Promise<void> {
  await page.goto(`/tareas/${id}`);
  // El tablero de fondo también tiene un ▶ chico con el mismo nombre: se usa el del panel.
  const panel = page.getByRole('dialog', { name: titulo });
  // Recién arrancado el servidor puede faltar el catálogo de estados y el primer ▶ se rechaza: se reintenta.
  await expect(async () => {
    const jugar = panel.getByRole('button', { name: `Trabajar en esta: ${titulo}` });
    if (await jugar.isVisible()) await jugar.click();
    await expect(panel.getByRole('timer', { name: `Tiempo trabajado en ${titulo}` })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
}
