import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import { PATRON_CONTENEDOR, proyectoDeContenedor } from '../../compartido/linea.js';
import type { DepsApp } from '../app.js';
import { requerirSesion } from '../auth/rutas.js';
import { crearCache } from '../sync/cache.js';
import { guardarOrden, leerOrden } from './repositorio.js';

type DepsLinea = Pick<DepsApp, 'db' | 'ahora' | 'sync'>;

const MSG_INVALIDA = 'Los datos enviados no son válidos';
const MAX_IDS = 1000;
const esquemaOrden = z.strictObject({ ids: z.array(z.number().int().positive()).max(MAX_IDS) })
  .refine((c) => new Set(c.ids).size === c.ids.length, { message: 'ids repetidos' });

export function registrarRutasLinea(app: FastifyInstance, deps: DepsLinea): void {
  const cache = crearCache(deps.db, deps.ahora);
  const sesion = requerirSesion(deps);

  app.get('/api/linea/orden', { preHandler: sesion }, async (req) =>
    exito(leerOrden(deps.db, cache.proyectosDe(req.usuario!.id)), deps.sync.estado().desactualizado));

  app.put('/api/linea/orden/:contenedor', { preHandler: sesion }, async (req, res) => {
    const contenedor = (req.params as { contenedor: string }).contenedor;
    const cuerpo = esquemaOrden.safeParse(req.body);
    if (!PATRON_CONTENEDOR.test(contenedor) || !cuerpo.success) return res.code(400).send(falla('validacion', MSG_INVALIDA));
    const proyecto = proyectoDeContenedor(contenedor);
    // Un proyecto que esta persona no ve responde igual que uno que no existe.
    if (proyecto === null || !cache.proyectosDe(req.usuario!.id).includes(proyecto)) {
      return res.code(404).send(falla('no-encontrado', 'No existe ese proyecto'));
    }
    guardarOrden(deps.db, contenedor, cuerpo.data.ids);
    return exito({ contenedor, ids: cuerpo.data.ids });
  });
}
