import { describe, expect, it } from 'vitest';
import { enlaceParaUnirse } from './enlaces.js';

describe('enlaceParaUnirse', () => {
  it('elige el enlace de unirse de Teams entre los tres', () => {
    const descripcion = [
      'Unirse: <https://teams.microsoft.com/meet/987654321?p=abc>',
      'Unirse a la reunión: <https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=%7b%7d>',
      'Opciones: <https://teams.microsoft.com/meetingOptions/?organizerId=1>',
    ].join('\n');
    expect(enlaceParaUnirse(null, descripcion)).toEqual({
      enlace: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=%7b%7d',
      plataforma: 'teams',
    });
  });

  it('toma Meet del lugar y Zoom con subdominio', () => {
    expect(enlaceParaUnirse('https://meet.google.com/abc-defg-hij', 'texto')).toEqual({
      enlace: 'https://meet.google.com/abc-defg-hij', plataforma: 'meet' });
    expect(enlaceParaUnirse('https://empresa.zoom.us/j/123456789?pwd=abc')).toEqual({
      enlace: 'https://empresa.zoom.us/j/123456789?pwd=abc', plataforma: 'zoom' });
    expect(enlaceParaUnirse('"https://zoom.us/j/55")')?.enlace).toBe('https://zoom.us/j/55');
  });

  it('respeta el orden de los argumentos', () => {
    const r = enlaceParaUnirse('https://meet.google.com/abc-defg-hij', 'https://zoom.us/j/1');
    expect(r?.plataforma).toBe('meet');
  });

  it('ignora http y los dominios que no son de reuniones', () => {
    expect(enlaceParaUnirse('http://meet.google.com/abc-defg-hij', 'https://ejemplo.com/j/1')).toBeNull();
    expect(enlaceParaUnirse('https://meet.google.com/lookup/xyz', 'https://malzoom.us.ejemplo.com/j/1', null)).toBeNull();
    expect(enlaceParaUnirse(null, null)).toBeNull();
  });

  it.each(['.', ',', ';', ':', '!'])('saca la puntuación «%s» del final del enlace', (cierre) => {
    expect(enlaceParaUnirse(`Unite acá: https://meet.google.com/abc-defg-hij${cierre}`)).toEqual({
      enlace: 'https://meet.google.com/abc-defg-hij', plataforma: 'meet' });
  });

  it('un enlace de Teams seguido de un punto queda sin el punto', () => {
    const enlace = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0';
    expect(enlaceParaUnirse(`Entrá a ${enlace}.`)).toEqual({ enlace, plataforma: 'teams' });
  });
});
