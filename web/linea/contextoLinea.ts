import type { Partes } from '../../compartido/pausas.js';
import type { Catalogo, Persona, Tarea } from '../../compartido/tipos.js';
import type { Tono } from '../../compartido/estilos.js';
import type { Tramo } from './ausencias.js';
import type { CambiosLinea } from './useCambiosLinea.js';
import type { Ventana } from './modelo.js';
import type { Fila } from './filas.js';
import type { ManejadoresOrden } from './useOrdenar.js';
import type { DestinoUnir, PointerHandlers } from './useUnir.js';

/** Lo que comparten todos los renglones de la línea: se arma una vez por dibujo. */
export interface ContextoLinea {
  ventana: Ventana;
  hoy: string;
  catalogo: Catalogo;
  personas: ReadonlyMap<number, Persona>;
  porId: ReadonlyMap<number, Tarea>;
  /** Ids de las tareas que son madre de otra: si son automáticas, sus fechas salen de las hijas. */
  conHijas: ReadonlySet<number>;
  /** Primera predecesora de cada tarea que espera a otra (clave: la sucesora). */
  predecesoraDe: ReadonlyMap<number, number>;
  /** Título de la anterior con la que se pisa cada tarea (clave: la sucesora en conflicto). */
  anteriorEnConflicto: ReadonlyMap<number, string>;
  /** Vista por persona: los renglones no llevan marcador de persona. */
  porPersona: boolean;
  tonoDeProyecto: (proyectoId: number) => Tono;
  vacaciones: ReadonlyMap<number, Tramo[]>;
  /** `null` sin foco en la línea; si no, las tareas de la cadena enfocada. */
  enfoque: ReadonlySet<number> | null;
  alEnfocar: (id: number | null) => void;
  alAbrir: (id: number) => void;
  /** Sin él la línea es de solo lectura. */
  cambios?: CambiosLinea;
  /** Abre el alta de una tarea en el proyecto (y dentro de la madre, si hay); sin él no hay «+». */
  alCrear?: (proyectoId: number, madreId: number | null) => void;
  /** La tarea recién creada desde la línea: su barra se resalta. */
  recien: number | null;
  /** Tramos de trabajo y pausas de la tarea; `null` si no tiene pausas. */
  partesDe: (tarea: Tarea) => Partes | null;
  alternarGrupo: (id: number) => void;
  /** Muestra u oculta las terminadas de una franja (`persona-9`, `proyecto-3`, `todas`, `sin-asignar`). */
  alternarTerminadas: (franja: string) => void;
  /** Lleva la ventana hasta `fecha` (la marca de una terminada fuera de la ventana); sin él la marca no es un botón. */
  irAFecha?: (fecha: string) => void;
  /** Manejadores del puntito de unir de cada tarea; sin ellos no hay puntito. */
  unirManejadores?: (id: number) => PointerHandlers;
  /** Renglón sobre el que está el puntito en pleno arrastre. */
  destinoUnir: DestinoUnir | null;
  /** Ordenar con el ⠿; sin él el asa no hace nada. */
  ordenar?: {
    /** Corrimiento vertical (px) de cada renglón durante el arrastre, por clave de fila. */
    desplazamientos: ReadonlyMap<string, number>;
    levantada: string | null;
    manejadores: (fila: Extract<Fila, { tipo: 'tarea' | 'grupo' }>) => ManejadoresOrden;
  };
}
