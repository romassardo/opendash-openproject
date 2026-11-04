import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { fechaExcel, instanteExcel, type Hoja } from './modelo.js';
import { archivoExcel } from './escribir.js';

/** Lee el Blob con FileReader (jsdom) y devuelve los archivos del .xlsx descomprimidos como texto. */
async function archivos(hojas: Hoja[]): Promise<Record<string, string>> {
  const blob = await archivoExcel(hojas);
  const bytes = await new Promise<Uint8Array>((ok, falla) => {
    const lector = new FileReader();
    lector.onload = () => ok(new Uint8Array(lector.result as ArrayBuffer));
    lector.onerror = () => falla(lector.error);
    lector.readAsArrayBuffer(blob);
  });
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([ruta, datos]) => [ruta, strFromU8(datos)]));
}

const hoja = (cambios: Partial<Hoja> = {}): Hoja => ({
  nombre: 'Hoja',
  filas: [[{ valor: 'Encabezado', negrita: true }]],
  anchos: [],
  filasFijas: 0,
  ...cambios,
});

describe('fechaExcel e instanteExcel', () => {
  it('fechaExcel da la medianoche UTC del día', () => {
    expect(fechaExcel('2026-10-19')).toEqual(new Date('2026-10-19T00:00:00Z'));
  });

  it('instanteExcel corre el instante -3 h para mostrar la hora argentina', () => {
    expect(instanteExcel('2026-10-19T12:30:00Z').toISOString()).toBe('2026-10-19T09:30:00.000Z');
  });
});

describe('archivoExcel', () => {
  it('nombra las hojas en orden', async () => {
    const a = await archivos([hoja({ nombre: 'Resumen' }), hoja({ nombre: 'Por día' })]);
    const libro = a['xl/workbook.xml'] ?? '';
    expect(libro.indexOf('name="Resumen"')).toBeGreaterThan(-1);
    expect(libro.indexOf('name="Por día"')).toBeGreaterThan(libro.indexOf('name="Resumen"'));
  });

  it('escribe una fecha como serial de Excel con estilo de fecha', async () => {
    const a = await archivos([hoja({ filas: [[{ valor: fechaExcel('2026-10-19') }]] })]);
    const xml = a['xl/worksheets/sheet1.xml'] ?? '';
    expect(xml).toContain('<v>46314</v>');
    expect(xml).toMatch(/<c [^>]*s="[1-9]\d*"[^>]*><v>46314<\/v>/);
    expect(a['xl/styles.xml']).toContain('dd/mm/yyyy');
  });

  it('inmoviliza filas y fija anchos', async () => {
    const a = await archivos([hoja({ filasFijas: 1, anchos: [12, 30] })]);
    const xml = a['xl/worksheets/sheet1.xml'] ?? '';
    expect(xml).toContain('<pane');
    expect(xml).toContain('state="frozen"');
    expect(xml.match(/<col /g)).toHaveLength(2);
    expect(xml).toMatch(/width="12"/);
    expect(xml).toMatch(/width="30"/);
  });

  it('sin filas fijas no hay panel', async () => {
    const a = await archivos([hoja()]);
    expect(a['xl/worksheets/sheet1.xml']).not.toContain('<pane');
  });

  it('un texto que empieza con = no genera fórmula', async () => {
    const a = await archivos([hoja({ filas: [[{ valor: '=1+1' }]] })]);
    const xml = a['xl/worksheets/sheet1.xml'] ?? '';
    expect(xml).not.toContain('<f>');
    expect(xml).not.toContain('<f ');
  });

  it('una celda vacía (null) no escribe valor', async () => {
    const a = await archivos([hoja({ filas: [[{ valor: null }, { valor: 'x' }]] })]);
    expect(a['xl/worksheets/sheet1.xml']).not.toContain('null');
  });

  it('una hoja con encabezado y sin datos se escribe sin error', async () => {
    const a = await archivos([hoja({ nombre: 'Vacía' })]);
    expect(a['xl/worksheets/sheet1.xml']).toBeDefined();
  });

  it('el filtro agrega autoFilter sobre el encabezado', async () => {
    const a = await archivos([hoja({ filas: [[{ valor: 'A' }, { valor: 'B' }, { valor: 'C' }]], filtro: { fila: 1, columnas: 3 } })]);
    expect(a['xl/worksheets/sheet1.xml']).toContain('<autoFilter ref="A1:C1"');
  });
});
