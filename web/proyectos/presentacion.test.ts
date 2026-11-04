import { describe, expect, it } from 'vitest';
import { fechaCorta, textoHito, textoPlano, tonoDeEstadoOp } from './presentacion.js';

describe('presentación de Proyectos', () => {
  it('textoHito cuenta días hacia adelante y hacia atrás', () => {
    expect(textoHito('2026-10-23', '2026-10-19')).toBe('23 oct · en 4 días');
    expect(textoHito('2026-10-20', '2026-10-19')).toBe('20 oct · en 1 día');
    expect(textoHito('2026-10-19', '2026-10-19')).toBe('19 oct · hoy');
    expect(textoHito('2026-10-17', '2026-10-19')).toBe('17 oct · vencido hace 2 días');
  });

  it('fechaCorta agrega el año solo si no es el actual', () => {
    expect(fechaCorta('2026-12-18', '2026-10-19')).toBe('18 dic');
    expect(fechaCorta('2027-01-05', '2026-10-19')).toBe('5 ene 2027');
  });

  it('textoPlano saca las marcas de markdown y junta las líneas', () => {
    expect(textoPlano('# Título\n\nUn **portal** para [clientes](https://x.test) con `login`.\n\n- uno\n- dos')).toBe('Título Un portal para clientes con login. uno dos');
    expect(textoPlano('_énfasis_ y snake_case_name ![logo](a.png) <b>html</b>')).toBe('énfasis y snake_case_name logo html');
    expect(textoPlano('antes\n```\ncodigo\n```\ndespués')).toBe('antes después');
  });

  it('el tono sale de la clave del estado de OpenProject', () => {
    expect(tonoDeEstadoOp('on_track')).toBe('verde');
    expect(tonoDeEstadoOp('at_risk')).toBe('naranja');
    expect(tonoDeEstadoOp('off_track')).toBe('rosa');
    expect(tonoDeEstadoOp('not_started')).toBe('indigo');
    expect(tonoDeEstadoOp('finished')).toBe('turquesa');
    expect(tonoDeEstadoOp('discontinued')).toBeUndefined();
    expect(tonoDeEstadoOp(null)).toBeUndefined();
  });
});
