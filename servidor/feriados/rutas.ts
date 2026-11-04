import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import { esFechaValida, hoyArgentina } from '../../compartido/fechas.js';
import type { ListaFeriados } from '../../compartido/tipos.js';
import type { DepsApp } from '../app.js';
import { requerirSesion } from '../auth/rutas.js';
import { agregarFeriado, feriadosEntre, quitarFeriado } from './repositorio.js';

type DepsRutasFeriados = Pick<DepsApp, 'db' | 'ahora'>;

const esquemaNuevo = z.strictObject({ fecha: z.string().refine(esFechaValida), nombre: z.string().trim().min(1).max(80) });

export function registrarRutasFeriados(app: FastifyInstance, deps: DepsRutasFeriados): void {
  const sesion = requerirSesion(deps);

  /** Del 1 de enero del año en curso al 31 de diciembre del siguiente. */
  const ventana = (): { desde: string; hasta: string } => {
    const anio = Number(hoyArgentina(deps.ahora()).slice(0, 4));
    return { desde: `${anio}-01-01`, hasta: `${anio + 1}-12-31` };
  };
  const lista = (): ListaFeriados => {
    const { desde, hasta } = ventana();
    const actualizado = deps.db.prepare("select valor from estado_sync where clave = 'feriados_actualizados'").pluck().get() as string | undefined;
    return { feriados: feriadosEntre(deps.db, desde, hasta), actualizado: actualizado ?? null };
  };

  app.get('/api/feriados', { preHandler: sesion }, async () => exito(lista()));

  app.post('/api/feriados', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaNuevo.safeParse(req.body);
    const { desde, hasta } = ventana();
    if (!cuerpo.success || cuerpo.data.fecha < desde || cuerpo.data.fecha > hasta) {
      return res.code(400).send(falla('validacion', 'Los datos enviados no son válidos'));
    }
    agregarFeriado(deps.db, cuerpo.data.fecha, cuerpo.data.nombre);
    return exito(lista());
  });

  app.delete('/api/feriados/:fecha', { preHandler: sesion }, async (req, res) => {
    const { fecha } = req.params as { fecha: string };
    const { desde, hasta } = ventana();
    if (!esFechaValida(fecha) || fecha < desde || fecha > hasta) return res.code(400).send(falla('validacion', 'La fecha no es válida'));
    if (!quitarFeriado(deps.db, fecha)) return res.code(404).send(falla('no-encontrado', 'Ese día no es feriado'));
    return exito(lista());
  });
}
