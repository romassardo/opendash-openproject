import type { Miembro } from '../../compartido/tipos.js';
import type { ClienteOp } from './cliente.js';
import { ErrorOp } from './errores.js';
import { aMiembro, aRol, idDeHref } from './mapeo.js';
import { href, personasDe, type ContextoOp } from './base.js';

/** Capacidades de la persona y miembros del proyecto. */
export function crearMiembrosOp(ctx: ContextoOp): Pick<ClienteOp, 'capacidades' | 'puedeCrearProyectos' | 'miembros' | 'rolesDeProyecto' | 'candidatos' | 'agregarMiembro' | 'cambiarRol' | 'quitarMiembro' | 'membresia'> {
  const { pedir, todos } = ctx;
  /** Ids de las capacidades que la persona tiene en un contexto (`p<proyecto>` o `g`). */
  async function idsDeCapacidades(usuarioId: number, contexto: string): Promise<Set<string>> {
    const filtros = JSON.stringify([
      { principal: { operator: '=', values: [String(usuarioId)] } },
      { context: { operator: '=', values: [contexto] } },
    ]);
    const ids = (await todos('/api/v3/capabilities', { filters: filtros })).map((c) => (c as { id?: unknown } | null)?.id);
    return new Set(ids.filter((id): id is string => typeof id === 'string'));
  }

  const comoMiembro = (hal: unknown): Miembro => {
    const miembro = aMiembro(hal);
    if (miembro === null) throw new ErrorOp('validacion', 'OpenProject devolvió una membresía que no es de una persona');
    return miembro;
  };


  return {
    async capacidades(usuarioId, proyectoId) {
      const ids = await idsDeCapacidades(usuarioId, `p${proyectoId}`);
      // Desde que OpenProject pasó a «workspaces» los ids vienen como `…/w<proyecto>-<persona>` aunque se filtre por `p<proyecto>`.
      const tiene = (accion: string) => ids.has(`${accion}/p${proyectoId}-${usuarioId}`) || ids.has(`${accion}/w${proyectoId}-${usuarioId}`);
      return {
        crearMiembro: tiene('memberships/create'),
        cambiarMiembro: tiene('memberships/update'),
        quitarMiembro: tiene('memberships/destroy'),
        copiarProyecto: tiene('projects/copy'),
      };
    },

    async puedeCrearProyectos(usuarioId) {
      if ((await idsDeCapacidades(usuarioId, 'g')).has(`projects/create/g-${usuarioId}`)) return true;
      // El permiso dado al «Standard global role» (el que tienen todos) no figura en capabilities: se le pregunta al
      // formulario de alta, que valida sin guardar. Sin permiso responde 403 o un error en `base`.
      try {
        const formulario = (await pedir('POST', '/api/v3/projects/form', { name: 'OpenDash' }, true)) as {
          _embedded?: { validationErrors?: Record<string, unknown> };
        } | null;
        return !('base' in (formulario?._embedded?.validationErrors ?? {}));
      } catch (e) {
        if (e instanceof ErrorOp && e.tipo === 'prohibido') return false;
        throw e;
      }
    },

    async miembros(proyectoId) {
      const filtros = JSON.stringify([{ project: { operator: '=', values: [String(proyectoId)] } }]);
      return (await todos('/api/v3/memberships', { filters: filtros })).map(aMiembro).filter((m): m is Miembro => m !== null);
    },

    async rolesDeProyecto() {
      const filtros = JSON.stringify([{ unit: { operator: '=', values: ['project'] } }]);
      return (await todos('/api/v3/roles', { filters: filtros })).map(aRol);
    },

    async candidatos(proyectoId) {
      const filtros = JSON.stringify([
        { status: { operator: '=', values: ['1'] } },   // 1 = activo
        { type: { operator: '=', values: ['User'] } },
        { member: { operator: '!', values: [String(proyectoId)] } },
      ]);
      return personasDe(await todos('/api/v3/principals', { filters: filtros }));
    },

    async agregarMiembro(proyectoId, personaId, rolId) {
      return comoMiembro(await pedir('POST', '/api/v3/memberships', {
        // OpenProject 16 no reconoce un `sendNotification` suelto: el aviso por correo se apaga desde `_meta`.
        _meta: { sendNotifications: false },
        _links: { project: href('projects', proyectoId), principal: href('users', personaId), roles: [href('roles', rolId)] },
      }));
    },

    async cambiarRol(miembroId, rolId) {
      return comoMiembro(await pedir('PATCH', `/api/v3/memberships/${miembroId}`, { _links: { roles: [href('roles', rolId)] } }));
    },

    async quitarMiembro(miembroId) {
      await pedir('DELETE', `/api/v3/memberships/${miembroId}`);
    },

    async membresia(miembroId) {
      const hal = await pedir('GET', `/api/v3/memberships/${miembroId}`);
      const proyectoId = idDeHref((hal as { _links?: { project?: { href?: string } } })._links?.project?.href);
      if (proyectoId === null) throw new ErrorOp('validacion', 'OpenProject devolvió una membresía sin proyecto');
      return { ...comoMiembro(hal), proyectoId };
    },
  };
}
