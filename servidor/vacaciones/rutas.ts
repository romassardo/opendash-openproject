import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { exito, falla, type CodigoError } from '../../compartido/api.js';
import { diasEntre, esFechaValida, hoyArgentina } from '../../compartido/fechas.js';
import type { DepsApp } from '../app.js';
import { requerirSesion } from '../auth/rutas.js';
import { PATRON_ID } from '../identificadores.js';
import { borrarVacaciones, crearVacaciones, sePisan, vacacionesDe } from './repositorio.js';

type DepsVacaciones = Pick<DepsApp, 'db' | 'ahora'>;

const MAX_DIAS = 90;
const esquemaConsulta = z.strictObject({ desde: z.string().refine(esFechaValida).optional() });
const esquemaVacaciones = z.strictObject({ desde: z.string(), hasta: z.string() });

export function registrarRutasVacaciones(app: FastifyInstance, deps: DepsVacaciones): void {
  const sesion = requerirSesion(deps);
  const responder = (res: FastifyReply, estado: number, codigo: CodigoError, mensaje: string) =>
    res.code(estado).send(falla(codigo, mensaje));
  const invalida = (res: FastifyReply, mensaje = 'Los datos enviados no son válidos') => responder(res, 400, 'validacion', mensaje);
  const lista = (usuarioId: number, desde?: string) => vacacionesDe(deps.db, usuarioId, desde ?? hoyArgentina(deps.ahora()));

  app.get('/api/cuenta/vacaciones', { preHandler: sesion }, async (req, res) => {
    const consulta = esquemaConsulta.safeParse(req.query);
    if (!consulta.success) return invalida(res);
    return exito(lista(req.usuario!.id, consulta.data.desde));
  });

  app.post('/api/cuenta/vacaciones', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaVacaciones.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const { desde, hasta } = cuerpo.data;
    const id = req.usuario!.id;
    if (!esFechaValida(desde) || !esFechaValida(hasta) || desde > hasta) {
      return invalida(res, 'La fecha de fin no puede ser anterior al inicio');
    }
    if (hasta < hoyArgentina(deps.ahora())) return invalida(res, 'Esas vacaciones ya terminaron');
    if (diasEntre(desde, hasta) + 1 > MAX_DIAS) return invalida(res, `Cargá períodos de hasta ${MAX_DIAS} días`);
    if (sePisan(deps.db, id, desde, hasta)) return invalida(res, 'Se pisan con otras vacaciones tuyas');
    crearVacaciones(deps.db, id, desde, hasta);
    return exito(lista(id));
  });

  app.delete('/api/cuenta/vacaciones/:id', { preHandler: sesion }, async (req, res) => {
    const crudo = (req.params as { id: string }).id;
    if (!PATRON_ID.test(crudo)) return invalida(res, 'El identificador no es válido');
    const id = req.usuario!.id;
    if (!borrarVacaciones(deps.db, id, Number(crudo))) return responder(res, 404, 'no-encontrado', 'No existen esas vacaciones');
    return exito(lista(id));
  });
}
