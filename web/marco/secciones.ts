import { Calendar, ChartGantt, ChartNoAxesColumn, Folder, House, ListChecks, Settings, SquareCheck, Users, type LucideIcon } from 'lucide-react';

export interface Seccion {
  ruta: string;
  nombre: string;
  icono: LucideIcon;
  /** Las que todavía no existen muestran «Próximamente». */
  disponible: boolean;
}

export const SECCIONES: readonly Seccion[] = [
  { ruta: '/inicio', nombre: 'Inicio', icono: House, disponible: true },
  { ruta: '/tareas', nombre: 'Tareas', icono: SquareCheck, disponible: true },
  { ruta: '/para-ordenar', nombre: 'Para ordenar', icono: ListChecks, disponible: true },
  { ruta: '/calendario', nombre: 'Calendario', icono: Calendar, disponible: true },
  { ruta: '/linea-de-tiempo', nombre: 'Línea de tiempo', icono: ChartGantt, disponible: true },
  { ruta: '/proyectos', nombre: 'Proyectos', icono: Folder, disponible: true },
  { ruta: '/metricas', nombre: 'Métricas', icono: ChartNoAxesColumn, disponible: true },
  { ruta: '/equipo', nombre: 'Equipo', icono: Users, disponible: true },
  { ruta: '/configuracion', nombre: 'Configuración', icono: Settings, disponible: true },
];

/** Primer tramo de la ruta: `/tareas/12` y `/tareas` son la misma sección. */
export function seccionDe(ruta: string): string {
  return ruta.split('/')[1] ?? '';
}
