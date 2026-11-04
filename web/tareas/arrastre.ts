import type { Announcements, KeyboardCodes, KeyboardCoordinateGetter, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core';
import { NOMBRE_COLUMNA } from '../../compartido/columnas.js';
import type { Columna } from '../../compartido/tipos.js';

export const ORDEN_COLUMNAS: readonly Columna[] = ['nuevo', 'curso', 'pausa', 'cerrado'];

export const esColumna = (id: UniqueIdentifier | undefined): id is Columna => ORDEN_COLUMNAS.includes(id as Columna);

/** Datos que lleva cada tarjeta arrastrable. */
export interface DatosArrastre { columna: Columna }

// Espacio levanta y suelta; Enter queda para abrir la tarea (también suelta si ya está levantada).
export const TECLAS: KeyboardCodes = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] };

/** Con el teclado, las flechas izquierda y derecha llevan la tarjeta al centro de la columna vecina. */
export const coordenadasDeTeclado: KeyboardCoordinateGetter = (evento, { context, currentCoordinates }) => {
  const paso = evento.code === 'ArrowRight' ? 1 : evento.code === 'ArrowLeft' ? -1 : 0;
  const { collisionRect, droppableRects, over, active } = context;
  if (paso === 0 || !collisionRect) return undefined;
  evento.preventDefault();
  const desde = esColumna(over?.id) ? over.id : (active?.data.current as DatosArrastre | undefined)?.columna;
  const destino = desde === undefined ? undefined : ORDEN_COLUMNAS[ORDEN_COLUMNAS.indexOf(desde) + paso];
  const caja = destino === undefined ? undefined : droppableRects.get(destino);
  if (!caja) return undefined;
  return { x: caja.left + (caja.width - collisionRect.width) / 2, y: currentCoordinates.y };
};

/** Anuncios del arrastre para lectores de pantalla, en castellano. */
export function anunciosEnCastellano(tituloDe: (id: UniqueIdentifier) => string): Announcements {
  const columna = (id: UniqueIdentifier) => (esColumna(id) ? NOMBRE_COLUMNA[id] : String(id));
  return {
    onDragStart: ({ active }) => `Levantaste la tarea «${tituloDe(active.id)}».`,
    onDragOver: ({ active, over }) =>
      over
        ? `La tarea «${tituloDe(active.id)}» está sobre la columna ${columna(over.id)}.`
        : `La tarea «${tituloDe(active.id)}» no está sobre ninguna columna.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Soltaste la tarea «${tituloDe(active.id)}» en la columna ${columna(over.id)}.`
        : `Soltaste la tarea «${tituloDe(active.id)}» fuera de las columnas: queda donde estaba.`,
    onDragCancel: ({ active }) => `Cancelaste el movimiento: la tarea «${tituloDe(active.id)}» queda donde estaba.`,
  };
}

export const INSTRUCCIONES: ScreenReaderInstructions = {
  draggable:
    'Para cambiar el estado de la tarea, apretá Espacio para levantarla, elegí la columna con las flechas ' +
    'izquierda y derecha y apretá Espacio otra vez para soltarla. Escape cancela. Enter abre la tarea.',
};
