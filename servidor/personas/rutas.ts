import type { FastifyInstance } from 'fastify';
import { falla } from '../../compartido/api.js';
import type { DepsApp } from '../app.js';
import { clientePara } from '../auth/clientes.js';
import { requerirSesion } from '../auth/rutas.js';
import { responderError, responderTokenVencido } from '../errores.js';
import { PATRON_ID } from '../identificadores.js';

// SVG queda afuera: puede llevar scripts.
const TIPOS_DE_AVATAR = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

type DepsPersonas = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'registro'>;

export function registrarRutasPersonas(app: FastifyInstance, deps: DepsPersonas): void {
  const sesion = requerirSesion(deps);

  // El navegador nunca habla con OpenProject: el avatar pasa por acá, con el token de quien lo pide.
  app.get('/api/personas/:id/avatar', { preHandler: sesion }, async (req, res) => {
    const crudo = (req.params as { id: string }).id;
    if (!PATRON_ID.test(crudo)) return res.code(400).send(falla('validacion', 'El identificador no es válido'));
    const usuarioId = req.usuario!.id;
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);

    let avatar;
    try {
      avatar = await cliente.avatar(Number(crudo));
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
    if (avatar === null || !TIPOS_DE_AVATAR.has(avatar.tipo)) {
      return res.code(404).send(falla('no-encontrado', 'Esta persona no tiene avatar'));
    }
    return res
      .header('content-type', avatar.tipo)
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      // Un SVG abierto directo no puede correr código en el origen de OpenDash.
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .send(avatar.datos);
  });
}
