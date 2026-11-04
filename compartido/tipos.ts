import type { EstiloProyecto } from './estilos.js';
import type { NivelPrioridad } from './prioridades.js';

export type Columna ='nuevo' | 'curso' | 'pausa' | 'cerrado';
export interface Estado { id: number; nombre: string; cerrado: boolean; color: string }
export interface TipoTarea { id: number; nombre: string; esHito: boolean; color: string }
export interface Prioridad { id: number; nombre: string; alta: boolean; nivel: NivelPrioridad | null }   // alta: nivel 'alta' o 'inmediata'
export interface Persona { id: number; nombre: string; login: string | null; email: string | null; avatarUrl: string | null }
export interface Proyecto { id: number; nombre: string; identificador: string; activo: boolean; estadoOp: string | null;
  /** Último tramo del enlace de estado: on_track, at_risk, off_track, not_started, finished o discontinued. */
  estadoOpClave: string | null; descripcion: string }
export type EstadoVersion = 'abierta' | 'bloqueada' | 'cerrada';
export interface Version { id: number; nombre: string; proyectoId: number; estado: EstadoVersion; inicio: string | null; fin: string | null }   // fechas: 'YYYY-MM-DD'
export interface Rol { id: number; nombre: string }
export interface Miembro { id: number; personaId: number; roles: Rol[] }
/** Lo que OpenProject deja hacer a una persona en un proyecto (`/api/v3/capabilities`). */
export interface Capacidades { crearMiembro: boolean; cambiarMiembro: boolean; quitarMiembro: boolean; copiarProyecto: boolean }
export interface TrabajoCopia { estado: 'en-curso' | 'listo' | 'fallo'; proyectoId: number | null; errores: string[] }
/** Id del estado que escribe cada columna del tablero; `null` = el estado de esa columna se busca por nombre. */
export interface MapeoTablero { nuevo: number | null; curso: number | null; pausa: number | null; cerrado: number | null }
/** Lo que trae OpenProject (y guarda la caché); el mapeo del tablero es de OpenDash y se suma al responder. */
export interface CatalogoOp { estados: Estado[]; tipos: TipoTarea[]; prioridades: Prioridad[]; proyectos: Proyecto[]; versiones: Version[]; personas: Persona[];
  /** Ids de las personas a quienes OpenProject deja asignar tareas, por proyecto. */
  asignables: Record<number, number[]>;
  /** Días de la semana no laborables en OpenProject, 0 = domingo … 6 = sábado (como `getUTCDay()`). */
  semanaNoLaborable: number[];
  /** Fechas 'YYYY-MM-DD' no laborables (feriados de OpenProject), ordenadas. */
  diasNoLaborables: string[];
  /** Ids de los proyectos que OpenProject marca como plantilla (vacío si no se pudo leer). */
  plantillasOp: number[] }
export interface Catalogo extends CatalogoOp {
  tablero: MapeoTablero;
  /** Proyectos visibles que son plantilla: los de OpenProject más los marcados a mano, menos los desmarcados a mano. */
  plantillas: number[];
}
/** Valores que usan las métricas cuando una persona no tiene los suyos (horas y capacidad semanal). */
export interface AjustesMetricas { horasPorDefecto: number; horasSemanaLargas: number; capacidadPorDefecto: number; restarReuniones: boolean }
export interface Vacaciones { id: number; desde: string; hasta: string }   // inclusive
export interface AjustesHoras { jornadaHoras: number }
export interface AjustesAvisos { receptores: number[] }
export interface Ajustes { estilos: Record<number, EstiloProyecto>; metricas: AjustesMetricas; horas: AjustesHoras; avisos: AjustesAvisos }
export type EstadoAviso = 'nuevo' | 'visto' | 'arreglado';
export interface ContextoAviso { ruta: string; titulo: string; navegador: string; ventana: string; tema: Tema; version: string; error: string | null }
export interface AvisoProblema {
  id: number; usuarioId: number; creado: string; texto: string; contexto: ContextoAviso;
  tieneImagen: boolean; estado: EstadoAviso; marcadoPor: number | null; marcadoEl: string | null;
}
export interface Tarea {
  id: number; lockVersion: number; titulo: string; descripcion: string;   // descripción en markdown crudo
  proyectoId: number; tipoId: number; estadoId: number; prioridadId: number;
  responsableId: number | null; autorId: number | null;
  inicio: string | null; fin: string | null;                               // 'YYYY-MM-DD'
  estimacionHoras: number | null; porcentaje: number | null;
  horasReales: number | null;                                              // spentTime; null si falta
  restanteHoras: number | null;                                            // remainingTime («Trabajo restante»); null si falta
  madreId: number | null; versionId: number | null; programacionManual: boolean;
  creada: string; actualizada: string;                                     // ISO
  cerradaEl: string | null; comentarios: number | null;                    // los completa la caché
}
export interface Adjunto { id: number; nombre: string; bytes: number; tipo: string; autorId: number | null; creado: string; puedeBorrar: boolean }
export interface Dependencia { id: number; sucesoraId: number; predecesoraId: number; lag: number }
export interface Actividad { id: number; creada: string; autorId: number | null; comentario: string; detalles: string[] }
/** Por qué el servidor no pudo releer las actividades después de guardar un comentario. */
/** Estado de presencia de una persona. `'reunion'` llega en la etapa 3 (calendario). */
export type Tema = 'oscuro' | 'claro';
/** La persona que tiene la sesión abierta, con sus ajustes. El enlace del calendario nunca viaja: solo si existe. */
export interface Yo {
  id: number;
  login: string;
  nombre: string;
  tema: Tema;
  /** Ids de los proyectos fijados. */
  fijados: number[];
  /** `false` mientras el servidor no terminó de traer los datos de OpenProject por primera vez. */
  cargaInicialLista: boolean;
  rol: string;
  capacidadHoras: number;
  /** Opción personal: cronometrar varias tareas a la vez. */
  variasALaVez: boolean;
  /** Esta persona está entre las que reciben los avisos de problemas. */
  recibeAvisos: boolean;
  /** Minutos de anticipación del aviso de reunión; `null` = no avisar. */
  avisoReunionMin: number | null;
  tieneCalendario: boolean;
  /** Estado de la lectura del calendario; `null` si no hay enlace guardado. */
  calendario: EstadoCalendario | null;
}
export type Presencia = 'conectado' | 'trabajando' | 'reunion' | 'vacaciones' | 'ausente' | 'sin-opendash';
export interface MiembroEquipo {
  personaId: number; presencia: Exclude<Presencia, 'sin-opendash'>; rol: string; capacidadHoras: number;
  /** Las tareas en marcha (no pausadas) que quien mira puede ver. */
  trabajandoEn: number[];
  /** Las vacaciones que terminan el lunes de esta semana o después. */
  vacaciones: { desde: string; hasta: string }[];
  /** Horas de reunión a restar por semana (clave: el lunes). null con la opción apagada; 'sin-calendario' si no hay reuniones leídas. */
  reunionesPorSemana: Record<string, number> | 'sin-calendario' | null;
}
export type MotivoSinReleer = 'sin-conexion' | 'token-vencido' | 'sin-acceso';
export interface RespuestaComentario { actividades: Actividad[]; sinReleer: MotivoSinReleer | null }
export interface Notificacion { id: number; leida: boolean; motivo: string; tareaId: number | null; titulo: string; creada: string; actorId: number | null }
export interface CambiosTarea {
  titulo?: string; descripcion?: string; estadoId?: number; prioridadId?: number; responsableId?: number | null;
  inicio?: string | null; fin?: string | null; /** Solo hitos: su única fecha. */ fecha?: string | null; estimacionHoras?: number | null; madreId?: number | null; versionId?: number | null; proyectoId?: number;
  /** «Trabajo restante»; viaja como `remainingTime`. */ restanteHoras?: number | null;
  /** Viaja a OpenProject como `scheduleManually`. */ programacionManual?: boolean;
  /** Duración en días hábiles; viaja como `duration` ISO 8601 (`P3D`). */ duracionDias?: number;
}
export interface NuevaTarea {
  titulo: string; proyectoId: number; tipoId?: number; estadoId?: number; responsableId?: number | null; madreId?: number | null;
  inicio?: string | null; fin?: string | null; versionId?: number | null; programacionManual?: boolean;
}

export type Plataforma = 'teams' | 'meet' | 'zoom';
/** Una reunión del calendario propio. Instantes ISO; las de día entero van de 00:00 a 00:00 argentinas. */
export interface Reunion { id: string; titulo: string; lugar: string | null; inicio: string; fin: string;
  diaEntero: boolean; libre: boolean; enlace: string | null; plataforma: Plataforma | null }
/** Días argentinos 'YYYY-MM-DD', ambos incluidos. */
export interface VentanaFechas { desde: string; hasta: string }
export type FallaCalendario = 'enlace-caido' | 'sin-conexion';
/** Cuándo se leyó bien por última vez y, si la última lectura falló, por qué. */
export interface EstadoCalendario { leido: string | null; falla: FallaCalendario | null }
/** Lo que devuelve `GET /api/calendario`: solo las reuniones de quien pide. */
export interface CalendarioPropio { reuniones: Reunion[]; estado: EstadoCalendario | null; ventana: VentanaFechas | null }

/** Un día no laborable. `manual`: lo agregó una persona a mano; `puente`: día puente del calendario oficial. */
export interface Feriado { fecha: string; nombre: string; puente: boolean; manual: boolean }
/** Del 1 de enero del año en curso al 31 de diciembre del siguiente; `actualizado` es la última bajada buena. */
export interface ListaFeriados { feriados: Feriado[]; actualizado: string | null }

export type EstadoCarga = 'abierto' | 'pendiente' | 'cargado' | 'rechazado' | 'descartado';
/** Instantes ISO; `hasta` null = corriendo. */
export interface Pedazo { tramoId: number; desde: string; hasta: string | null }
export interface Tramo {
  id: number; usuarioId: number; tareaId: number; /** Día argentino 'YYYY-MM-DD' del inicio. */ dia: string;
  inicio: string; fin: string | null; pausado: boolean;
  /** Lo contado para la tarea (reparto y tope ya aplicados, o la corrección); null mientras está abierto. */
  segundos: number | null;
  frenadoSolo: 'tope' | 'medianoche' | null; avisoVisto: boolean;
  estado: EstadoCarga; entradaOpId: number | null; motivo: string | null;
}
export interface EstadoHoras {
  /** Abiertos, con lo contado hasta ahora. */
  enMarcha: (Tramo & { segundosVivos: number })[];
  /** Cerrados del día. */
  hoy: Tramo[];
  /** Frenados solos sin ver, pendientes y rechazados. */
  avisos: Tramo[];
  totalHoySegundos: number; jornadaSegundos: number; variasALaVez: boolean;
  /** Hoy la persona confirmó seguir después del tope: el día no tiene tope. */
  horasExtra: boolean;
  /** El último día trabajado antes de hoy (hasta dos semanas atrás) y sus tareas, para «Retomar». */
  ultimoDia: { dia: string; tareaIds: number[] } | null;
}
export interface HorasPorDia { usuarioId: number; dia: string; segundos: number }

/** Lo que se pierde al borrar una tarea; `trabajando` es quien tiene un tramo abierto en ella o en sus subtareas. */
/**
 * Lo que se pierde al borrar una tarea. `puede` exige que la haya creado quien pregunta y que OpenProject la deje borrar;
 * si no, `motivo` dice por qué. `ajenas` cuenta las subtareas que creó otra persona (con alguna no se borra: OpenProject
 * se las llevaría en cascada) y `sucesoras` nombra las tareas que la esperan, que dejan de esperarla.
 */
export interface ResumenBorrado {
  puede: boolean; motivo: string | null; subtareas: number; horas: number; adjuntos: number;
  trabajando: string | null; ajenas: number; sucesoras: string[];
}
