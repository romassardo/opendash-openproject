import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Valores sueltos; los enlaces (`assignee`, `parent`, …) se pasan como id o `null`. */
export interface ParcialTarea {
  id?: number;
  lockVersion?: number;
  subject?: string;
  description?: { raw: string | null };
  startDate?: string | null;
  dueDate?: string | null;
  estimatedTime?: string | null;
  percentageDone?: number | null;
  scheduleManually?: boolean;
  createdAt?: string;
  updatedAt?: string;
  project?: number;
  type?: number;
  status?: number;
  priority?: number;
  assignee?: number | null;
  author?: number | null;
  parent?: number | null;
  version?: number | null;
}

const RECURSOS: Record<string, string> = {
  project: 'projects', type: 'types', status: 'statuses', priority: 'priorities',
  assignee: 'users', author: 'users', parent: 'work_packages', version: 'versions',
};

const enlace = (recurso: string, id: number | null): { href: string | null } => ({
  href: id === null ? null : `/api/v3/${recurso}/${id}`,
});

export function halTarea(parcial: ParcialTarea = {}): object {
  const id = parcial.id ?? 1;
  const p = { assignee: null, author: 2, parent: null, version: null, project: 11, type: 1, status: 1, priority: 8, ...parcial };
  const enlaces = Object.fromEntries(
    Object.entries(RECURSOS).map(([clave, recurso]) => [clave, enlace(recurso, p[clave as keyof typeof RECURSOS & keyof typeof p] as number | null)]),
  );
  return {
    _type: 'WorkPackage',
    id,
    lockVersion: parcial.lockVersion ?? 0,
    subject: parcial.subject ?? `Tarea ${id}`,
    description: parcial.description ?? { format: 'markdown', raw: 'Descripción', html: '<p>Descripción</p>' },
    startDate: parcial.startDate ?? null,
    dueDate: parcial.dueDate ?? null,
    estimatedTime: parcial.estimatedTime ?? null,
    percentageDone: parcial.percentageDone ?? 0,
    scheduleManually: parcial.scheduleManually ?? true,
    createdAt: parcial.createdAt ?? '2026-10-01T10:00:00.000Z',
    updatedAt: parcial.updatedAt ?? '2026-10-02T10:00:00.000Z',
    _links: enlaces,
  };
}

export function halColeccion(elementos: object[], total: number = elementos.length): object {
  return {
    _type: 'Collection',
    total,
    count: elementos.length,
    pageSize: 100,
    offset: 1,
    _embedded: { elements: elementos },
  };
}

export function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/hal+json' } });
}

/** Lee una respuesta grabada de `pruebas/fixtures/op/<nombre>`. */
export function leerFixture(nombre: string): any {
  return JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/op', nombre), 'utf8'));
}
