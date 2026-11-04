import { describe, expect, it } from 'vitest';
import type { Reunion } from '../../compartido/tipos.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import {
  desdeCuando, duracionTexto, fueraDeVentana, horaTexto, moverFecha, rangoVisible, reunionesDeLaSemana, reunionesPorDia, semanasDelMes, textoVentana, tituloMes, vencimientosPorDia,
} from './logica.js';

const reunion = (id: string, inicio: string, fin: string, extra: Partial<Reunion> = {}): Reunion =>
  ({ id, titulo: id, lugar: null, inicio, fin, diaEntero: false, libre: false, enlace: null, plataforma: null, ...extra });

describe('lógica del calendario', () => {
  it('siempre 6 semanas: octubre 2026 va del lunes 28 sep al domingo 8 nov', () => {
    const semanas = semanasDelMes('2026-10-19', '2026-10-19');
    expect(semanas).toHaveLength(6);
    expect(semanas.every((s) => s.length === 7)).toBe(true);
    expect(semanas[0]![0]!.fecha).toBe('2026-09-28');
    expect(semanas[5]![6]!.fecha).toBe('2026-11-08');
    expect(semanas[0]![0]!.delMes).toBe(false);
    expect(semanas[0]![3]!).toEqual({ fecha: '2026-10-01', delMes: true, esHoy: false });
    expect(semanas.flat().filter((d) => d.esHoy).map((d) => d.fecha)).toEqual(['2026-10-19']);
    // Febrero 2027 empieza en lunes y termina en domingo: igual son 6 semanas.
    expect(semanasDelMes('2027-02-10', '2026-10-19')).toHaveLength(6);
  });

  it('rangoVisible pide exactamente lo que se ve', () => {
    expect(rangoVisible('mes', '2026-10-19')).toEqual({ desde: '2026-09-28', hasta: '2026-11-08' });
    expect(rangoVisible('semana', '2026-10-21')).toEqual({ desde: '2026-10-19', hasta: '2026-10-25' });
  });

  it('moverFecha del 31 ene en mes va al 28 feb', () => {
    expect(moverFecha('mes', '2027-01-31', 1)).toBe('2027-02-28');
    expect(moverFecha('mes', '2026-01-15', -1)).toBe('2025-12-15');
    expect(moverFecha('semana', '2026-10-19', 1)).toBe('2026-10-26');
    expect(moverFecha('semana', '2026-10-19', -1)).toBe('2026-10-12');
  });

  it('reunionesPorDia ordena por hora y pone las de varios días en cada día', () => {
    const lista = [
      reunion('tarde', '2026-10-19T17:00:00Z', '2026-10-19T18:00:00Z'),
      reunion('manana', '2026-10-19T12:00:00Z', '2026-10-19T12:30:00Z'),
      // Del lunes 19 a las 21 (hora argentina) al miércoles 21 a las 10.
      reunion('largo', '2026-10-20T00:00:00Z', '2026-10-21T13:00:00Z'),
      // Día entero: de 00:00 argentino del 22 a 00:00 argentino del 23 (fin exclusivo): solo el 22.
      reunion('feria', '2026-10-22T03:00:00Z', '2026-10-23T03:00:00Z', { diaEntero: true }),
    ];
    const mapa = reunionesPorDia(lista);
    expect(mapa.get('2026-10-19')!.map((r) => r.id)).toEqual(['manana', 'tarde', 'largo']);
    expect(mapa.get('2026-10-20')!.map((r) => r.id)).toEqual(['largo']);
    expect(mapa.get('2026-10-21')!.map((r) => r.id)).toEqual(['largo']);
    expect(mapa.get('2026-10-22')!.map((r) => r.id)).toEqual(['feria']);
    expect(mapa.has('2026-10-23')).toBe(false);
  });

  it('reunionesDeLaSemana cuenta solo las que cuentan', () => {
    const lista = [
      reunion('a', '2026-10-19T12:00:00Z', '2026-10-19T13:00:00Z'),
      reunion('libre', '2026-10-20T12:00:00Z', '2026-10-20T13:00:00Z', { libre: true }),
      reunion('entero', '2026-10-21T03:00:00Z', '2026-10-22T03:00:00Z', { diaEntero: true }),
      reunion('domingo', '2026-10-25T12:00:00Z', '2026-10-25T13:00:00Z'),
      reunion('proxima', '2026-10-26T12:00:00Z', '2026-10-26T13:00:00Z'),
      reunion('anterior', '2026-10-18T12:00:00Z', '2026-10-18T13:00:00Z'),
    ];
    expect(reunionesDeLaSemana(lista, '2026-10-21')).toBe(2);
  });

  it('vencimientos junta las tareas propias abiertas y los hitos abiertos', () => {
    const tareas = [
      tareaDe(1, { responsableId: 9, estadoId: 1, fin: '2026-10-22' }),
      tareaDe(2, { responsableId: 9, estadoId: 12, fin: '2026-10-22' }),   // cerrada
      tareaDe(3, { responsableId: 5, estadoId: 1, fin: '2026-10-22' }),    // ajena
      tareaDe(4, { responsableId: 9, estadoId: 1, fin: null }),            // sin fecha
      tareaDe(5, { tipoId: 2, estadoId: 1, fin: '2026-10-23', inicio: '2026-10-01' }), // hito con fin
      tareaDe(6, { tipoId: 2, estadoId: 1, fin: null, inicio: '2026-10-24' }),         // hito solo con inicio
      tareaDe(7, { tipoId: 2, estadoId: 12, fin: '2026-10-23' }),          // hito cerrado
    ];
    const mapa = vencimientosPorDia(tareas, CATALOGO, 9);
    expect(mapa.get('2026-10-22')!.map((t) => t.id)).toEqual([1]);
    expect(mapa.get('2026-10-23')!.map((t) => t.id)).toEqual([5]);
    expect(mapa.get('2026-10-24')!.map((t) => t.id)).toEqual([6]);
    expect(mapa.size).toBe(3);
  });

  it('duracionTexto dice 15 min, 1 h y 1,5 h', () => {
    expect(duracionTexto(reunion('a', '2026-10-19T12:00:00Z', '2026-10-19T12:15:00Z'))).toBe('15 min');
    expect(duracionTexto(reunion('b', '2026-10-19T12:00:00Z', '2026-10-19T13:00:00Z'))).toBe('1 h');
    expect(duracionTexto(reunion('c', '2026-10-19T12:00:00Z', '2026-10-19T13:30:00Z'))).toBe('1,5 h');
    expect(duracionTexto(reunion('d', '2026-10-19T03:00:00Z', '2026-10-20T03:00:00Z', { diaEntero: true }))).toBe('Todo el día');
  });

  it('tituloMes y horaTexto', () => {
    expect(tituloMes('2026-10-19')).toBe('Octubre 2026');
    expect(horaTexto('2026-10-19T12:30:00Z')).toBe('9:30');
    expect(horaTexto('2026-10-19T17:05:00Z')).toBe('14:05');
    expect(horaTexto('basura')).toBe('');
  });
});

describe('desdeCuando', () => {
  const ahora = new Date('2026-10-21T13:30:00Z'); // miércoles 21, 10:30
  it('del mismo día, solo la hora sin cero adelante', () => {
    expect(desdeCuando('2026-10-21T12:15:00Z', ahora)).toBe('9:15');
  });
  it('de ayer, «ayer» y la hora', () => {
    expect(desdeCuando('2026-10-20T12:15:00Z', ahora)).toBe('ayer 9:15');
  });
  it('de antes, el día y mes con la hora', () => {
    expect(desdeCuando('2026-10-20T12:15:00Z', new Date('2026-10-22T13:30:00Z'))).toBe('el 20/10 9:15');
  });
  it('un instante inválido da texto vacío', () => {
    expect(desdeCuando('nada', ahora)).toBe('');
  });
});

describe('ventana guardada', () => {
  const ventana = { desde: '2026-07-21', hasta: '2027-10-22' };
  it('fueraDeVentana: un rango que empieza antes o termina después', () => {
    expect(fueraDeVentana('2026-07-01', '2026-07-31', ventana)).toBe(true);
    expect(fueraDeVentana('2027-10-01', '2027-11-07', ventana)).toBe(true);
    expect(fueraDeVentana('2026-09-01', '2026-09-30', ventana)).toBe(false);
  });
  it('textoVentana: día y mes sin ceros, año completo', () => {
    expect(textoVentana(ventana)).toBe('Las reuniones se guardan del 21/7/2026 al 22/10/2027; fuera de esas fechas no se ven.');
  });
});
