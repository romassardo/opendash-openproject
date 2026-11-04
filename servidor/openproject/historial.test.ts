import { describe, expect, it } from 'vitest';
import { contarComentarios, fechaDeCierre } from './historial.js';

const act = (id: number, creada: string, detalles: string[], comentario = '') => ({ id, creada, autorId: 1, comentario, detalles });

describe('historial', () => {
  it('toma el cambio más reciente a un estado cerrado', () => {
    const a = [
      act(1, '2026-10-01T10:00:00Z', ['Estado establecido al New']),
      act(2, '2026-10-16T18:49:06Z', ['Estado se cambió de In progress a Closed', 'Versión se cambió de En curso a Finalizado']),
    ];
    expect(fechaDeCierre(a, ['Closed', 'Rejected'])).toBe('2026-10-16T18:49:06Z');
  });
  it('entiende el historial en inglés', () => {
    expect(fechaDeCierre([act(1, '2026-10-02T00:00:00Z', ['Status changed from New to Rejected'])], ['Closed', 'Rejected'])).toBe('2026-10-02T00:00:00Z');
  });
  it('null si nunca se cerró', () => {
    expect(fechaDeCierre([act(1, '2026-10-01T00:00:00Z', ['Estado establecido al In progress'])], ['Closed'])).toBeNull();
  });
  it('cuenta solo comentarios no vacíos', () => {
    expect(contarComentarios([act(1, 'x', [], 'hola'), act(2, 'x', ['Estado …']), act(3, 'x', [], '  ')])).toBe(1);
  });
});
