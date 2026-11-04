import type { Catalogo, Tarea } from '../../../compartido/tipos.js';
import { diasEntre } from '../../fechas.js';
import { columnaDeTarea } from '../../tareas/logica.js';
import { cierresDe, diasDelPeriodo, type Periodo } from '../logica.js';
import { fechaExcel, FORMATO_DECIMAL, FORMATO_FECHA_HORA, instanteExcel, type Celda, type Hoja } from './modelo.js';

// Hojas «Completadas» y «Abiertas»: una fila por tarea. Todo texto de la app va como texto, nunca como fórmula.

const MS_DIA = 86_400_000;

const texto = (valor: string | null | undefined): Celda => ({ valor: valor ?? null });
const numero = (valor: number | null, formato?: string): Celda => (formato ? { valor, formato } : { valor });
const fecha = (dia: string | null): Celda => ({ valor: dia === null ? null : fechaExcel(dia) });
const encabezado = (titulos: string[]): Celda[] => titulos.map((valor) => ({ valor, negrita: true }));

const nombreDe = (lista: { id: number; nombre: string }[], id: number | null): string | null =>
  lista.find((e) => e.id === id)?.nombre ?? null;

const ENCABEZADO_COMPLETADAS = [
  'Tarea', 'Título', 'Proyecto', 'Tipo', 'Responsable', 'Creada', 'Cerrada', 'Fin', 'Horas estimadas', 'A tiempo', 'Ciclo (días)',
];
const ANCHOS_COMPLETADAS = [8, 50, 22, 14, 22, 18, 18, 12, 16, 10, 12];

const ENCABEZADO_ABIERTAS = [
  'Tarea', 'Título', 'Proyecto', 'Tipo', 'Estado', 'Prioridad', 'Responsable', 'Inicio', 'Fin', 'Horas estimadas', '% hecho', 'Días de atraso',
];
const ANCHOS_ABIERTAS = [8, 50, 22, 14, 16, 14, 22, 12, 12, 16, 10, 14];

const cicloEnDias = (tarea: Tarea): number | null => {
  const ms = Date.parse(tarea.cerradaEl ?? '') - Date.parse(tarea.creada);
  return Number.isNaN(ms) ? null : Math.round((ms / MS_DIA) * 10) / 10;
};

export function hojaCompletadas(tareas: Tarea[], catalogo: Catalogo, periodo: Periodo, hoy: string): Hoja {
  const dias = diasDelPeriodo(hoy, periodo);
  const cierres = cierresDe(tareas, catalogo)
    .filter((c) => dias.has(c.dia))
    .sort((a, b) => (a.tarea.cerradaEl ?? '').localeCompare(b.tarea.cerradaEl ?? '') || a.tarea.id - b.tarea.id);
  const filas = cierres.map(({ tarea, dia }): Celda[] => [
    numero(tarea.id),
    texto(tarea.titulo),
    texto(nombreDe(catalogo.proyectos, tarea.proyectoId)),
    texto(nombreDe(catalogo.tipos, tarea.tipoId)),
    texto(nombreDe(catalogo.personas, tarea.responsableId)),
    { valor: instanteExcel(tarea.creada), formato: FORMATO_FECHA_HORA },
    fecha(dia),
    fecha(tarea.fin),
    numero(tarea.estimacionHoras),
    texto(tarea.fin === null ? null : dia <= tarea.fin ? 'Sí' : 'No'),
    numero(cicloEnDias(tarea), FORMATO_DECIMAL),
  ]);
  return {
    nombre: 'Completadas',
    filas: [encabezado(ENCABEZADO_COMPLETADAS), ...filas],
    anchos: ANCHOS_COMPLETADAS,
    filasFijas: 1,
    filtro: { fila: 1, columnas: ENCABEZADO_COMPLETADAS.length },
  };
}

const atrasoDe = (tarea: Tarea, hoy: string): number | null =>
  tarea.fin !== null && tarea.fin < hoy ? diasEntre(tarea.fin, hoy) : null;

/** Más atraso primero (sin atraso al final), después fin ascendente (sin fin al final), después id. */
function comparar(hoy: string): (a: Tarea, b: Tarea) => number {
  return (a, b) => {
    const atrasoA = atrasoDe(a, hoy) ?? -1;
    const atrasoB = atrasoDe(b, hoy) ?? -1;
    if (atrasoA !== atrasoB) return atrasoB - atrasoA;
    if (a.fin !== b.fin) {
      if (a.fin === null) return 1;
      if (b.fin === null) return -1;
      return a.fin.localeCompare(b.fin);
    }
    return a.id - b.id;
  };
}

export function hojaAbiertas(tareas: Tarea[], catalogo: Catalogo, hoy: string): Hoja {
  const filas = tareas
    .filter((t) => columnaDeTarea(t, catalogo) !== 'cerrado')
    .sort(comparar(hoy))
    .map((tarea): Celda[] => [
      numero(tarea.id),
      texto(tarea.titulo),
      texto(nombreDe(catalogo.proyectos, tarea.proyectoId)),
      texto(nombreDe(catalogo.tipos, tarea.tipoId)),
      texto(nombreDe(catalogo.estados, tarea.estadoId)),
      texto(nombreDe(catalogo.prioridades, tarea.prioridadId)),
      texto(nombreDe(catalogo.personas, tarea.responsableId)),
      fecha(tarea.inicio),
      fecha(tarea.fin),
      numero(tarea.estimacionHoras),
      numero(tarea.porcentaje),
      numero(atrasoDe(tarea, hoy)),
    ]);
  return {
    nombre: 'Abiertas',
    filas: [encabezado(ENCABEZADO_ABIERTAS), ...filas],
    anchos: ANCHOS_ABIERTAS,
    filasFijas: 1,
    filtro: { fila: 1, columnas: ENCABEZADO_ABIERTAS.length },
  };
}
