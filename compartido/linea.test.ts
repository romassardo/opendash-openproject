import { describe, expect, it } from 'vitest';
import { claveContenedor, proyectoDeContenedor } from './linea.js';

describe('claves de contenedor', () => {
  it('arma la clave con 0 para el nivel del proyecto', () => {
    expect(claveContenedor(12, null)).toBe('12:0');
    expect(claveContenedor(12, 189)).toBe('12:189');
  });
  it('saca el proyecto de la clave', () => {
    expect(proyectoDeContenedor('12:189')).toBe(12);
    expect(proyectoDeContenedor('x')).toBeNull();
  });
});
