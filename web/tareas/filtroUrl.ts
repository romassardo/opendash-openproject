import type { FiltroTareas } from './logica.js';

/** La parte del filtro que vive en la dirección (`?proyecto=…&persona=…&prioridad=alta`). */
export type FiltroUrl = Omit<FiltroTareas, 'texto'>;
type Persona = FiltroUrl['persona'];

const idValido = (valor: string | null): number | null =>
  valor !== null && /^[1-9]\d{0,9}$/.test(valor) ? Number(valor) : null;

/**
 * `personaPorDefecto`: lo que vale sin `?persona=` en la dirección. Tareas abre con las mías; dentro de un proyecto,
 * con las de todos.
 */
export function leerFiltro(params: URLSearchParams, personaPorDefecto: Persona = 'todas'): FiltroUrl {
  const persona = params.get('persona');
  return {
    proyectoId: idValido(params.get('proyecto')),
    persona: persona === 'mias' || persona === 'todas' ? persona : (idValido(persona) ?? personaPorDefecto),
    soloAltas: params.get('prioridad') === 'alta',
  };
}

/** Copia de `params` con el filtro escrito; los valores por defecto no se escriben. */
export function conFiltro(params: URLSearchParams, filtro: FiltroUrl, personaPorDefecto: Persona = 'todas'): URLSearchParams {
  const valores: [string, string | null][] = [
    ['proyecto', filtro.proyectoId === null ? null : String(filtro.proyectoId)],
    ['persona', filtro.persona === personaPorDefecto ? null : String(filtro.persona)],
    ['prioridad', filtro.soloAltas ? 'alta' : null],
  ];
  const nuevos = new URLSearchParams(params);
  for (const [clave, valor] of valores) {
    if (valor === null) nuevos.delete(clave);
    else nuevos.set(clave, valor);
  }
  return nuevos;
}
