import { describe, expect, it } from 'vitest';
import { columnaDeEstado, estadoDeColumna, versionParaColumna } from './columnas.js';
import type { Estado, MapeoTablero, Version } from './tipos.js';

const E = (id: number, nombre: string, cerrado = false): Estado => ({ id, nombre, cerrado, color: '#000' });
const estados = [E(1, 'New'), E(7, 'In progress'), E(13, 'On hold'), E(12, 'Closed', true), E(14, 'Rejected', true), E(2, 'In specification')];

describe('columnas', () => {
  it.each([[1, 'nuevo'], [7, 'curso'], [13, 'pausa'], [12, 'cerrado'], [14, 'cerrado'], [2, 'nuevo']])('estado %i → %s', (id, col) => {
    expect(columnaDeEstado(estados.find((e) => e.id === id)!)).toBe(col);
  });
  it('columna → estado concreto', () => {
    expect(estadoDeColumna('cerrado', estados)?.nombre).toBe('Closed');
    expect(estadoDeColumna('nuevo', estados)?.nombre).toBe('New');
  });
  it('estadoDeColumna devuelve null si falta el estado', () => {
    expect(estadoDeColumna('curso', [E(1, 'New')])).toBeNull();
  });
  describe('con mapeo del tablero', () => {
    const sinMapeo: MapeoTablero = { nuevo: null, curso: null, pausa: null, cerrado: null };
    const revision = E(20, 'En revisión');
    const todos = [...estados, revision];

    it('con el mapeo, el estado elegido para En curso cae en curso aunque se llame distinto', () => {
      const mapeo: MapeoTablero = { ...sinMapeo, curso: 20 };
      expect(columnaDeEstado(revision, mapeo)).toBe('curso');
      // el que se llama «In progress» deja de ser curso: la columna ya tiene su estado elegido
      expect(columnaDeEstado(estados[1]!, mapeo)).toBe('nuevo');
      // las columnas sin elegir siguen por nombre
      expect(columnaDeEstado(estados[2]!, mapeo)).toBe('pausa');
      expect(estadoDeColumna('curso', todos, mapeo)?.id).toBe(20);
    });
    it('sin mapeo se comporta como hoy', () => {
      for (const e of todos) expect(columnaDeEstado(e, sinMapeo)).toBe(columnaDeEstado(e));
      expect(estadoDeColumna('pausa', todos, sinMapeo)?.nombre).toBe('On hold');
    });
    it('estadoDeColumna usa el estado mapeado', () => {
      expect(estadoDeColumna('cerrado', todos, { ...sinMapeo, cerrado: 14 })?.nombre).toBe('Rejected');
      expect(estadoDeColumna('nuevo', todos, { ...sinMapeo, nuevo: 2 })?.nombre).toBe('In specification');
      expect(estadoDeColumna('curso', estados, { ...sinMapeo, curso: 99 })).toBeNull();
    });
    it('un estado cerrado siempre es cerrado', () => {
      expect(columnaDeEstado(estados[3]!, { ...sinMapeo, cerrado: 14 })).toBe('cerrado');
    });
  });
  it('versión por columna solo con nombre exacto', () => {
    const v: Version[] = [{ id: 6, nombre: 'En curso', proyectoId: 11, estado: 'abierta', inicio: null, fin: null }, { id: 9, nombre: 'Finalizado', proyectoId: 11, estado: 'abierta', inicio: null, fin: null }];
    expect(versionParaColumna('curso', v)?.id).toBe(6);
    expect(versionParaColumna('cerrado', v)?.id).toBe(9);
    expect(versionParaColumna('pausa', v)).toBeNull();
    expect(versionParaColumna('nuevo', v)).toBeNull();
  });
});
