import { calendarioDe } from '../../compartido/calendarioOp.js';
import { partesDe, type PausasPorTarea } from '../../compartido/pausas.js';
import type { AjustesMetricas, Catalogo, MiembroEquipo, Persona, Presencia, Tarea } from '../../compartido/tipos.js';
import { aUtc, sumarDias } from '../fechas.js';
import { capacidadDelPeriodo, type AjusteCapacidad } from './capacidad.js';
import { cargaDePersona, intervaloCarga, type CargaPersona, type PeriodoCarga, type TrabajoDe } from './carga.js';

// Lógica pura de la pantalla Equipo (spec §12.2). `hoy` es 'YYYY-MM-DD' en hora argentina.

export interface IntegranteEquipo {
  persona: Persona;
  presencia: Presencia;
  rol: string;
  capacidad: number;
  carga: CargaPersona;
  /** Lo que descuentan los feriados, las vacaciones y las reuniones de la capacidad del período. */
  ajuste: AjusteCapacidad;
  vacaciones: { desde: string; hasta: string }[];
  trabajandoEn: number[];
  esYo: boolean;
}

const esFinDeSemana = (fecha: string): boolean => [0, 6].includes(aUtc(fecha).getUTCDay());

/** ¿La vacación siguiente sigue a la anterior sin días hábiles en el medio? */
function sigueSinHabiles(fin: string, desde: string): boolean {
  for (let dia = sumarDias(fin, 1); dia < desde; dia = sumarDias(dia, 1)) {
    if (!esFinDeSemana(dia)) return false;
  }
  return desde > fin;
}

/**
 * Hasta cuándo dura la ausencia de quien hoy está de vacaciones: el fin de la que contiene hoy, encadenando las
 * que siguen sin días hábiles en el medio. `null` si hoy no está de vacaciones.
 */
export function finDeVacaciones(vacaciones: readonly { desde: string; hasta: string }[], hoy: string): string | null {
  const ordenadas = [...vacaciones].sort((a, b) => a.desde.localeCompare(b.desde));
  const actual = ordenadas.find((v) => v.desde <= hoy && hoy <= v.hasta);
  if (!actual) return null;
  let fin = actual.hasta;
  for (const v of ordenadas) {
    if (v.desde > actual.desde && v.hasta > fin && sigueSinHabiles(fin, v.desde)) fin = v.hasta;
  }
  return fin;
}

const porNombre =(a: IntegranteEquipo, b: IntegranteEquipo): number => a.persona.nombre.localeCompare(b.persona.nombre, 'es-AR');

/**
 * Quienes figuran: las personas responsables de alguna tarea visible más las registradas visibles.
 * Con `proyectoId`, solo las que tienen tareas en ese proyecto o pueden recibirlas. Las que no entraron a
 * OpenDash quedan «sin OpenDash», con la capacidad por defecto. Vos primero; después, por nombre.
 * `capacidad` es siempre la semanal; la de `carga` es la del período, ya ajustada. Los días de pausa no son carga.
 */
export function armarEquipo(
  catalogo: Catalogo, tareas: Tarea[], miembros: MiembroEquipo[], ajustes: AjustesMetricas, yoId: number, hoy: string, proyectoId: number | null,
  periodo: PeriodoCarga = 'semana', feriados: ReadonlySet<string> = new Set(), pausas: PausasPorTarea = {},
): IntegranteEquipo[] {
  const cal = calendarioDe(catalogo);
  const trabajoDe: TrabajoDe = (t) => {
    const deLaTarea = pausas[t.id];
    return deLaTarea?.length && t.inicio !== null && t.fin !== null ? partesDe(t.inicio, t.fin, deLaTarea, cal).trabajo : null;
  };
  const registrados = new Map(miembros.map((m) => [m.personaId, m]));
  const conTareas = new Set(tareas.flatMap((t) => (t.responsableId === null ? [] : [t.responsableId])));
  const conTareasEnProyecto = new Set(
    tareas.flatMap((t) => (t.proyectoId === proyectoId && t.responsableId !== null ? [t.responsableId] : [])),
  );
  const intervalo = intervaloCarga(hoy, periodo);
  const asignables = new Set(proyectoId === null ? [] : (catalogo.asignables[proyectoId] ?? []));

  return catalogo.personas
    .filter((p) => conTareas.has(p.id) || registrados.has(p.id))
    .filter((p) => proyectoId === null || conTareasEnProyecto.has(p.id) || asignables.has(p.id))
    .map((persona): IntegranteEquipo => {
      const miembro = registrados.get(persona.id);
      const capacidad = miembro?.capacidadHoras ?? ajustes.capacidadPorDefecto;
      const ajuste = capacidadDelPeriodo(capacidad, intervalo, feriados, miembro);
      return {
        persona,
        presencia: miembro?.presencia ?? 'sin-opendash',
        rol: miembro?.rol ?? '',
        capacidad,
        carga: cargaDePersona(persona.id, tareas, catalogo, capacidad, ajustes, hoy, periodo, ajuste.capacidad, trabajoDe),
        ajuste,
        vacaciones: miembro?.vacaciones ?? [],
        trabajandoEn: miembro?.trabajandoEn ?? [],
        esYo: persona.id === yoId,
      };
    })
    .sort((a, b) => (a.esYo === b.esYo ? porNombre(a, b) : a.esYo ? -1 : 1));
}

export interface ContadoresEquipo { personas: number; conOpenDash: number; conectados: number; trabajando: number; cargaPromedio: number }

export function contadoresEquipo(integrantes: IntegranteEquipo[]): ContadoresEquipo {
  const registrados = integrantes.filter((i) => i.presencia !== 'sin-opendash');
  const porcentajes = integrantes.map((i) => {
    const { horas, capacidad } = i.carga;
    if (capacidad > 0) return (horas / capacidad) * 100;
    return horas > 0 ? 100 : 0;
  });
  const suma = porcentajes.reduce((total, p) => total + p, 0);
  return {
    personas: integrantes.length,
    conOpenDash: registrados.length,
    // Quien está trabajando o en reunión también cuenta como conectado.
    conectados: registrados.filter((i) => i.presencia === 'conectado' || i.presencia === 'trabajando' || i.presencia === 'reunion').length,
    trabajando: integrantes.filter((i) => i.presencia === 'trabajando').length,
    cargaPromedio: integrantes.length > 0 ? Math.round(suma / integrantes.length) : 0,
  };
}
