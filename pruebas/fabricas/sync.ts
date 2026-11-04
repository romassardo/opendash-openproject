import type { Tarea } from '../../compartido/tipos.js';
import type { ServicioSync } from '../../servidor/sync/servicio.js';

// Fábrica de tareas para las pruebas de la caché y del servicio de sincronización.
export function tareaDe(id: number, extra: Partial<Tarea> = {}): Tarea {
  return {
    id, lockVersion: 1, titulo: `T${id}`, descripcion: '', proyectoId: 11, tipoId: 1, estadoId: 1, prioridadId: 1,
    responsableId: null, autorId: null, inicio: null, fin: null, estimacionHoras: null, horasReales: null, restanteHoras: null, porcentaje: null,
    madreId: null, versionId: null, programacionManual: true,
    creada: '2026-10-01T10:00:00Z', actualizada: '2026-10-10T10:00:00Z', cerradaEl: null, comentarios: null, ...extra,
  };
}

// Servicio de sincronización inerte para las pruebas de rutas.
export function syncFalso(cargaCompleta: (usuarioId: number) => Promise<void> = async () => {}): ServicioSync {
  return {
    cargaCompleta,
    refrescoIncremental: async () => {},
    releerAsignables: async () => {},
    iniciar: () => {},
    detener: () => {},
    estado: () => ({ desactualizado: false, ultimoRefresco: null }),
  };
}
