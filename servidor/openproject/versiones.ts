import type { ClienteOp } from './cliente.js';
import { ErrorOp } from './errores.js';
import { aVersion, ESTADO_OP_DE_VERSION } from './mapeo.js';
import { href, idNumericoDe, tieneEnlace, type ContextoOp } from './base.js';

/** Versiones del proyecto. */
export function crearVersionesOp(ctx: ContextoOp): Pick<ClienteOp, 'versiones' | 'puedeCrearVersion' | 'crearVersion' | 'cambiarVersion' | 'borrarVersion'> {
  const { pedir, todos } = ctx;

  return {
    async versiones(proyectoId) {
      return (await todos(`/api/v3/projects/${proyectoId}/versions`)).map((hal) => ({
        ...aVersion(hal, proyectoId),
        puedeCambiar: tieneEnlace(hal, 'updateImmediately') || tieneEnlace(hal, 'update'),
        puedeBorrar: tieneEnlace(hal, 'delete'),
      }));
    },

    async puedeCrearVersion(proyectoId) {
      try {
        return (await todos('/api/v3/versions/available_projects')).some((p) => idNumericoDe(p) === proyectoId);
      } catch (error) {
        if (error instanceof ErrorOp && error.tipo === 'prohibido') return false;
        throw error;
      }
    },

    async crearVersion(proyectoId, datos) {
      return aVersion(await pedir('POST', '/api/v3/versions', {
        name: datos.nombre, startDate: datos.inicio, endDate: datos.fin,
        _links: { definingProject: href('projects', proyectoId) },
      }), proyectoId);
    },

    async cambiarVersion(id, cambios, proyectoId) {
      const cuerpo: Record<string, unknown> = {};
      if (cambios.nombre !== undefined) cuerpo.name = cambios.nombre;
      if (cambios.inicio !== undefined) cuerpo.startDate = cambios.inicio;
      if (cambios.fin !== undefined) cuerpo.endDate = cambios.fin;
      if (cambios.estado !== undefined) cuerpo.status = ESTADO_OP_DE_VERSION[cambios.estado];
      return aVersion(await pedir('PATCH', `/api/v3/versions/${id}`, cuerpo), proyectoId);
    },

    async borrarVersion(id) {
      await pedir('DELETE', `/api/v3/versions/${id}`);
    },
  };
}
