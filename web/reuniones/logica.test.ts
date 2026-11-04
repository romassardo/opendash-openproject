import { describe, expect, it } from 'vitest';
import type { Reunion } from '../../compartido/tipos.js';
import { avisosPendientes, etiquetaAviso, textoFaltan } from './logica.js';

const reunionDe = (extra: Partial<Reunion> = {}): Reunion => ({
  id: 'r1', titulo: 'Semanal', lugar: null, inicio: '2026-10-26T13:00:00Z', fin: '2026-10-26T14:00:00Z',
  diaEntero: false, libre: false, enlace: null, plataforma: null, ...extra,
});
const AHORA = new Date('2026-10-26T12:30:00Z');

describe('avisosPendientes', () => {
  it('avisa 5 min antes', () => {
    const [aviso] = avisosPendientes([reunionDe()], AHORA, 5);
    expect(aviso?.avisarEn.toISOString()).toBe('2026-10-26T12:55:00.000Z');
    expect(aviso?.empieza.toISOString()).toBe('2026-10-26T13:00:00.000Z');
  });

  it('no avisa de día entero ni libre', () => {
    expect(avisosPendientes([reunionDe({ diaEntero: true }), reunionDe({ id: 'r2', libre: true })], AHORA, 5)).toEqual([]);
  });

  it('no avisa de una que ya empezó ni de otro día', () => {
    expect(avisosPendientes([reunionDe({ inicio: '2026-10-26T12:00:00Z' })], AHORA, 5)).toEqual([]);
    expect(avisosPendientes([reunionDe({ inicio: '2026-10-27T13:00:00Z' })], AHORA, 5)).toEqual([]);
  });

  it('una reunión movida cambia avisarEn', () => {
    const [antes] = avisosPendientes([reunionDe()], AHORA, 5);
    const [despues] = avisosPendientes([reunionDe({ inicio: '2026-10-26T15:00:00Z' })], AHORA, 5);
    expect(despues!.avisarEn.getTime() - antes!.avisarEn.getTime()).toBe(2 * 3_600_000);
    expect(etiquetaAviso(reunionDe())).not.toBe(etiquetaAviso(reunionDe({ inicio: '2026-10-26T15:00:00Z' })));
  });

  it('las ordena por inicio', () => {
    const lista = avisosPendientes([reunionDe({ id: 'b', inicio: '2026-10-26T15:00:00Z' }), reunionDe({ id: 'a' })], AHORA, 5);
    expect(lista.map((a) => a.reunion.id)).toEqual(['a', 'b']);
  });
});

describe('textoFaltan', () => {
  const empieza = new Date('2026-10-26T13:00:00Z');
  const en = (ms: number) => new Date(empieza.getTime() + ms);
  it('En 5 min, En 1 min, Empezó, null a los 6 min', () => {
    expect(textoFaltan(empieza, en(-5 * 60_000))).toBe('En 5 min');
    expect(textoFaltan(empieza, en(-30_000))).toBe('En 1 min');
    expect(textoFaltan(empieza, en(0))).toBe('Empezó');
    expect(textoFaltan(empieza, en(5 * 60_000))).toBe('Empezó');
    expect(textoFaltan(empieza, en(6 * 60_000))).toBeNull();
  });
});
