import { idDeRuta } from '../tareas/baseTareas.js';
import type { Vista, Zoom } from './modelo.js';

/** Todo lo que se elige en la pantalla vive en la dirección (`?vista=&zoom=&desde=…`), así se comparte y sobrevive a recargar. */
export interface ControlesLinea {
  vista: Vista;
  zoom: Zoom;
  /** Primer día de la ventana; sin él, el lunes de la semana actual. */
  desde: string | null;
  soloConDependencias: boolean;
  proyectoId: number | null;
  personaId: number | null;
}

const VISTAS: readonly Vista[] = ['proyecto', 'persona', 'todas'];
const ZOOMS: readonly Zoom[] = ['semana', 'mes', 'trimestre'];

const opcion = <T extends string>(validas: readonly T[], crudo: string | null, porDefecto: T): T =>
  validas.find((v) => v === crudo) ?? porDefecto;

const fechaValida = (crudo: string | null): string | null =>
  crudo !== null && /^\d{4}-\d{2}-\d{2}$/.test(crudo) && !Number.isNaN(Date.parse(`${crudo}T00:00:00Z`)) ? crudo : null;

const idOpcional = (crudo: string | null): number | null => {
  if (crudo === null) return null;
  const id = idDeRuta(crudo);
  return Number.isNaN(id) ? null : id;
};

export function leerControles(params: URLSearchParams): ControlesLinea {
  return {
    vista: opcion(VISTAS, params.get('vista'), 'proyecto'),
    zoom: opcion(ZOOMS, params.get('zoom'), 'semana'),
    desde: fechaValida(params.get('desde')),
    soloConDependencias: params.get('dependencias') === '1',
    proyectoId: idOpcional(params.get('proyecto')),
    personaId: idOpcional(params.get('persona')),
  };
}

/** Copia de la dirección con los cambios aplicados; `null` quita el parámetro. */
export function conControles(params: URLSearchParams, cambios: Partial<Record<'vista' | 'zoom' | 'desde' | 'dependencias' | 'proyecto' | 'persona', string | null>>): URLSearchParams {
  const nuevos = new URLSearchParams(params);
  for (const [clave, valor] of Object.entries(cambios)) {
    if (valor === null || valor === undefined) nuevos.delete(clave);
    else nuevos.set(clave, valor);
  }
  return nuevos;
}
