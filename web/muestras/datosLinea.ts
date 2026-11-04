import type { Catalogo, Dependencia, Tarea } from '../../compartido/tipos.js';
import type { Tramo } from '../linea/ausencias.js';
import { armarFilas, type OpcionesFilas } from '../linea/filas.js';
import { ventanaDesde } from '../linea/modelo.js';

// Datos de ejemplo del boceto de la línea de tiempo (opción A), solo para /muestras.
export const HOY_LINEA = '2026-10-19';

const persona = (id: number, nombre: string) => ({ id, nombre, login: null, email: null, avatarUrl: null });
const proyecto = (id: number, nombre: string) => ({ id, nombre, identificador: `p${id}`, activo: true, estadoOp: null, estadoOpClave: null, descripcion: '' });

export const CATALOGO_LINEA: Catalogo = {
  estados: [
    { id: 1, nombre: 'New', cerrado: false, color: '#1a67a3' },
    { id: 7, nombre: 'In progress', cerrado: false, color: '#cc5de8' },
    { id: 4, nombre: 'On hold', cerrado: false, color: '#f08c00' },
    { id: 12, nombre: 'Closed', cerrado: true, color: '#868e96' },
  ],
  tipos: [
    { id: 1, nombre: 'Task', esHito: false, color: '#1a67a3' },
    { id: 2, nombre: 'Milestone', esHito: true, color: '#35c53f' },
  ],
  prioridades: [{ id: 8, nombre: 'Normal', alta: false, nivel: 'normal' }],
  proyectos: [proyecto(1, 'Intranet'), proyecto(2, 'Funcional'), proyecto(3, 'Billetera')],
  versiones: [],
  personas: [persona(1, 'Gianfranco Rossi'), persona(2, 'Ana Pereyra'), persona(3, 'Pablo Núñez'), persona(4, 'Sebastián Lugo'), persona(5, 'Daniel Ruiz'), persona(6, 'Ramiro Medina')],
  asignables: {},
  semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [], plantillas: [],
  tablero: { nuevo: null, curso: null, pausa: null, cerrado: null },
};

function tarea(id: number, proyectoId: number, titulo: string, inicio: string, fin: string, estadoId: number, responsableId: number | null, extra: Partial<Tarea> = {}): Tarea {
  return {
    id, lockVersion: 1, titulo, descripcion: '', proyectoId, tipoId: 1, estadoId, prioridadId: 8, responsableId, autorId: null,
    inicio, fin, estimacionHoras: null, horasReales: null, restanteHoras: null, porcentaje: null, madreId: null, versionId: null, programacionManual: true,
    creada: '2026-10-01T10:00:00Z', actualizada: '2026-10-10T10:00:00Z', cerradaEl: null, comentarios: null, ...extra,
  };
}

export const TAREAS_LINEA: Tarea[] = [
  tarea(1, 1, 'Relevamiento de reportes', '2026-10-13', '2026-10-19', 12, 1, { horasReales: 14 }),
  tarea(2, 1, 'Módulo de cobranzas', '2026-10-20', '2026-11-03', 7, 2, { estimacionHoras: 24 }),
  tarea(3, 1, 'Pruebas con usuarios', '2026-11-04', '2026-11-10', 1, 3),
  tarea(4, 1, 'Salida a producción', '2026-11-12', '2026-11-12', 1, null, { tipoId: 2 }),
  tarea(5, 2, 'Casos de uso auditoría', '2026-10-14', '2026-10-24', 7, 4),
  tarea(6, 2, 'Derivaciones Q4', '2026-10-27', '2026-11-07', 1, 5),
  tarea(7, 3, 'Integración API banco', '2026-10-15', '2026-10-30', 4, 6),
  // Empieza antes de que termine la integración: dependencia en conflicto.
  tarea(8, 3, 'Validación de cuentas', '2026-10-28', '2026-11-06', 1, 1),
  tarea(9, 3, 'Documentación', '2026-11-02', '2026-11-13', 1, 2),
  // Subtareas de «Módulo de cobranzas» para el 3/5 de la barra.
  tarea(10, 1, 'Pantalla de deudas', '2026-10-20', '2026-10-22', 12, 2, { madreId: 2 }),
  tarea(11, 1, 'Cálculo de intereses', '2026-10-22', '2026-10-26', 12, 2, { madreId: 2 }),
  tarea(12, 1, 'Envío de avisos', '2026-10-26', '2026-10-28', 12, 2, { madreId: 2 }),
  tarea(13, 1, 'Reporte mensual', '2026-10-28', '2026-10-30', 1, 2, { madreId: 2 }),
  tarea(14, 1, 'Permisos por rol', '2026-10-30', '2026-11-03', 1, 2, { madreId: 2 }),
];

export const DEPENDENCIAS_LINEA: Dependencia[] = [
  { id: 1, predecesoraId: 1, sucesoraId: 2, lag: 0 },
  { id: 2, predecesoraId: 2, sucesoraId: 3, lag: 0 },
  { id: 3, predecesoraId: 3, sucesoraId: 4, lag: 0 },
  { id: 4, predecesoraId: 5, sucesoraId: 6, lag: 0 },
  { id: 5, predecesoraId: 7, sucesoraId: 8, lag: 0 },
];

const OPCIONES: OpcionesFilas = { vista: 'proyecto', soloConDependencias: false, proyectoId: null, personaId: null, plegados: new Set(), orden: {}, yoId: null, terminadasVisibles: new Set() };
export const VENTANA_LINEA = ventanaDesde('2026-10-12', 'mes', 1000);
export const FILAS_LINEA = armarFilas(TAREAS_LINEA, DEPENDENCIAS_LINEA, CATALOGO_LINEA, VENTANA_LINEA, OPCIONES);
export const FERIADOS_LINEA = new Map([['2026-10-12', 'Día de la Diversidad Cultural']]);
export const VACACIONES_LINEA = new Map<number, Tramo[]>([[2, [{ desde: '2026-10-26', hasta: '2026-10-28' }]]]);
