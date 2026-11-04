import { vi } from 'vitest';
import type { CodigoError, Respuesta } from '../../compartido/api.js';
import type { Ajustes, Catalogo, Notificacion, Tarea, Yo } from '../../compartido/tipos.js';
import { olvidarEstadoDeSesion } from '../../web/api/cliente.js';
import { tareaDe } from './sync.js';

// API simulada para las pruebas de la web: responde con el sobre de compartido/api.ts.

export interface RespuestaSimulada { estado: number; cuerpo: Respuesta<unknown> }
export type Manejador = RespuestaSimulada | ((cuerpo: unknown) => RespuestaSimulada);
export interface Llamada { metodo: string; ruta: string; cuerpo: unknown }
/** Cabeceras de cada pedido, aparte de `llamadas` para no romper las comparaciones exactas. */
export interface PedidoConCabeceras { ruta: string; cabeceras: Record<string, string> }

export const ok = (datos: unknown, desactualizado = false): RespuestaSimulada => ({
  estado: 200,
  cuerpo: { ok: true, datos, desactualizado },
});

export const falla = (estado: number, codigo: CodigoError, mensaje: string): RespuestaSimulada => ({
  estado,
  cuerpo: { ok: false, codigo, mensaje },
});

export const YO: Yo = {
  id: 9, login: 'apereyra', nombre: 'Ana Pereyra', tema: 'oscuro', fijados: [11], cargaInicialLista: true,
  rol: '', capacidadHoras: 40, variasALaVez: false, recibeAvisos: false, avisoReunionMin: 5, tieneCalendario: false, calendario: null,
};

export const CATALOGO: Catalogo = {
  estados: [
    { id: 1, nombre: 'New', cerrado: false, color: '#1a67a3' },
    { id: 7, nombre: 'In progress', cerrado: false, color: '#cc5de8' },
    { id: 4, nombre: 'On hold', cerrado: false, color: '#f08c00' },
    { id: 12, nombre: 'Closed', cerrado: true, color: '#868e96' },
    { id: 14, nombre: 'Rejected', cerrado: true, color: '#e03131' },
  ],
  tipos: [
    { id: 1, nombre: 'Task', esHito: false, color: '#1a67a3' },
    { id: 2, nombre: 'Milestone', esHito: true, color: '#35c53f' },
    { id: 3, nombre: 'Summary task', esHito: false, color: '#ff922b' },
  ],
  prioridades: [{ id: 8, nombre: 'Normal', alta: false, nivel: 'normal' }, { id: 9, nombre: 'High', alta: true, nivel: 'alta' }],
  proyectos: [
    { id: 11, nombre: 'Portal de clientes', identificador: 'portal', activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' },
    { id: 12, nombre: 'Migración del ERP', identificador: 'erp', activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' },
  ],
  versiones: [],
  personas: [
    { id: 9, nombre: 'Ana Pereyra', login: 'apereyra', email: null, avatarUrl: null },
    { id: 5, nombre: 'Martín Gómez', login: 'mgomez', email: null, avatarUrl: null },
  ],
  asignables: { 11: [9, 5], 12: [9, 5] },
  semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [], plantillas: [],
  tablero: { nuevo: null, curso: null, pausa: null, cerrado: null },
};

// 7 abiertas mías que no son hito, más las que no cuentan: cerradas, rechazadas, hitos, ajenas y sin asignar.
export const TAREAS: Tarea[] = [
  tareaDe(1, { responsableId: 9, estadoId: 1 }),
  tareaDe(2, { responsableId: 9, estadoId: 7 }),
  tareaDe(3, { responsableId: 9, estadoId: 4 }),
  tareaDe(4, { responsableId: 9, estadoId: 1, tipoId: 3 }),
  tareaDe(5, { responsableId: 9, estadoId: 7, proyectoId: 12 }),
  tareaDe(6, { responsableId: 9, estadoId: 1, proyectoId: 12 }),
  tareaDe(7, { responsableId: 9, estadoId: 4, proyectoId: 12 }),
  tareaDe(8, { responsableId: 9, estadoId: 12 }),
  tareaDe(9, { responsableId: 9, estadoId: 14 }),
  tareaDe(10, { responsableId: 9, estadoId: 1, tipoId: 2 }),
  tareaDe(11, { responsableId: 5, estadoId: 1 }),
  tareaDe(12, { responsableId: null, estadoId: 7 }),
];

export const NOTIFICACIONES: Notificacion[] = [
  { id: 1, leida: false, motivo: 'mentioned', tareaId: 2, titulo: 'T2', creada: '2026-10-19T12:00:00Z', actorId: 5 },
];

export const AJUSTES: Ajustes = {
  estilos: { 11: { color: 'azul', icono: 'carpeta' }, 12: { color: 'violeta', icono: 'carpeta' } },
  metricas: { horasPorDefecto: 4, horasSemanaLargas: 4, capacidadPorDefecto: 40, restarReuniones: false },
  horas: { jornadaHoras: 8 },
  avisos: { receptores: [] },
};

const RUTAS_BASE: Record<string, Manejador> = {
  'GET /api/auth/yo': ok(YO),
  'GET /api/catalogo': ok(CATALOGO),
  'GET /api/tareas': ok({ tareas: TAREAS, dependencias: [] }),
  'GET /api/notificaciones': ok(NOTIFICACIONES),
  'POST /api/auth/salir': ok({}),
  'GET /api/ajustes': ok(AJUSTES),
  'GET /api/equipo': ok([]),
  'GET /api/horas': ok({ enMarcha: [], hoy: [], avisos: [], totalHoySegundos: 0, jornadaSegundos: 28800, variasALaVez: false, horasExtra: false, ultimoDia: null }),
  'GET /api/horas/equipo': ok({ dias: [], enMarcha: [] }),
  'GET /api/feriados': ok({ feriados: [], actualizado: null }),
  'GET /api/cuenta/vacaciones': ok([]),
  'GET /api/calendario': ok({ reuniones: [], estado: null, ventana: null }),
  'GET /api/pausas': ok({}),
};

/** Lo que responde la lista de adjuntos si la prueba no dice otra cosa: ninguno y sin permiso para adjuntar. */
const ADJUNTOS_VACIOS = ok({ adjuntos: [], puedeAdjuntar: false, maximoBytes: 5_242_880 });

/** Reemplaza `fetch` por un servidor simulado; las rutas dadas pisan a las de base. */
export function simularApi(rutas: Record<string, Manejador> = {}): { llamadas: Llamada[]; pedidos: PedidoConCabeceras[]; rutas: Record<string, Manejador> } {
  const tabla: Record<string, Manejador> = { ...RUTAS_BASE, ...rutas };
  const llamadas: Llamada[] = [];
  const pedidos: PedidoConCabeceras[] = [];
  vi.stubGlobal('fetch', vi.fn(async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(entrada), 'http://localhost');
    const metodo = (init.method ?? 'GET').toUpperCase();
    const cuerpo = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    llamadas.push({ metodo, ruta: url.pathname, cuerpo });
    pedidos.push({ ruta: url.pathname, cabeceras: Object.fromEntries(new Headers(init.headers).entries()) });
    const manejador = tabla[`${metodo} ${url.pathname}`]
      ?? (metodo === 'GET' && /^\/api\/tareas\/\d+\/adjuntos$/.test(url.pathname) ? ADJUNTOS_VACIOS : undefined);
    const respuesta = manejador === undefined
      ? falla(404, 'no-encontrado', `Ruta no simulada: ${metodo} ${url.pathname}`)
      : typeof manejador === 'function' ? manejador(cuerpo) : manejador;
    return new Response(respuesta.estado === 204 ? null : JSON.stringify(respuesta.cuerpo), {
      status: respuesta.estado,
      headers: { 'content-type': 'application/json' },
    });
  }));
  return { llamadas, pedidos, rutas: tabla };
}

const matchMediaOriginal = window.matchMedia;

/** Ruta inicial, sin animaciones (movimiento reducido) y sin tema guardado. */
export function prepararEntorno(ruta: string): void {
  window.history.replaceState({}, '', ruta);
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as typeof window.matchMedia;
  localStorage.clear();
  delete document.documentElement.dataset.tema;
}

export function limpiarEntorno(): void {
  window.matchMedia = matchMediaOriginal;
  vi.unstubAllGlobals();
  olvidarEstadoDeSesion();
  localStorage.clear();
  delete document.documentElement.dataset.tema;
}
