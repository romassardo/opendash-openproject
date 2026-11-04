import type { Columna, Estado, MapeoTablero, Version } from './tipos.js';

export const NOMBRE_COLUMNA: Record<Columna, string> = {
  nuevo: 'Nuevo',
  curso: 'En curso',
  pausa: 'En pausa',
  cerrado: 'Cerrado',
};

const ESTADO_POR_COLUMNA: Record<Columna, string> = {
  nuevo: 'New',
  curso: 'In progress',
  pausa: 'On hold',
  cerrado: 'Closed',
};

const VERSION_POR_COLUMNA: Record<Columna, string | null> = {
  nuevo: null,
  curso: 'En curso',
  pausa: 'En pausa',
  cerrado: 'Finalizado',
};

const ABIERTAS: Columna[] = ['nuevo', 'curso', 'pausa'];

/**
 * La columna de un estado: «cerrado» si el estado lo es; si no, la columna a la que el mapeo le asignó ese id;
 * si no, por nombre (solo las columnas que el mapeo deja en `null`); si no, «nuevo».
 */
export function columnaDeEstado(estado: Estado, mapeo?: MapeoTablero): Columna {
  if (estado.cerrado) return 'cerrado';
  const elegida = mapeo === undefined ? undefined : ABIERTAS.find((c) => mapeo[c] === estado.id);
  if (elegida !== undefined) return elegida;
  if (estado.nombre === 'In progress' && (mapeo?.curso ?? null) === null) return 'curso';
  if (estado.nombre === 'On hold' && (mapeo?.pausa ?? null) === null) return 'pausa';
  return 'nuevo';
}

/** El estado de OpenProject que le corresponde a la columna, o `null` si esa instancia no lo tiene. */
export function estadoDeColumna(columna: Columna, estados: Estado[], mapeo?: MapeoTablero): Estado | null {
  const id = mapeo?.[columna] ?? null;
  if (id !== null) return estados.find((e) => e.id === id) ?? null;
  const nombre = ESTADO_POR_COLUMNA[columna];
  return estados.find((e) => e.nombre === nombre) ?? null;
}

/** Aviso de que a la instancia le falta el estado de esa columna. */
export function mensajeFaltaEstado(columna: Columna): string {
  return `Falta el estado «${ESTADO_POR_COLUMNA[columna]}» en OpenProject`;
}

export function versionParaColumna(columna: Columna, versionesDelProyecto: Version[]): Version | null {
  const nombre = VERSION_POR_COLUMNA[columna];
  if (nombre === null) return null;
  return versionesDelProyecto.find((v) => v.nombre === nombre) ?? null;
}
