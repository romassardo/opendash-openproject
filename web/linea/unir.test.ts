import { describe, expect, it } from 'vitest';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import { motivoParaNoUnir, textoNoUnir } from './unir.js';

const t = (id: number, madreId: number | null = null, proyectoId = 1): Tarea => ({ id, titulo: `T${id}`, madreId, proyectoId } as Tarea);
const dep = (predecesoraId: number, sucesoraId: number): Dependencia => ({ id: 1, predecesoraId, sucesoraId, lag: 0 });
const tareas = [t(1), t(2, 1), t(3, 2), t(4), t(5, null, 2)];

describe('motivoParaNoUnir', () => {
  it('detecta los cuatro motivos', () => {
    expect(motivoParaNoUnir(4, 4, tareas, [])).toBe('misma');
    expect(motivoParaNoUnir(1, 3, tareas, [])).toBe('familia');
    expect(motivoParaNoUnir(3, 1, tareas, [])).toBe('familia');
    expect(motivoParaNoUnir(1, 4, tareas, [dep(1, 4)])).toBe('ya-unidas');
    expect(motivoParaNoUnir(4, 1, tareas, [dep(1, 5), dep(5, 4)])).toBe('circulo');
  });
  it('la precedencia: familia gana a ya-unidas, y un círculo directo se detecta', () => {
    // Madre e hija con una dependencia entre ellas: manda la familia.
    expect(motivoParaNoUnir(1, 2, tareas, [dep(1, 2)])).toBe('familia');
    // 1 ya espera a 4: repetir esa unión es «ya-unidas»; la inversa (4 esperando a 1) cierra un círculo directo.
    expect(motivoParaNoUnir(4, 1, tareas, [dep(4, 1)])).toBe('ya-unidas');
    expect(motivoParaNoUnir(1, 4, tareas, [dep(4, 1)])).toBe('circulo');
  });
  it('permite dos sueltas de distinto proyecto', () => {
    expect(motivoParaNoUnir(4, 5, tareas, [])).toBeNull();
  });
});

describe('textoNoUnir', () => {
  it('usa los textos del diseño', () => {
    expect(textoNoUnir('misma', t(1), t(1))).toBe('Una tarea no puede esperarse a sí misma.');
    expect(textoNoUnir('ya-unidas', t(1), t(2))).toBe('Esas dos ya estaban unidas.');
    expect(textoNoUnir('circulo', t(1), t(2))).toBe('No se puede: «T2» ya va antes que «T1» y quedaría un círculo.');
    expect(textoNoUnir('familia', t(1), t(2))).toBe('No se puede unir una tarea con su madre o sus hijas.');
  });
});
