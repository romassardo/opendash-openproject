// Graba respuestas reales de OpenProject, anonimizadas, en pruebas/fixtures/op/.
// Solo hace GET. Uso: npx tsx --env-file=.env scripts/grabar-fixtures.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearAnonimizador } from '../pruebas/anonimizar.js';

type Json = any;

const url = process.env.OPENPROJECT_URL?.replace(/\/+$/, '');
const token = process.env.OP_TOKEN_LECTURA;
if (!url || !token) {
  console.error('Faltan OPENPROJECT_URL y/o OP_TOKEN_LECTURA en el entorno');
  process.exit(1);
}

const destino = resolve(dirname(fileURLToPath(import.meta.url)), '../pruebas/fixtures/op');
const autorizacion = `Basic ${Buffer.from(`apikey:${token}`).toString('base64')}`;
const anonimizar = crearAnonimizador();

async function obtener(ruta: string): Promise<Json> {
  const res = await fetch(`${url}${ruta}`, { method: 'GET', headers: { Authorization: autorizacion, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${ruta} → HTTP ${res.status}`);
  return res.json();
}

function guardar(nombre: string, contenido: Json): void {
  writeFileSync(resolve(destino, nombre), `${JSON.stringify(anonimizar(contenido), null, 2)}\n`, 'utf8');
  console.log(`Guardado ${nombre}`);
}

const idDeHref = (href: string | null | undefined): number | null => {
  const m = /\/(\d+)\/?$/.exec(href ?? '');
  return m ? Number(m[1]) : null;
};

mkdirSync(destino, { recursive: true });

const estados = await obtener('/api/v3/statuses');
guardar('statuses.json', estados);
guardar('types.json', await obtener('/api/v3/types'));
guardar('priorities.json', await obtener('/api/v3/priorities'));
guardar('projects.json', await obtener('/api/v3/projects'));
guardar('principals.json', await obtener('/api/v3/principals?pageSize=100'));

const tareas = await obtener('/api/v3/work_packages?pageSize=100&filters=[]');
guardar('work_packages.json', tareas);

const idsCerrados = new Set<number>(estados._embedded.elements.filter((e: Json) => e.isClosed).map((e: Json) => e.id));
const cerrada = tareas._embedded.elements.find((t: Json) => idsCerrados.has(idDeHref(t._links?.status?.href) ?? -1));
if (cerrada) {
  guardar('activities.json', await obtener(`/api/v3/work_packages/${cerrada.id}/activities`));
} else {
  console.warn('No hay ninguna tarea cerrada en la primera página: se omite activities.json');
}

console.log('Revisá a ojo que no quedó ningún nombre real antes de commitear los fixtures.');
