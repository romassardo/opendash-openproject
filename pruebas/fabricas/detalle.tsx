import { render, screen, within } from '@testing-library/react';
import type { Actividad, Dependencia, Tarea } from '../../compartido/tipos.js';
import { App } from '../../web/App.js';
import { tareaDe } from './sync.js';
import { falla, ok, prepararEntorno, simularApi, TAREAS, type Llamada, type Manejador, type RespuestaSimulada } from './web.js';

// Datos y servidor simulado para las pruebas del panel de detalle de una tarea.

export const HORA = 3_600_000;
export const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

export const CONCILIACION = tareaDe(8, {
  titulo: 'Conciliación bancaria', lockVersion: 4, responsableId: 9, prioridadId: 8,
  inicio: '2026-10-20', fin: '2026-10-30', estimacionHoras: 6, descripcion: 'Revisar **todos** los extractos',
});
export const BANCO = tareaDe(7, { titulo: 'Integración API banco', proyectoId: 12, estadoId: 7 });
export const EXTRACTOS = tareaDe(21, { titulo: 'Cargar extractos', madreId: 8, responsableId: 5 });
export const LISTA: Tarea[] = [...TAREAS.filter((t) => t.id !== 7 && t.id !== 8), BANCO, CONCILIACION, EXTRACTOS];
// 8 espera a T3; T2 espera a 8 y T5 espera a T2 (las dos son sucesoras de 8).
export const DEPENDENCIAS: Dependencia[] = [
  { id: 50, sucesoraId: 8, predecesoraId: 3, lag: 0 },
  { id: 51, sucesoraId: 2, predecesoraId: 8, lag: 0 },
  { id: 52, sucesoraId: 5, predecesoraId: 2, lag: 0 },
];

export const ACTIVIDADES: Actividad[] = [
  { id: 1, creada: hace(72 * HORA), autorId: 5, comentario: '', detalles: ['Status changed from New to In progress', 'Assignee set to Ana Pereyra'] },
  { id: 2, creada: hace(26 * HORA), autorId: 5, comentario: '¿Lo vemos **mañana**? <img src=x onerror="window.__xss=1">', detalles: [] },
  {
    id: 3, creada: hace(2 * HORA), autorId: 9, comentario: '',
    detalles: ['Finish date changed from 10/28/2026 to 10/30/2026', 'Estimated time set to 6 h', '<b>Priority</b> changed', 'Subject changed'],
  },
];

/** OpenProject simulado: GET y PATCH de las tareas 1, 8 y 21, con lockVersion e historial de verdad. */
export interface ServidorSimulado {
  tareas: Map<number, Tarea>;
  actividades: Map<number, Actividad[]>;
  /** Respuesta para el próximo PATCH (por ejemplo un 422), en lugar de guardar. */
  siguienteFalla: RespuestaSimulada | null;
}

export interface ApiDetalle {
  llamadas: Llamada[];
  servidor: ServidorSimulado;
}

const CONFLICTO = 'Alguien modificó la tarea antes que vos';

/** Abre `ruta` con la API simulada; `rutas` pisa a las de base (y al servidor con estado). */
export function abrirDetalle(ruta: string, rutas: Record<string, Manejador> = {}): ApiDetalle {
  prepararEntorno(ruta);
  const servidor: ServidorSimulado = {
    tareas: new Map([[1, { ...TAREAS[0]!, lockVersion: 3 }], [8, CONCILIACION], [21, EXTRACTOS]]),
    actividades: new Map([[1, []], [8, [...ACTIVIDADES]], [21, []]]),
    siguienteFalla: null,
  };
  let siguienteActividad = 900;
  const leer = (id: number): Manejador => () => ok({ tarea: servidor.tareas.get(id), actividades: servidor.actividades.get(id) ?? [] });
  const escribir = (id: number): Manejador => (cuerpo) => {
    if (servidor.siguienteFalla) {
      const respuesta = servidor.siguienteFalla;
      servidor.siguienteFalla = null;
      return respuesta;
    }
    const { lockVersion, cambios } = cuerpo as { lockVersion: number; cambios: Partial<Tarea> };
    const actual = servidor.tareas.get(id)!;
    if (lockVersion !== actual.lockVersion) return falla(409, 'conflicto', CONFLICTO);
    const nueva = { ...actual, ...cambios, lockVersion: lockVersion + 1 };
    servidor.tareas.set(id, nueva);
    const cambio: Actividad = {
      id: siguienteActividad++, creada: new Date().toISOString(), autorId: 9, comentario: '',
      detalles: Object.keys(cambios).map((clave) => `Cambió ${clave}`),
    };
    servidor.actividades.set(id, [...(servidor.actividades.get(id) ?? []), cambio]);
    return ok(nueva);
  };
  const api = simularApi({
    'GET /api/tareas': ok({ tareas: LISTA, dependencias: DEPENDENCIAS }),
    ...Object.fromEntries([1, 8, 21].flatMap((id) => [[`GET /api/tareas/${id}`, leer(id)], [`PATCH /api/tareas/${id}`, escribir(id)]])),
    ...rutas,
  });
  render(<App />);
  return { llamadas: api.llamadas, servidor };
}

export const patches = (api: ApiDetalle) => api.llamadas.filter((l) => l.metodo === 'PATCH').map((l) => l.cuerpo);
export const lecturas = (api: ApiDetalle, ruta: string) => api.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === ruta).length;
export const panel = (nombre = 'Conciliación bancaria') => screen.findByRole('dialog', { name: nombre });
/** Espera a que el panel tenga los datos de la lista (subtareas, «Espera a…»). */
export const conLista = async (dialogo: HTMLElement) => within(dialogo).findByRole('list', { name: 'Subtareas' });
