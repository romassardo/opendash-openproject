import { keepPreviousData, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Actividad, Adjunto, Ajustes, AvisoProblema, CalendarioPropio, Catalogo, Dependencia, Miembro, Persona, Rol, ListaFeriados, EstadoHoras, HorasPorDia, MiembroEquipo, Notificacion, ResumenBorrado, Tarea, Vacaciones, Version, Yo } from '../../compartido/tipos.js';
import type { OrdenLinea } from '../../compartido/linea.js';
import type { PausasPorTarea } from '../../compartido/pausas.js';
import { ErrorApi, hayDesactualizados, pedir, suscribirFrescura, suscribirTokenVencido, tokenVencido } from './cliente.js';

export interface ListaTareas { tareas: Tarea[]; dependencias: Dependencia[] }
/** Lo que responde `GET /api/horas/equipo`: horas por persona y día, y quién trabaja en qué tareas visibles. */
export interface HorasEquipo { dias: HorasPorDia[]; enMarcha: { usuarioId: number; tareaIds: number[] }[] }
export interface DetalleTarea { tarea: Tarea; actividades: Actividad[] }

export const CLAVES = {
  yo: ['yo'],
  catalogo: ['catalogo'],
  tareas: ['tareas'],
  tarea: (id: number) => ['tarea', id],
  adjuntos: (tareaId: number) => ['adjuntos', tareaId],
  borrado: (tareaId: number) => ['borrado', tareaId],
  /** Cuelga de `borrado`: quitar el resumen de una tarea quita también su permiso. */
  permisoBorrado: (tareaId: number) => ['borrado', tareaId, 'permiso'],
  versiones: (proyectoId: number) => ['versiones', proyectoId],
  miembros: (proyectoId: number) => ['miembros', proyectoId],
  notificaciones: ['notificaciones'],
  ajustes: ['ajustes'],
  ordenLinea: ['orden-linea'],
  pausas: ['pausas'],
  equipo: ['equipo'],
  feriados: ['feriados'],
  vacaciones: ['vacaciones'],
  /** Vacaciones que terminan ese día o después (sirve para mirar meses pasados). */
  vacacionesDesde: (desde: string) => ['vacaciones', 'desde', desde],
  /** Prefijo común de todos los rangos: invalidarlo recarga cualquiera. */
  calendarioTodos: ['calendario'],
  calendario: (desde: string, hasta: string) => ['calendario', desde, hasta],
  // Propia del vigilante de reuniones: no se mezcla con Inicio y el Calendario, que sí son actividad.
  calendarioFondo: (desde: string, hasta: string) => ['calendario', 'fondo', desde, hasta],
  horas: ['horas'],
  horasEquipo: (dias: number) => ['horas', 'equipo', dias],
  avisosTodos: ['avisos-problema', 'todos'],
} as const;

const REFRESCO_TAREAS_MS = 30_000;
const REFRESCO_NOTIFICACIONES_MS = 60_000;
const REFRESCO_PRESENCIA_MS = 30_000;
const REFRESCO_HORAS_MS = 60_000;
const REFRESCO_CALENDARIO_MS = 60_000;
// Recién registrada, la persona ve todo vacío hasta que el servidor termina la carga inicial: mientras
// `yo.cargaInicialLista` sea false se vuelve a preguntar seguido, con un tope de intentos.
const REFRESCO_RAPIDO_MS = 3_000;
export const TOPE_SONDEOS_RAPIDOS = 40;
// Una carga inicial larga (muchos proyectos): pasado el tope, `yo` sigue preguntando, más espaciado.
const REFRESCO_ESPERA_MS = 15_000;

export interface EntradaRefresco {
  vencido: boolean;
  cargaLista: boolean;
  /** Sondeos rápidos ya hechos. */
  intentos: number;
  /** Intervalo de siempre (`false`: no se refresca solo). */
  normalMs: number | false;
  /** Intervalo pasado el tope mientras la carga sigue sin terminar (por defecto, el de siempre). */
  trasTopeMs?: number | false;
}

/** Único lugar que decide cada cuánto se vuelve a pedir una consulta (tareas, catálogo y `yo`). */
export function intervaloDeRefresco({ vencido, cargaLista, intentos, normalMs, trasTopeMs = normalMs }: EntradaRefresco): number | false {
  if (vencido) return false;
  if (!cargaLista) return intentos < TOPE_SONDEOS_RAPIDOS ? REFRESCO_RAPIDO_MS : trasTopeMs;
  return normalMs;
}

/** Función para `refetchInterval`: los sondeos rápidos se cuentan con las respuestas de la propia consulta. */
function useRefresco(
  normalMs: number | false,
  trasTopeMs?: number | false,
): (consulta: { state: { dataUpdateCount: number } }, cargaLista: boolean) => number | false {
  const vencido = useTokenVencido();
  return (consulta, cargaLista) =>
    intervaloDeRefresco({ vencido, cargaLista, intentos: consulta.state.dataUpdateCount, normalMs, trasTopeMs });
}

/** `true` si no hay motivo para sondear seguido (falta el dato: se asume lista). */
const cargaDe = (yo: Yo | undefined): boolean => yo?.cargaInicialLista ?? true;

/** Los errores 4xx (sesión, token, validación) no mejoran reintentando; la red caída y los 5xx sí. */
function reintentar(fallos: number, error: Error): boolean {
  if (error instanceof ErrorApi && error.estado >= 400 && error.estado < 500) return false;
  return fallos < 2;
}

export function crearClienteConsultas(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: reintentar, staleTime: 15_000 },
      mutations: { retry: false },
    },
  });
}

async function pedirYo(): Promise<Yo> {
  const crudo = await pedir<Omit<Yo, 'fijados' | 'cargaInicialLista'> & { fijados: unknown; cargaInicialLista?: unknown }>('GET', '/api/auth/yo');
  const fijados = Array.isArray(crudo.fijados) ? crudo.fijados.filter((id): id is number => Number.isInteger(id)) : [];
  return { ...crudo, fijados, cargaInicialLista: crudo.cargaInicialLista !== false };
}

export function useYo() {
  // `yo` es quien avisa que la carga terminó: no deja de preguntar hasta verlo (salvo con el token vencido).
  const refresco = useRefresco(false, REFRESCO_ESPERA_MS);
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: CLAVES.yo,
    queryFn: pedirYo,
    staleTime: 60_000,
    refetchInterval: (q) => refresco(q, cargaDe(q.state.data)),
  });
  // Cuando la carga inicial termina, lo que se pidió vacío antes se vuelve a pedir ya, sin esperar al refresco.
  const lista = consulta.data?.cargaInicialLista;
  const antes = useRef(lista);
  useEffect(() => {
    if (antes.current === false && lista === true) {
      void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
      void cliente.invalidateQueries({ queryKey: CLAVES.catalogo });
    }
    antes.current = lista;
  }, [lista, cliente]);
  return consulta;
}

export function useCatalogo() {
  const refresco = useRefresco(false);
  const cargaLista = cargaDe(useYo().data);
  return useQuery({
    queryKey: CLAVES.catalogo,
    queryFn: () => pedir<Catalogo>('GET', '/api/catalogo'),
    staleTime: 60_000,
    refetchInterval: (consulta) => refresco(consulta, cargaLista),
  });
}

/** `true` mientras OpenProject no acepte el token; vuelve a `false` con la primera respuesta buena. */
export function useTokenVencido(): boolean {
  return useSyncExternalStore(suscribirTokenVencido, tokenVencido);
}

export function useTareas() {
  const refresco = useRefresco(REFRESCO_TAREAS_MS);
  const cargaLista = cargaDe(useYo().data);
  return useQuery({
    queryKey: CLAVES.tareas,
    queryFn: () => pedir<ListaTareas>('GET', '/api/tareas'),
    refetchInterval: (consulta) => refresco(consulta, cargaLista),
  });
}

export function useTarea(id: number) {
  return useQuery({
    queryKey: CLAVES.tarea(id),
    queryFn: () => pedir<DetalleTarea>('GET', `/api/tareas/${id}`),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export interface ListaAdjuntos { adjuntos: Adjunto[]; puedeAdjuntar: boolean; maximoBytes: number }

export function useAdjuntos(tareaId: number) {
  return useQuery({
    queryKey: CLAVES.adjuntos(tareaId),
    queryFn: () => pedir<ListaAdjuntos>('GET', `/api/tareas/${tareaId}/adjuntos`),
    enabled: Number.isInteger(tareaId) && tareaId > 0,
  });
}

export type VersionDeGestion = Version & { tareas: number; puedeCambiar: boolean; puedeBorrar: boolean };
export interface ListaVersiones { versiones: VersionDeGestion[]; puedeCrear: boolean }

export function useVersiones(proyectoId: number) {
  return useQuery({
    queryKey: CLAVES.versiones(proyectoId),
    queryFn: () => pedir<ListaVersiones>('GET', `/api/proyectos/${proyectoId}/versiones`),
    enabled: Number.isInteger(proyectoId) && proyectoId > 0,
  });
}

export type MiembroDeGestion = Miembro & { nombre: string; avatarUrl: string | null; tareasAbiertas: number };
export interface ListaMiembros {
  miembros: MiembroDeGestion[]; roles: Rol[]; candidatos: Persona[];
  puede: { agregar: boolean; cambiar: boolean; quitar: boolean };
}

export function useMiembros(proyectoId: number) {
  return useQuery({
    queryKey: CLAVES.miembros(proyectoId),
    queryFn: () => pedir<ListaMiembros>('GET', `/api/proyectos/${proyectoId}/miembros`),
    enabled: Number.isInteger(proyectoId) && proyectoId > 0,
    retry: false,
  });
}

export function useNotificaciones() {
  const vencido = useTokenVencido();
  return useQuery({
    queryKey: CLAVES.notificaciones,
    queryFn: () => pedir<Notificacion[]>('GET', '/api/notificaciones'),
    refetchInterval: vencido ? false : REFRESCO_NOTIFICACIONES_MS,
  });
}

export function useOrdenLinea() {
  const refresco = useRefresco(REFRESCO_TAREAS_MS);
  const cargaLista = cargaDe(useYo().data);
  return useQuery({
    queryKey: CLAVES.ordenLinea,
    queryFn: () => pedir<OrdenLinea>('GET', '/api/linea/orden'),
    refetchInterval: (consulta) => refresco(consulta, cargaLista),
  });
}

/** Las pausas de las tareas que se ven (viven en OpenDash; OpenProject no las tiene). */
export function usePausas() {
  const refresco = useRefresco(REFRESCO_TAREAS_MS);
  const cargaLista = cargaDe(useYo().data);
  return useQuery({
    queryKey: CLAVES.pausas,
    queryFn: () => pedir<PausasPorTarea>('GET', '/api/pausas'),
    refetchInterval: (consulta) => refresco(consulta, cargaLista),
  });
}

export function useAjustes() {
  return useQuery({
    queryKey: CLAVES.ajustes,
    queryFn: () => pedir<Ajustes>('GET', '/api/ajustes'),
    staleTime: 60_000,
  });
}

export function useFeriados() {
  return useQuery({
    queryKey: CLAVES.feriados,
    queryFn: () => pedir<ListaFeriados>('GET', '/api/feriados'),
    staleTime: 60 * 60_000,
  });
}

/** Mis vacaciones que todavía no terminaron; con `desde`, las que terminan ese día o después. */
export function useVacaciones(desde?: string) {
  return useQuery({
    queryKey: desde === undefined ? CLAVES.vacaciones : CLAVES.vacacionesDesde(desde),
    queryFn: () => pedir<Vacaciones[]>('GET', desde === undefined ? '/api/cuenta/vacaciones' : `/api/cuenta/vacaciones?desde=${desde}`),
  });
}

/** Mis reuniones de `desde` a `hasta` (ambos incluidos, hasta 62 días). `activa: false` no pide nada; `mantenerAnterior` deja lo del rango anterior mientras llega el nuevo; `enSegundoPlano` sigue pidiendo con la pestaña oculta y con el token de OpenProject vencido (el calendario no lo usa). */
export function useCalendario(desde: string, hasta: string, activa = true, mantenerAnterior = false, enSegundoPlano = false) {
  const vencido = useTokenVencido();
  return useQuery({
    queryKey: enSegundoPlano ? CLAVES.calendarioFondo(desde, hasta) : CLAVES.calendario(desde, hasta),
    queryFn: () => pedir<CalendarioPropio>('GET', `/api/calendario?desde=${desde}&hasta=${hasta}`, undefined, { fondo: enSegundoPlano }),
    enabled: activa,
    placeholderData: mantenerAnterior ? keepPreviousData : undefined,
    refetchInterval: vencido && !enSegundoPlano ? false : REFRESCO_CALENDARIO_MS,
    refetchIntervalInBackground: enSegundoPlano,
  });
}

export function useEquipo() {
  const vencido = useTokenVencido();
  return useQuery({
    queryKey: CLAVES.equipo,
    queryFn: () => pedir<MiembroEquipo[]>('GET', '/api/equipo'),
    refetchInterval: vencido ? false : REFRESCO_PRESENCIA_MS,
  });
}

export function useHoras() {
  const vencido = useTokenVencido();
  return useQuery({
    queryKey: CLAVES.horas,
    queryFn: () => pedir<EstadoHoras>('GET', '/api/horas'),
    refetchInterval: vencido ? false : REFRESCO_PRESENCIA_MS,
    refetchOnWindowFocus: true,
  });
}

export function useHorasEquipo(dias: number) {
  const vencido = useTokenVencido();
  return useQuery({
    queryKey: CLAVES.horasEquipo(dias),
    queryFn: () => pedir<HorasEquipo>('GET', `/api/horas/equipo?dias=${dias}`),
    refetchInterval: vencido ? false : REFRESCO_HORAS_MS,
  });
}

/** Todos los avisos de problemas; solo se piden (`habilitada`) si la persona los recibe. */
export function useTodosLosAvisos(habilitada: boolean) {
  const vencido = useTokenVencido();
  return useQuery({
    queryKey: CLAVES.avisosTodos,
    queryFn: () => pedir<AvisoProblema[]>('GET', '/api/avisos-problema'),
    enabled: habilitada,
    refetchInterval: vencido ? false : REFRESCO_NOTIFICACIONES_MS,
  });
}

/** `true` si la última respuesta de alguna consulta vino de la caché sin poder hablar con OpenProject. */
export function useDesactualizado(): boolean {
  return useSyncExternalStore(suscribirFrescura, hayDesactualizados);
}

/** Qué se pierde al borrar la tarea y si la persona puede hacerlo; no se pide hasta que haya un detalle abierto. */
export function useResumenBorrado(tareaId: number) {
  return useQuery({
    queryKey: CLAVES.borrado(tareaId),
    queryFn: () => pedir<ResumenBorrado>('GET', `/api/tareas/${tareaId}/borrado`),
    enabled: Number.isInteger(tareaId) && tareaId > 0,
    retry: false,
  });
}

/** Solo si la persona puede borrar la tarea (para mostrar el «⋯»): el servidor no cuenta adjuntos ni descendientes. */
export function usePermisoBorrado(tareaId: number) {
  return useQuery({
    queryKey: CLAVES.permisoBorrado(tareaId),
    queryFn: () => pedir<ResumenBorrado>('GET', `/api/tareas/${tareaId}/borrado?sinAdjuntos=1`),
    enabled: Number.isInteger(tareaId) && tareaId > 0,
    retry: false,
  });
}

export interface OpcionesNuevoProyecto { vacio: boolean; plantillas: { id: number; nombre: string }[] }
export interface EstadoNuevoProyecto { paso: 'creando' | 'copiando' | 'listo' | 'fallo'; proyectoId: number | null; noCopiado: string[]; mensaje: string | null }

/** Qué puede crear la persona; si falla o no hay nada, la pantalla no muestra el botón. */
export function useOpcionesNuevoProyecto() {
  return useQuery({
    queryKey: ['proyecto-nuevo-opciones'],
    queryFn: () => pedir<OpcionesNuevoProyecto>('GET', '/api/proyectos/nuevo'),
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Consulta el trabajo cada segundo hasta que termina. Un pedido perdido se reintenta (como el resto de la app) y,
 * si igual se corta, `refetch` retoma el seguimiento; solo un 404 del trabajo lo da por perdido.
 */
export function useTrabajoNuevoProyecto(trabajo: string | null) {
  return useQuery({
    queryKey: ['proyecto-nuevo', trabajo],
    queryFn: () => pedir<EstadoNuevoProyecto>('GET', `/api/proyectos/nuevo/${trabajo}`),
    enabled: trabajo !== null,
    gcTime: 0,
    refetchInterval: (consulta) => {
      const paso = consulta.state.data?.paso;
      return paso === 'listo' || paso === 'fallo' || consulta.state.error ? false : 1000;
    },
  });
}
