import { aUtc } from '../../fechas.js';

// Modelo neutro de un libro de Excel: lo arman las hojas y lo traduce `escribir.ts` a la librería.

export type ValorCelda = string | number | Date | null;

export interface Celda {
  valor: ValorCelda;
  /** Formato de número de Excel; una fecha sin formato usa `FORMATO_FECHA`. */
  formato?: string;
  negrita?: boolean;
}

export interface Hoja {
  nombre: string;
  filas: Celda[][];
  /** Ancho de cada columna, en caracteres. */
  anchos: number[];
  /** Cantidad de filas de arriba que quedan inmovilizadas (0 = ninguna). */
  filasFijas: number;
  /** Filtros sobre el encabezado de la tabla: `fila` es 1-based. */
  filtro?: { fila: number; columnas: number };
}

export const FORMATO_FECHA = 'dd/mm/yyyy';
export const FORMATO_FECHA_HORA = 'dd/mm/yyyy hh:mm';
export const FORMATO_DECIMAL = '0.0';

const MS_HORA = 3_600_000;
const DESFASE_ARGENTINA_HORAS = 3;

/** El día `YYYY-MM-DD` como medianoche UTC, para que Excel muestre ese día exacto. */
export const fechaExcel = (dia: string): Date => aUtc(dia);

/** El instante corrido −3 h, para que Excel (que no conoce zonas) muestre la hora argentina. */
export const instanteExcel = (iso: string): Date => new Date(Date.parse(iso) - DESFASE_ARGENTINA_HORAS * MS_HORA);
