import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { exito, falla } from '../../compartido/api.js';
import type { DepsApp } from '../app.js';
import { requerirSesion } from '../auth/rutas.js';
import { leerReceptores } from '../ajustes/repositorio.js';
import { PATRON_ID } from '../identificadores.js';
import { MAX_BYTES_IMAGEN, tipoPorBytes } from './imagen.js';
import { avisosDe, contarDesde, crearAviso, imagenDe, marcarAviso, todosLosAvisos } from './repositorio.js';

type DepsAvisos = Pick<DepsApp, 'db' | 'ahora'>;

const MAX_TEXTO = 4000;
const MAX_POR_HORA = 20;
const HORA_MS = 60 * 60 * 1000;
const LIMITE_CUERPO = 5 * 1024 * 1024;
const MSG_INVALIDA = 'Los datos enviados no son válidos';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const corto = (max: number) => z.string().max(max);
const esquemaContexto = z.strictObject({
  ruta: corto(500), titulo: corto(300), navegador: corto(500), ventana: corto(50),
  tema: z.enum(['oscuro', 'claro']), version: corto(50), error: corto(2000).nullable(),
});
const esquemaAviso = z.strictObject({
  texto: z.string().max(MAX_TEXTO),
  contexto: esquemaContexto,
  imagen: z.strictObject({ tipo: corto(50), datos: z.string() }).optional(),
});
const esquemaEstado = z.strictObject({ estado: z.enum(['nuevo', 'visto', 'arreglado']) });

export function registrarRutasAvisos(app: FastifyInstance, deps: DepsAvisos): void {
  const sesion = requerirSesion(deps, { permitirTokenVencido: true });
  const invalida = (res: FastifyReply, mensaje = MSG_INVALIDA): FastifyReply => res.code(400).send(falla('validacion', mensaje));
  const esReceptor = (usuarioId: number): boolean => leerReceptores(deps.db).includes(usuarioId);

  app.post('/api/avisos-problema', { preHandler: sesion, bodyLimit: LIMITE_CUERPO }, async (req, res) => {
    const cuerpo = esquemaAviso.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    const texto = cuerpo.data.texto.trim();
    if (texto === '') return invalida(res, 'Contanos qué pasó o qué te falta.');
    let imagen: { tipo: string; bytes: Buffer } | null = null;
    if (cuerpo.data.imagen !== undefined) {
      const datos = cuerpo.data.imagen.datos;
      // Lo que por su largo ya pasa el tope ni siquiera se decodifica.
      if (datos.length > Math.ceil((MAX_BYTES_IMAGEN * 4) / 3) + 4) return invalida(res, 'La imagen pesa más de 3 MB.');
      if (datos.length % 4 !== 0 || !BASE64.test(datos)) return invalida(res, 'La imagen no es válida.');
      const bytes = Buffer.from(datos, 'base64');
      if (bytes.length > MAX_BYTES_IMAGEN) return invalida(res, 'La imagen pesa más de 3 MB.');
      const tipo = tipoPorBytes(bytes);
      if (tipo === null) return invalida(res, 'La imagen tiene que ser png, jpg o webp.');
      if (tipo !== cuerpo.data.imagen.tipo) return invalida(res, 'El tipo de la imagen no coincide con su contenido.');
      imagen = { tipo, bytes };
    }
    const ahora = deps.ahora();
    const usuarioId = req.usuario!.id;
    if (contarDesde(deps.db, usuarioId, new Date(ahora.getTime() - HORA_MS).toISOString()) >= MAX_POR_HORA) {
      return res.code(429).send(falla('validacion', 'Mandaste muchos avisos seguidos; probá en un rato.'));
    }
    const id = crearAviso(deps.db, { usuarioId, creado: ahora.toISOString(), texto, contexto: cuerpo.data.contexto, imagen });
    return exito({ id });
  });

  app.get('/api/avisos-problema/mios', { preHandler: sesion }, async (req) => exito(avisosDe(deps.db, req.usuario!.id)));

  app.get('/api/avisos-problema', { preHandler: sesion }, async (req, res) => {
    if (!esReceptor(req.usuario!.id)) return res.code(403).send(falla('prohibido', 'No recibís los avisos de problemas.'));
    return exito(todosLosAvisos(deps.db));
  });

  app.get('/api/avisos-problema/:id/imagen', { preHandler: sesion }, async (req, res) => {
    const crudo = (req.params as { id: string }).id;
    const noHay = (): FastifyReply => res.code(404).send(falla('no-encontrado', 'No existe esa imagen'));
    if (!PATRON_ID.test(crudo)) return noHay();
    const imagen = imagenDe(deps.db, Number(crudo));
    if (imagen === null || (imagen.usuarioId !== req.usuario!.id && !esReceptor(req.usuario!.id))) return noHay();
    return res
      .header('Content-Type', imagen.tipo)
      .header('Content-Disposition', 'inline')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox')
      .send(imagen.bytes);
  });

  app.patch('/api/avisos-problema/:id', { preHandler: sesion }, async (req, res) => {
    const crudo = (req.params as { id: string }).id;
    if (!PATRON_ID.test(crudo)) return invalida(res, 'El identificador no es válido');
    if (!esReceptor(req.usuario!.id)) return res.code(403).send(falla('prohibido', 'No recibís los avisos de problemas.'));
    const cuerpo = esquemaEstado.safeParse(req.body);
    if (!cuerpo.success) return invalida(res);
    if (!marcarAviso(deps.db, Number(crudo), cuerpo.data.estado, req.usuario!.id, deps.ahora().toISOString())) {
      return res.code(404).send(falla('no-encontrado', 'No existe ese aviso'));
    }
    return exito({ estado: cuerpo.data.estado });
  });
}
