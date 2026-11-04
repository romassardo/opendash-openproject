import { describe, expect, it, vi } from 'vitest';
import type { Active, ClientRect, Over, SensorContext } from '@dnd-kit/core';
import { anunciosEnCastellano, coordenadasDeTeclado } from './arrastre.js';

const rect = (left: number, width: number): ClientRect => ({ left, width, top: 270, height: 600, right: left + width, bottom: 870 });

// Columnas de 268 px separadas 16,64 px, como a 1440 px de ancho.
const contexto = (sobre: string | null, columnaActiva = 'nuevo'): SensorContext => ({
  collisionRect: rect(310, 248),
  droppableRects: new Map([
    ['nuevo', rect(292, 268)],
    ['curso', rect(577, 268)],
    ['pausa', rect(861, 268)],
    ['cerrado', rect(1146, 268)],
  ]),
  over: sobre === null ? null : ({ id: sobre } as Over),
  active: { id: 1, data: { current: { columna: columnaActiva } } } as unknown as Active,
} as unknown as SensorContext);

const tecla = (code: string) => ({ code, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

describe('arrastre con teclado', () => {
  it('la flecha derecha lleva la tarjeta al centro de la columna siguiente', () => {
    const evento = tecla('ArrowRight');
    const destino = coordenadasDeTeclado(evento, { active: 1, context: contexto('nuevo'), currentCoordinates: { x: 310, y: 400 } });
    expect(destino).toEqual({ x: 577 + (268 - 248) / 2, y: 400 });
    expect(evento.preventDefault).toHaveBeenCalled();
  });

  it('la flecha izquierda vuelve; sin columna sobre la que está, usa la de origen', () => {
    expect(coordenadasDeTeclado(tecla('ArrowLeft'), { active: 1, context: contexto('pausa'), currentCoordinates: { x: 870, y: 400 } }))
      .toEqual({ x: 587, y: 400 });
    expect(coordenadasDeTeclado(tecla('ArrowRight'), { active: 1, context: contexto(null, 'curso'), currentCoordinates: { x: 590, y: 400 } }))
      .toEqual({ x: 871, y: 400 });
  });

  it('en los bordes y con otras teclas no mueve', () => {
    expect(coordenadasDeTeclado(tecla('ArrowLeft'), { active: 1, context: contexto('nuevo'), currentCoordinates: { x: 310, y: 400 } })).toBeUndefined();
    expect(coordenadasDeTeclado(tecla('ArrowRight'), { active: 1, context: contexto('cerrado'), currentCoordinates: { x: 1150, y: 400 } })).toBeUndefined();
    expect(coordenadasDeTeclado(tecla('ArrowDown'), { active: 1, context: contexto('nuevo'), currentCoordinates: { x: 310, y: 400 } })).toBeUndefined();
  });
});

describe('anuncios', () => {
  const anuncios = anunciosEnCastellano((id) => (id === 1 ? 'Pedir presupuesto' : '?'));
  const activa = { id: 1 } as Active;

  it('cuentan en castellano qué pasa con la tarea', () => {
    expect(anuncios.onDragStart({ active: activa })).toBe('Levantaste la tarea «Pedir presupuesto».');
    expect(anuncios.onDragOver({ active: activa, over: { id: 'pausa' } as Over })).toBe('La tarea «Pedir presupuesto» está sobre la columna En pausa.');
    expect(anuncios.onDragEnd({ active: activa, over: { id: 'cerrado' } as Over })).toBe('Soltaste la tarea «Pedir presupuesto» en la columna Cerrado.');
    expect(anuncios.onDragEnd({ active: activa, over: null })).toContain('queda donde estaba');
    expect(anuncios.onDragCancel({ active: activa, over: null })).toContain('Cancelaste el movimiento');
  });
});
