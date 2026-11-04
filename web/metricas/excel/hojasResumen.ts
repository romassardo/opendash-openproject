import { diasDeVacaciones } from '../../equipo/capacidad.js';
import { intervaloCarga, type PeriodoCarga } from '../../equipo/carga.js';
import type { IntegranteEquipo } from '../../equipo/equipo.js';
import { sumarDias } from '../../fechas.js';
import type { Indicador, Metricas, Periodo } from '../logica.js';
import {
  fechaExcel, FORMATO_DECIMAL, FORMATO_FECHA_HORA, instanteExcel, type Celda, type Hoja,
} from './modelo.js';

// Hojas «Resumen», «Carga» y «Por día». Sin dato, la celda queda vacía (`null`).

const texto = (valor: string | null): Celda => ({ valor });
const numero = (valor: number | null, formato?: string): Celda => (formato ? { valor, formato } : { valor });
const fecha = (dia: string): Celda => ({ valor: fechaExcel(dia) });
const negrita = (titulos: string[]): Celda[] => titulos.map((valor) => ({ valor, negrita: true }));

const redondear = (valor: number, decimales: number): number => {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
};

function filaIndicador(titulo: string, i: Indicador, decimales: number, formato?: string): Celda[] {
  const diferencia = i.valor !== null && i.anterior !== null ? redondear(i.valor - i.anterior, decimales) : null;
  return [texto(titulo), numero(i.valor, formato), numero(i.anterior, formato), numero(diferencia, formato)];
}

export function hojaResumen(
  m: Metricas, periodo: Periodo, hoy: string, generado: Date, nombreProyecto: (id: number) => string,
): Hoja {
  const filas: Celda[][] = [
    [{ valor: 'Métricas de OpenDash', negrita: true }],
    [texto('Período'), texto(`Últimos ${periodo} días`)],
    [texto('Desde'), fecha(sumarDias(hoy, -(periodo - 1)))],
    [texto('Hasta'), fecha(hoy)],
    [texto('Generado el'), { valor: instanteExcel(generado.toISOString()), formato: FORMATO_FECHA_HORA }],
    [],
    negrita(['Indicador', 'Período', 'Período anterior', 'Diferencia']),
    filaIndicador('Completadas', m.completadas, 0),
    filaIndicador('A tiempo (%)', m.aTiempo, 0),
    filaIndicador('Tiempo de ciclo (días)', m.cicloDias, 1, FORMATO_DECIMAL),
    [],
    negrita(['Proyecto', 'Cerradas', '% del total']),
    ...m.porProyecto.map((p): Celda[] => [texto(nombreProyecto(p.proyectoId)), numero(p.cantidad), numero(p.porcentaje)]),
  ];
  return { nombre: 'Resumen', filas, anchos: [28, 20, 20, 14], filasFijas: 0 };
}

const TITULO_CARGA: Record<PeriodoCarga, string> = {
  semana: 'de esta semana',
  quincena: 'de esta semana y la próxima',
  mes: 'de las próximas 4 semanas',
};

const ENCABEZADO_CARGA = [
  'Persona', 'Rol', 'Capacidad semanal (h)', 'Capacidad del período (h)', 'Feriados (días)', 'Vacaciones (días)',
  'Reuniones (h)', 'Horas asignadas', 'Carga (%)', 'Tareas abiertas', 'Excedida',
];

function reunionesDe(i: IntegranteEquipo, restarReuniones: boolean): Celda {
  if (!restarReuniones) return texto(null);
  return i.ajuste.sinCalendario ? texto('Sin calendario') : numero(i.ajuste.horasReunion);
}

const cargaPorcentual = (horas: number, capacidad: number): number | null =>
  capacidad > 0 ? Math.round((horas / capacidad) * 100) : null;

export function hojaCarga(integrantes: IntegranteEquipo[], periodo: PeriodoCarga, hoy: string, restarReuniones: boolean): Hoja {
  const intervalo = intervaloCarga(hoy, periodo);
  const filas = integrantes.map((i): Celda[] => [
    texto(i.persona.nombre),
    texto(i.rol === '' ? null : i.rol),
    numero(i.capacidad),
    numero(i.carga.capacidad),
    numero(i.ajuste.feriados.length),
    numero(diasDeVacaciones(i.ajuste, intervalo)),
    reunionesDe(i, restarReuniones),
    numero(i.carga.horas),
    numero(cargaPorcentual(i.carga.horas, i.carga.capacidad)),
    numero(i.carga.abiertas),
    texto(i.carga.excedida ? 'Sí' : 'No'),
  ]);
  return {
    nombre: 'Carga',
    filas: [
      [{ valor: `Carga ${TITULO_CARGA[periodo]}`, negrita: true }],
      [texto('Desde'), fecha(intervalo.desde), texto('Hasta'), fecha(intervalo.hasta)],
      [],
      negrita(ENCABEZADO_CARGA),
      ...filas,
    ],
    anchos: [24, 18, 14, 16, 12, 12, 14, 14, 11, 12, 10],
    filasFijas: 4,
    filtro: { fila: 4, columnas: ENCABEZADO_CARGA.length },
  };
}

export function hojaPorDia(m: Metricas): Hoja {
  const titulos = ['Día', 'Cerradas', 'Cerradas en el período anterior'];
  return {
    nombre: 'Por día',
    filas: [negrita(titulos), ...m.ritmo.map((d): Celda[] => [fecha(d.fecha), numero(d.actual), numero(d.anterior)])],
    anchos: [14, 12, 30],
    filasFijas: 1,
    filtro: { fila: 1, columnas: titulos.length },
  };
}
