import { describe, expect, it } from 'vitest';
import { calendarioDe } from '../../compartido/calendarioOp.js';
import { partesDe, type Pausa } from '../../compartido/pausas.js';
import { huecosDeBarra, mascaraDeHuecos, textoPausas } from './pausasLinea.js';

const cal = calendarioDe({ semanaNoLaborable: [0, 6], diasNoLaborables: [] });
const pausa = (id: number, despues: number, dias: number): Pausa => ({ id, tareaId: 1, despues, dias });
// Ventana de Semana desde el lunes 2 de noviembre: 48 px por día. La tarea va del lunes 2 al viernes 13.
const VENTANA = { desde: '2026-11-02', pxPorDia: 48 };
const BARRA = { x: 0, ancho: 12 * 48 };

describe('huecos de una barra pausada', () => {
  it('una pausa de jueves y viernes deja un hueco de jueves a domingo', () => {
    const partes = partesDe('2026-11-02', '2026-11-13', [pausa(1, 3, 2)], cal);
    expect(huecosDeBarra(partes, '2026-11-13', VENTANA, BARRA)).toEqual([{ izquierda: 3 * 48, ancho: 4 * 48 }]);
  });

  it('se recorta a lo que se ve de la barra', () => {
    const partes = partesDe('2026-11-02', '2026-11-13', [pausa(1, 3, 2)], cal);
    // La ventana arranca el viernes 6: la barra visible empieza ahí y el hueco sigue dos días más.
    expect(huecosDeBarra(partes, '2026-11-13', { desde: '2026-11-06', pxPorDia: 48 }, { x: 0, ancho: 8 * 48 })).toEqual([{ izquierda: 0, ancho: 3 * 48 }]);
  });

  it('si el fin cae dentro de una pausa, el hueco llega hasta el fin', () => {
    const partes = partesDe('2026-11-02', '2026-11-06', [pausa(1, 3, 5)], cal);
    expect(huecosDeBarra(partes, '2026-11-06', VENTANA, { x: 0, ancho: 5 * 48 })).toEqual([{ izquierda: 3 * 48, ancho: 2 * 48 }]);
  });

  it('sin pausas no hay huecos ni máscara', () => {
    const partes = partesDe('2026-11-02', '2026-11-13', [], cal);
    expect(huecosDeBarra(partes, '2026-11-13', VENTANA, BARRA)).toEqual([]);
    expect(mascaraDeHuecos([])).toBeUndefined();
    expect(textoPausas(partes)).toBeNull();
  });

  it('la máscara corta cada hueco y el texto los nombra a todos', () => {
    expect(mascaraDeHuecos([{ izquierda: 10, ancho: 20 }])).toBe('linear-gradient(90deg, #000 0, #000 10px, transparent 10px 30px, #000 30px)');
    const partes = partesDe('2026-11-02', '2026-11-13', [pausa(1, 2, 1), pausa(2, 5, 2)], cal);
    expect(textoPausas(partes)).toBe('en pausa el 4 nov y del 10 nov al 11 nov');
  });
});
