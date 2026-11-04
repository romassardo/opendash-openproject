import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ErrorIcs, leerIcs, type AvisoIcs } from './ics.js';

const ics = readFileSync(new URL('../../pruebas/fixtures/calendario/outlook.ics', import.meta.url), 'utf8').replace(/\r?\n/g, '\r\n');
const octubre = { desde: '2026-10-05', hasta: '2026-10-31' };
const de = (titulo: string, ventana = octubre) => leerIcs(ics, ventana).filter((r) => r.titulo === titulo);

describe('leerIcs', () => {
  it('expande la serie semanal en hora argentina y saltea el EXDATE', () => {
    const dailys = de('Daily de soporte');
    expect(dailys.map((r) => r.inicio)).toEqual(['2026-10-05T12:30:00.000Z', '2026-10-19T14:00:00.000Z']);
    expect(dailys[0]?.fin).toBe('2026-10-05T12:45:00.000Z');
    expect(dailys[0]?.id).toBe('daily-soporte@opendash.test:2026-10-05T12:30:00.000Z');
    expect(dailys[0]?.enlace).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=%7b%7d');
    expect(dailys[0]?.plataforma).toBe('teams');
    // La Daily es TENTATIVE: igual cuenta como ocupada.
    expect(dailys.every((r) => !r.libre)).toBe(true);
  });

  it('pasa Central Standard Time a hora argentina con y sin horario de verano', () => {
    const ventana = { desde: '2026-10-05', hasta: '2026-11-10' };
    expect(de('Revisión con proveedor', ventana)[0]?.inicio).toBe('2026-10-21T15:00:00.000Z');
    expect(de('Revisión de noviembre', ventana)[0]?.inicio).toBe('2026-11-04T16:00:00.000Z');
    expect(de('Revisión con proveedor')[0]).toMatchObject({ plataforma: 'zoom', lugar: 'https://empresa.zoom.us/j/123456789?pwd=abc' });
  });

  it('marca libre y día entero', () => {
    expect(de('Almuerzo')[0]).toMatchObject({ libre: true, diaEntero: false, lugar: null, enlace: null });
    expect(de('Feria de proveedores')[0]).toMatchObject({
      diaEntero: true, inicio: '2026-10-23T03:00:00.000Z', fin: '2026-10-24T03:00:00.000Z' });
    expect(de('Sync de Meet')[0]).toMatchObject({ libre: false, plataforma: 'meet' });
  });

  it('no devuelve las canceladas', () => {
    const titulos = leerIcs(ics, octubre).map((r) => r.titulo);
    expect(titulos).not.toContain('Cancelada suelta');
    expect(titulos).not.toContain('Cancelada: Daily de soporte');
  });

  it('devuelve la guardia que cruza la medianoche y ordena por inicio', () => {
    const lista = leerIcs(ics, octubre);
    expect(de('Guardia')[0]).toMatchObject({ inicio: '2026-10-24T01:00:00.000Z', fin: '2026-10-24T05:00:00.000Z' });
    const inicios = lista.map((r) => r.inicio);
    expect(inicios).toEqual([...inicios].sort());
  });

  it('una serie sin fin no expande más allá de la ventana', () => {
    expect(de('Serie sin fin').map((r) => r.inicio)).toEqual([
      '2026-10-07T19:00:00.000Z', '2026-10-14T19:00:00.000Z', '2026-10-21T19:00:00.000Z', '2026-10-28T19:00:00.000Z']);
  });

  it('un texto que no es un calendario lanza ErrorIcs', () => {
    expect(() => leerIcs('hola, esto no es un calendario', octubre)).toThrow(ErrorIcs);
    expect(() => leerIcs('', octubre)).toThrow(ErrorIcs);
  });
});

describe('leerIcs: horas sin zona conocida', () => {
  const evento = (inicio: string) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x@t', `DTSTART${inicio}`, 'DTEND' + inicio.replace('0900', '1000'),
    'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  it('un TZID sin VTIMEZONE y las horas flotantes valen hora argentina', () => {
    expect(leerIcs(evento(';TZID=Zona Inventada:20261021T090000'), octubre)[0]?.inicio).toBe('2026-10-21T12:00:00.000Z');
    expect(leerIcs(evento(':20261021T090000'), octubre)[0]?.inicio).toBe('2026-10-21T12:00:00.000Z');
  });
});

describe('leerIcs: series largas y eventos defectuosos', () => {
  const envolver = (...eventos: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...eventos, 'END:VCALENDAR', ''].join('\r\n');
  it('una serie diaria de más de 6 años igual aparece dentro de la ventana', () => {
    const serie = ['BEGIN:VEVENT', 'UID:vieja@t', 'SUMMARY:Daily viejo', 'DTSTART:20200101T120000Z', 'DTEND:20200101T121500Z', 'RRULE:FREQ=DAILY', 'END:VEVENT'];
    const dias = leerIcs(envolver(...serie), octubre).map((r) => r.inicio.slice(0, 10));
    expect(dias).toHaveLength(27);
    expect(dias[0]).toBe('2026-10-05');
  });
  it('un evento sin DTSTART se saltea y devuelve el bueno sin lanzar', () => {
    const roto = ['BEGIN:VEVENT', 'UID:roto@t', 'SUMMARY:Roto', 'END:VEVENT'];
    const bueno = ['BEGIN:VEVENT', 'UID:bueno@t', 'SUMMARY:Bueno', 'DTSTART:20261021T120000Z', 'DTEND:20261021T130000Z', 'END:VEVENT'];
    expect(leerIcs(envolver(...roto, ...bueno), octubre).map((r) => r.titulo)).toEqual(['Bueno']);
  });
});

describe('leerIcs: varios calendarios, avisos y bordes', () => {
  const envolver = (...eventos: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...eventos, 'END:VCALENDAR', ''].join('\r\n');
  const evento = (uid: string, ...extra: string[]) => ['BEGIN:VEVENT', `UID:${uid}@t`, `SUMMARY:${uid}`, ...extra, 'END:VEVENT'];
  const simple = (uid: string, inicio: string, fin: string, ...extra: string[]) =>
    evento(uid, `DTSTART:${inicio}`, `DTEND:${fin}`, ...extra);

  it('dos VCALENDAR seguidos devuelven los eventos y las zonas de los dos', () => {
    const zona = (tzid: string) => ['BEGIN:VTIMEZONE', `TZID:${tzid}`, 'BEGIN:STANDARD', 'DTSTART:16010101T000000',
      'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'END:STANDARD', 'END:VTIMEZONE'];
    const uno = envolver(...zona('Zona Uno'), ...evento('uno', 'DTSTART;TZID=Zona Uno:20261021T090000', 'DTEND;TZID=Zona Uno:20261021T100000'));
    const dos = envolver(...zona('Zona Dos'), ...evento('dos', 'DTSTART;TZID=Zona Dos:20261022T090000', 'DTEND;TZID=Zona Dos:20261022T100000'));
    const lista = leerIcs(uno + dos, octubre);
    expect(lista.map((r) => r.titulo)).toEqual(['uno', 'dos']);
    expect(lista.map((r) => r.inicio)).toEqual(['2026-10-21T12:00:00.000Z', '2026-10-22T12:00:00.000Z']);
  });

  it('un DTSTART roto avisa evento-salteado y el resto se lee igual', () => {
    const roto = evento('roto', 'DTSTART:esto-no-es-una-fecha', 'DTEND:20261021T130000Z');
    const avisos: AvisoIcs[] = [];
    const lista = leerIcs(envolver(...roto, ...simple('bueno', '20261021T120000Z', '20261021T130000Z')), octubre, (a) => avisos.push(a));
    expect(lista.map((r) => r.titulo)).toEqual(['bueno']);
    expect(avisos).toEqual(['evento-salteado']);
  });

  it('una serie diaria que empieza 200 años antes agota el tope y avisa serie-cortada', () => {
    const serie = simple('antigua', '18260101T120000Z', '18260101T121500Z', 'RRULE:FREQ=DAILY');
    const alAviso = vi.fn();
    leerIcs(envolver(...serie), octubre, alAviso);
    expect(alAviso).toHaveBeenCalledWith('serie-cortada');
  });

  it('una serie normal no avisa nada', () => {
    const alAviso = vi.fn();
    leerIcs(envolver(...simple('semanal', '20261007T120000Z', '20261007T130000Z', 'RRULE:FREQ=WEEKLY')), octubre, alAviso);
    expect(alAviso).not.toHaveBeenCalled();
  });

  it('un evento que termina justo al comienzo de la ventana no entra', () => {
    const lista = leerIcs(envolver(...simple('termina', '20261004T210000Z', '20261005T030000Z')), octubre);
    expect(lista).toEqual([]);
  });

  it('un evento que empieza el último día de la ventana entra', () => {
    const lista = leerIcs(envolver(...simple('ultimo', '20261031T150000Z', '20261031T160000Z')), octubre);
    expect(lista.map((r) => r.titulo)).toEqual(['ultimo']);
  });

  it('una serie madre cancelada no da ninguna ocurrencia', () => {
    const serie = simple('cancelada', '20261007T120000Z', '20261007T130000Z', 'RRULE:FREQ=WEEKLY', 'STATUS:CANCELLED');
    expect(leerIcs(envolver(...serie), octubre)).toEqual([]);
  });

  it('TRANSP:TRANSPARENT sin estado de Microsoft es libre', () => {
    const lista = leerIcs(envolver(...simple('libre', '20261021T120000Z', '20261021T130000Z', 'TRANSP:TRANSPARENT')), octubre);
    expect(lista[0]?.libre).toBe(true);
  });

  it('un SUMMARY vacío queda como Sin título', () => {
    const vacio = ['BEGIN:VEVENT', 'UID:v@t', 'SUMMARY:', 'DTSTART:20261021T120000Z', 'DTEND:20261021T130000Z', 'END:VEVENT'];
    expect(leerIcs(envolver(...vacio), octubre)[0]?.titulo).toBe('Sin título');
  });
});
