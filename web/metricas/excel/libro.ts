import type { Catalogo, Tarea } from '../../../compartido/tipos.js';
import type { PeriodoCarga } from '../../equipo/carga.js';
import type { IntegranteEquipo } from '../../equipo/equipo.js';
import type { Metricas, Periodo } from '../logica.js';
import { hojaCarga, hojaPorDia, hojaResumen } from './hojasResumen.js';
import { hojaAbiertas, hojaCompletadas } from './hojasTareas.js';
import type { Hoja } from './modelo.js';

// Arma las cinco hojas del Excel de Métricas. `escribir.ts` carga la librería recién al exportar, por eso
// este archivo solo re-exporta `archivoExcel` y no importa write-excel-file.

export { archivoExcel } from './escribir.js';

export interface DatosLibro {
  metricas: Metricas;
  tareas: Tarea[];
  catalogo: Catalogo;
  integrantes: IntegranteEquipo[];
  periodo: Periodo;
  periodoCarga: PeriodoCarga;
  restarReuniones: boolean;
  hoy: string;
  generado: Date;
  nombreProyecto: (id: number) => string;
}

export function libroMetricas(d: DatosLibro): Hoja[] {
  return [
    hojaResumen(d.metricas, d.periodo, d.hoy, d.generado, d.nombreProyecto),
    hojaCompletadas(d.tareas, d.catalogo, d.periodo, d.hoy),
    hojaAbiertas(d.tareas, d.catalogo, d.hoy),
    hojaCarga(d.integrantes, d.periodoCarga, d.hoy, d.restarReuniones),
    hojaPorDia(d.metricas),
  ];
}

export const nombreExcel = (periodo: Periodo, hoy: string): string => `opendash-metricas-${periodo}d-${hoy}.xlsx`;
