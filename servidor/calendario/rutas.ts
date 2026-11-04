import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import { diasEntre, esFechaValida, instanteArgentino, sumarDias } from '../../compartido/fechas.js';
import type { CalendarioPropio } from '../../compartido/tipos.js';
import type { DepsApp } from '../app.js';
import { requerirSesion } from '../auth/rutas.js';
import { estadoCalendario, leerCache } from './repositorio.js';

type DepsRutasCalendario = Pick<DepsApp, 'config' | 'db' | 'ahora'>;

const MAX_DIAS = 62;
const fecha = z.string().refine(esFechaValida);
const esquemaRango = z.strictObject({ desde: fecha, hasta: fecha });

export function registrarRutasCalendario(app: FastifyInstance, deps: DepsRutasCalendario): void {
  // Solo lee la caché propia de SQLite: sigue andando con el token de OpenProject vencido.
  const sesion = requerirSesion(deps, { permitirTokenVencido: true });

  app.get('/api/calendario', { preHandler: sesion }, async (req, res) => {
    const rango = esquemaRango.safeParse(req.query);
    if (!rango.success) return res.code(400).send(falla('validacion', 'Las fechas no son válidas'));
    const { desde, hasta } = rango.data;
    const dias = diasEntre(desde, hasta);
    if (dias < 0 || dias + 1 > MAX_DIAS) {
      return res.code(400).send(falla('validacion', `El rango tiene que ser de 1 a ${MAX_DIAS} días`));
    }
    const usuarioId = req.usuario!.id;
    const estado = estadoCalendario(deps.db, usuarioId);
    const cache = estado === null ? null : leerCache(deps.db, deps.config.claveCifrado, usuarioId, () =>
          req.log.warn({ usuarioId, falla: 'cache-corrupta' }, '[calendario] las reuniones guardadas no se pudieron leer'));
    const inicio = instanteArgentino(desde).getTime();
    const fin = instanteArgentino(sumarDias(hasta, 1)).getTime();
    // Toca el rango si empieza antes de que termine y termina después de que empiece (los de duración cero, si caen adentro).
    const reuniones = (cache?.reuniones ?? []).filter((r) => {
      const ini = Date.parse(r.inicio);
      return ini < fin && (Date.parse(r.fin) > inicio || ini >= inicio);
    });
    const datos: CalendarioPropio = { reuniones, estado, ventana: cache?.ventana ?? null };
    return exito(datos);
  });
}
