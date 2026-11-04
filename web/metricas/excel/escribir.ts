import type { Feature, Sheet } from 'write-excel-file/browser';
import { FORMATO_FECHA, type Celda, type Hoja } from './modelo.js';

// Traduce el modelo de `modelo.ts` a write-excel-file. La librería se carga recién al exportar.

type Librería = typeof import('write-excel-file/browser');
type Contenido = File | Blob | ArrayBuffer;
type Datos = Sheet<Contenido>['data'];

/** Orden de los hijos de `<worksheet>` que Excel exige; solo hace falta lo que rodea a `<autoFilter>`. */
const ORDEN_HOJA = ['sheetData', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'mergeCells', 'pageMargins', 'pageSetup', 'drawing'];

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** 1 → 'A'; 27 → 'AA'. */
const letraDeColumna = (n: number): string => (n > LETRAS.length ? letraDeColumna(Math.floor((n - 1) / LETRAS.length)) : '') + LETRAS[(n - 1) % LETRAS.length];

const traducirCelda = (celda: Celda): Datos[number][number] => {
  if (celda.valor === null) return null;
  const base = { value: celda.valor, ...(celda.negrita ? { fontWeight: 'bold' as const } : {}) };
  if (celda.valor instanceof Date) return { ...base, format: celda.formato ?? FORMATO_FECHA };
  return celda.formato ? { ...base, format: celda.formato } : base;
};

/** «Feature» que agrega `<autoFilter>` a las hojas que traen `filtro`. */
const conFiltros = (hojas: Hoja[], utilidades: typeof import('write-excel-file/utility')): Feature<Contenido> => ({
  files: {
    transform: {
      'xl/worksheets/sheet{id}.xml': {
        transform: (xml, _opciones, { sheetIndex }) => {
          const filtro = hojas[sheetIndex]?.filtro;
          if (!filtro || filtro.columnas < 1) return xml;
          const ref = `A${filtro.fila}:${letraDeColumna(filtro.columnas)}${filtro.fila}`;
          const marca = utilidades.getSelfClosingTagMarkup('autoFilter', { ref });
          return utilidades.insertElementMarkupAccordingToOrderOfSiblings(xml, marca, ORDEN_HOJA, 'worksheet');
        },
      },
    },
  },
});

/** El libro de Excel con una pestaña por hoja, listo para descargar. */
export async function archivoExcel(hojas: Hoja[]): Promise<Blob> {
  const [{ default: escribirXlsx }, utilidades]: [Librería, typeof import('write-excel-file/utility')] = await Promise.all([
    import('write-excel-file/browser'),
    import('write-excel-file/utility'),
  ]);
  const libro = hojas.map((hoja) => ({
    data: hoja.filas.map((fila) => fila.map(traducirCelda)),
    sheet: hoja.nombre,
    columns: hoja.anchos.map((width) => ({ width })),
    ...(hoja.filasFijas > 0 ? { stickyRowsCount: hoja.filasFijas } : {}),
  }));
  return escribirXlsx(libro, { features: [conFiltros(hojas, utilidades)] }).toBlob();
}
