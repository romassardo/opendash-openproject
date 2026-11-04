import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import type { Notificacion } from '../../compartido/tipos.js';
import type { DepsApp } from '../app.js';
import { clientePara } from '../auth/clientes.js';
import { requerirSesion } from '../auth/rutas.js';
import { responderError, responderTokenVencido } from '../errores.js';
import { PATRON_ID } from '../identificadores.js';
import type { ClienteOp } from '../openproject/cliente.js';

type DepsNotificaciones = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'registro'>;

const MAXIMO = 50;

// Mismo tope que PATRON_ID (10 dígitos); sin repetidos para no pedir dos veces lo mismo.
const esquemaLeidas = z.strictObject({
  ids: z.array(z.number().int().min(1).max(9_999_999_999)).min(1).max(MAXIMO)
    .refine((ids) => new Set(ids).size === ids.length),
});

// No leídas primero; dentro de cada grupo, la más nueva arriba.
function ordenar(lista: readonly Notificacion[]): Notificacion[] {
  return [...lista]
    .sort((a, b) => Number(a.leida) - Number(b.leida) || Date.parse(b.creada) - Date.parse(a.creada))
    .slice(0, MAXIMO);
}

export function registrarRutasNotificaciones(app: FastifyInstance, deps: DepsNotificaciones): void {
  const sesion = requerirSesion(deps);

  // Cliente con el token de quien actúa, o null tras responder 401.
  const clienteDe = (req: FastifyRequest, res: FastifyReply): ClienteOp | null => {
    const cliente = clientePara(deps, req.usuario!.id);
    if (cliente === null) responderTokenVencido(res);
    return cliente;
  };

  // Siempre en vivo y con el token de cada persona: no pasan por la caché.
  app.get('/api/notificaciones', { preHandler: sesion }, async (req, res) => {
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    try {
      return exito(ordenar(await cliente.notificaciones()), false);
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId: req.usuario!.id });
    }
  });

  app.post('/api/notificaciones/:id/leida', { preHandler: sesion }, async (req, res) => {
    const crudo = (req.params as { id: string }).id;
    if (!PATRON_ID.test(crudo)) return res.code(400).send(falla('validacion', 'El identificador no es válido'));
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    try {
      await cliente.marcarLeida(Number(crudo));
      return exito(null, false);
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId: req.usuario!.id });
    }
  });

  // Todas de una vez: un solo pedido del navegador. `fallidas` son los ids que no se pudieron marcar.
  app.post('/api/notificaciones/leidas', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaLeidas.safeParse(req.body);
    if (!cuerpo.success) return res.code(400).send(falla('validacion', 'Los identificadores no son válidos'));
    const cliente = clienteDe(req, res);
    if (cliente === null) return res;
    try {
      const fallidas = await cliente.marcarLeidas(cuerpo.data.ids);
      return exito({ fallidas }, false);
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId: req.usuario!.id });
    }
  });
}
