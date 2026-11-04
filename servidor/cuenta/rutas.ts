import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { exito, falla, type CodigoError } from '../../compartido/api.js';
import type { DepsApp } from '../app.js';
import { estaBloqueado, registrarIntento, descartarIntento } from '../auth/intentos.js';
import { COOKIE_SESION, requerirSesion } from '../auth/rutas.js';
import { enlacePermitido } from '../calendario/lectura.js';
import { estadoCalendario } from '../calendario/repositorio.js';
import { borrarOtrasSesiones } from '../auth/sesiones.js';
import { PATRON_ID } from '../identificadores.js';
import { hashear, verificar } from '../seguridad/contrasenas.js';
import { leerYo } from './yo.js';

type DepsCuenta = Required<Pick<DepsApp, 'config' | 'db' | 'ahora' | 'calendario'>>;

const multiploDe = (paso: number) => (n: number) => Math.abs(n / paso - Math.round(n / paso)) < 1e-9;

const esquemaAjustes = z
  .strictObject({
    rol: z.string().trim().max(60),
    capacidadHoras: z.number().min(1).max(80).refine(multiploDe(0.5)),
    tema: z.enum(['oscuro', 'claro']),
    variasALaVez: z.boolean(),
    avisoReunionMin: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(15)]).nullable(),
  })
  .partial()
  .refine((c) => Object.keys(c).length > 0);
const esquemaContrasena = z.strictObject({ actual: z.string().min(1).max(200), nueva: z.string().min(8).max(200) });
// Que sea un enlace de Outlook lo decide la ruta (con su mensaje propio), no el esquema.
const esquemaCalendario = z.strictObject({ url: z.string().max(2000).nullable() });
const esquemaFijado = z.strictObject({ proyectoId: z.number().int().positive(), fijado: z.boolean() });

function responder(res: FastifyReply, estado: number, codigo: CodigoError, mensaje: string): FastifyReply {
  return res.code(estado).send(falla(codigo, mensaje));
}

export function registrarRutasCuenta(app: FastifyInstance, deps: DepsCuenta): void {
  const sesion = requerirSesion(deps);
  const invalida = (res: FastifyReply) => responder(res, 400, 'validacion', 'Los datos enviados no son válidos');

  app.patch('/api/cuenta', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaAjustes.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const { rol, capacidadHoras, tema, variasALaVez, avisoReunionMin } = cuerpo.data;
    const columnas: Record<string, string | number | null | undefined> = {
      rol, capacidad_horas: capacidadHoras, tema,
      varias_a_la_vez: variasALaVez === undefined ? undefined : Number(variasALaVez),
      aviso_reunion_min: avisoReunionMin,
    };
    const dadas = Object.entries(columnas).filter(([, v]) => v !== undefined);
    const asignaciones = dadas.map(([col]) => `${col} = @${col}`).join(', ');
    deps.db.prepare(`update usuarios set ${asignaciones} where id = @id`).run({ ...Object.fromEntries(dadas), id: req.usuario!.id });
    return exito(leerYo(deps.db, req.usuario!.id));
  });

  app.put('/api/cuenta/contrasena', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaContrasena.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const { id, login } = req.usuario!;
    const ahora = deps.ahora();
    if (estaBloqueado(deps.db, login, req.ip, ahora)) {
      return responder(res, 429, 'demasiados-intentos', 'Demasiados intentos, probá de nuevo en unos minutos');
    }
    const intento = registrarIntento(deps.db, login, req.ip, ahora);
    const hash = deps.db.prepare('select hash from usuarios where id = ?').pluck().get(id) as string;
    if (!(await verificar(cuerpo.data.actual, hash))) {
      return responder(res, 401, 'credenciales', 'La contraseña actual no es correcta');
    }
    descartarIntento(deps.db, intento);
    const hashNuevo = await hashear(cuerpo.data.nueva);
    const cookie = req.cookies[COOKIE_SESION] ?? '';
    // Hash nuevo y cierre de las otras sesiones van juntos: si una parte falla, no queda ninguna.
    deps.db.transaction(() => {
      deps.db.prepare('update usuarios set hash = ? where id = ?').run(hashNuevo, id);
      borrarOtrasSesiones(deps.db, id, cookie);
    })();
    return exito({});
  });

  app.put('/api/cuenta/calendario', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaCalendario.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const id = req.usuario!.id;
    const { url } = cuerpo.data;
    if (url === null) {
      deps.calendario.quitarEnlace(id);
      return exito({ tieneCalendario: false, calendario: null });
    }
    if (!enlacePermitido(url, deps.config.icsOrigenesPrueba)) {
      return responder(res, 400, 'validacion', 'El enlace tiene que ser el de un calendario publicado de Outlook');
    }
    // Si algo falla no se guarda nada: siguen el enlace y las reuniones de antes.
    const resultado = await deps.calendario.guardarEnlace(id, url);
    if (!resultado.ok) {
      return resultado.falla === 'enlace-caido'
        ? responder(res, 400, 'validacion', 'Ese enlace no devuelve un calendario. Revisá que esté publicado con todos los detalles y copiá el enlace ICS')
        : responder(res, 503, 'sin-conexion', 'No se pudo conectar con Outlook. Probá de nuevo en un rato');
    }
    return exito({ tieneCalendario: true, calendario: estadoCalendario(deps.db, id) });
  });

  app.put('/api/cuenta/fijados', { preHandler: sesion }, async (req, res) => {
    const cuerpo = esquemaFijado.safeParse(req.body);
    if (!cuerpo.success || !PATRON_ID.test(String(cuerpo.data.proyectoId))) return invalida(res);
    const { proyectoId, fijado } = cuerpo.data;
    const id = req.usuario!.id;
    // Quitar un fijado siempre se puede, aunque la persona ya no vea el proyecto.
    const visible = deps.db.prepare('select 1 from usuario_proyectos where usuario_id = ? and proyecto_id = ?').get(id, proyectoId);
    if (fijado && visible === undefined) return responder(res, 404, 'no-encontrado', 'No existe ese proyecto');
    const actuales = leerYo(deps.db, id).fijados;
    const nuevos = fijado ? (actuales.includes(proyectoId) ? actuales : [...actuales, proyectoId]) : actuales.filter((p) => p !== proyectoId);
    deps.db.prepare('update usuarios set fijados = ? where id = ?').run(JSON.stringify(nuevos), id);
    return exito({ fijados: nuevos });
  });
}
