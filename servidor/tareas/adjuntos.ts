import type { FastifyInstance, onRequestAsyncHookHandler, preParsingAsyncHookHandler } from 'fastify';
import { exito, falla } from '../../compartido/api.js';
import { textoArchivoGrande, TIPOS_EN_LINEA } from '../../compartido/adjuntos.js';
import type { DepsApp } from '../app.js';
import { clientePara } from '../auth/clientes.js';
import { requerirSesion } from '../auth/rutas.js';
import { responderError, responderTokenVencido } from '../errores.js';
import { PATRON_ID } from '../identificadores.js';
import type { ClienteOp } from '../openproject/cliente.js';

type DepsAdjuntos = Pick<DepsApp, 'config' | 'db' | 'crearCliente' | 'ahora' | 'registro'>;

/** Tope duro del cuerpo de una subida; el máximo real lo dice OpenProject y se controla aparte. */
const TOPE_SUBIDA_BYTES = 64 * 1024 * 1024;
const MARGEN_CUERPO_BYTES = 64 * 1024;
const MAXIMO_NOMBRE = 255;
/** Cuánto vale el máximo de OpenProject que el servidor recuerda para cortar una subida antes de leerla. */
const VIDA_MAXIMO_MS = 10 * 60 * 1000;

/** Controles C0, DEL, C1 y de dirección: U+202E da vuelta el texto y hace pasar «factura‮fdp.exe» por un PDF. */
const CARACTERES_DE_CONTROL = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** Nombre sin carpetas ni caracteres de control; `null` si queda vacío. */
function limpiarNombre(crudo: unknown): string | null {
  if (typeof crudo !== 'string') return null;
  const base = crudo.replace(CARACTERES_DE_CONTROL, '').split(/[\\/]/).pop()?.trim() ?? '';
  return base === '' || base.length > MAXIMO_NOMBRE ? null : base;
}

function esencia(tipo: string | undefined): string {
  return (tipo ?? '').split(';')[0]!.trim().toLowerCase();
}

/** `filename*` lleva el nombre real en UTF-8; `filename` es solo el respaldo ASCII. */
function contentDisposition(modo: 'inline' | 'attachment', nombre: string): string {
  const respaldo = nombre.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const codificado = encodeURIComponent(nombre).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${modo}; filename="${respaldo}"; filename*=UTF-8''${codificado}`;
}

export function registrarRutasAdjuntos(app: FastifyInstance, deps: DepsAdjuntos): void {
  const sesion = requerirSesion(deps);
  // El máximo es de toda la instancia: se recuerda un rato para rechazar una subida por su content-length, sin leerla.
  let maximoRecordado: { bytes: number; vence: number } | null = null;
  const recordarMaximo = (bytes: number): number => {
    maximoRecordado = { bytes, vence: deps.ahora().getTime() + VIDA_MAXIMO_MS };
    return bytes;
  };
  const maximoVigente = (): number | null =>
    maximoRecordado !== null && maximoRecordado.vence > deps.ahora().getTime() ? maximoRecordado.bytes : null;
  const maximoDe = async (cliente: ClienteOp): Promise<number> => maximoVigente() ?? recordarMaximo(await cliente.maximoAdjunto());
  const idDe = (params: unknown): number | null => {
    const crudo = (params as { id: string }).id;
    return PATRON_ID.test(crudo) ? Number(crudo) : null;
  };
  const idInvalido = falla('validacion', 'El identificador no es válido');

  app.get('/api/tareas/:id/adjuntos', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req.params);
    if (id === null) return res.code(400).send(idInvalido);
    const usuarioId = req.usuario!.id;
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      const [adjuntos, puedeAdjuntar, maximoBytes] = await Promise.all([
        cliente.adjuntos(id), cliente.puedeAdjuntar(id), cliente.maximoAdjunto().then(recordarMaximo),
      ]);
      return exito({ adjuntos, puedeAdjuntar, maximoBytes });
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  // La subida es el cuerpo crudo del archivo: el contexto propio tiene su analizador y no toca al JSON del resto.
  void app.register(async (subida) => {
    subida.removeAllContentTypeParsers();
    subida.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: TOPE_SUBIDA_BYTES + MARGEN_CUERPO_BYTES }, (_req, cuerpo, hecho) => hecho(null, cuerpo));
    const nombreDe = (req: { query: unknown }): string => limpiarNombre((req.query as { nombre?: unknown }).nombre) ?? 'El archivo';
    const maximoEfectivo = (): number => Math.min(maximoVigente() ?? TOPE_SUBIDA_BYTES, TOPE_SUBIDA_BYTES);
    subida.setErrorHandler((error, req, res) => {
      const estado = (error as { statusCode?: number }).statusCode ?? 500;
      if (estado === 413) {
        const declarado = Number(req.headers['content-length']);
        return res.code(400).send(falla('validacion', textoArchivoGrande(nombreDe(req), Number.isFinite(declarado) ? declarado : maximoEfectivo() + 1, maximoEfectivo())));
      }
      if (estado >= 400 && estado < 500) return res.code(estado).send(falla('validacion', 'La solicitud no es válida'));
      req.log.error({ motivo: error instanceof Error ? error.message : 'desconocido' }, 'error no controlado');
      return res.code(500).send(falla('interno', 'Algo salió mal en el servidor'));
    });

    // Sin sesión se corta antes de leer el cuerpo (`preHandler` corre después del análisis y dejaría juntar 64 MB por pedido).
    const exigirSesion = sesion as unknown as onRequestAsyncHookHandler;
    // Con el tamaño declarado se rechaza lo que pasa del máximo de OpenProject sin leerlo.
    const controlarTamano: preParsingAsyncHookHandler = async (req, res) => {
      const declarado = req.headers['content-length'];
      if (declarado === undefined) return res.code(411).send(falla('validacion', 'Falta el tamaño del archivo'));
      const bytes = Number(declarado);
      const maximo = maximoVigente();
      if (!Number.isFinite(bytes) || (maximo !== null && bytes > maximo + MARGEN_CUERPO_BYTES)) {
        return res.code(400).send(falla('validacion', textoArchivoGrande(nombreDe(req), Number.isFinite(bytes) ? bytes : 0, maximoEfectivo())));
      }
      return undefined;
    };

    subida.post('/api/tareas/:id/adjuntos', { onRequest: exigirSesion, preParsing: controlarTamano, bodyLimit: TOPE_SUBIDA_BYTES + MARGEN_CUERPO_BYTES }, async (req, res) => {
      const id = idDe(req.params);
      if (id === null) return res.code(400).send(idInvalido);
      const nombre = limpiarNombre((req.query as { nombre?: unknown }).nombre);
      if (nombre === null) return res.code(400).send(falla('validacion', 'Falta el nombre del archivo'));
      const datos = Buffer.isBuffer(req.body) ? req.body : null;
      if (datos === null || datos.length === 0) return res.code(400).send(falla('validacion', `“${nombre}” está vacío`));
      const usuarioId = req.usuario!.id;
      const cliente = clientePara(deps, usuarioId);
      if (cliente === null) return responderTokenVencido(res);
      try {
        const maximo = await maximoDe(cliente);
        if (datos.length > maximo) return res.code(400).send(falla('validacion', textoArchivoGrande(nombre, datos.length, maximo)));
        const tipo = esencia(req.headers['content-type']) || 'application/octet-stream';
        return exito(await cliente.subirAdjunto(id, nombre, tipo, datos));
      } catch (e) {
        return responderError(res, e, { db: deps.db, usuarioId });
      }
    });
  });

  // El navegador nunca habla con OpenProject: el archivo pasa por acá, con el token de quien lo pide.
  app.get('/api/adjuntos/:id/contenido', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req.params);
    if (id === null) return res.code(400).send(idInvalido);
    const usuarioId = req.usuario!.id;
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      const meta = await cliente.adjunto(id);
      const archivo = await cliente.bajarAdjunto(id, await maximoDe(cliente));
      const tipo = esencia(archivo.tipo) || 'application/octet-stream';
      const enLinea = TIPOS_EN_LINEA.has(tipo);
      res
        .header('content-type', tipo)
        .header('content-disposition', contentDisposition(enLinea ? 'inline' : 'attachment', meta.nombre))
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store');
      // Un archivo abierto directo no puede correr código en el origen de OpenDash. El PDF queda afuera: con `sandbox`
      // Chrome no carga su visor (plugin), y el visor ya corre aislado del origen.
      if (tipo !== 'application/pdf') res.header('content-security-policy', 'sandbox');
      return res.send(archivo.bytes);
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });

  app.delete('/api/adjuntos/:id', { preHandler: sesion }, async (req, res) => {
    const id = idDe(req.params);
    if (id === null) return res.code(400).send(idInvalido);
    const usuarioId = req.usuario!.id;
    const cliente = clientePara(deps, usuarioId);
    if (cliente === null) return responderTokenVencido(res);
    try {
      await cliente.borrarAdjunto(id);
      return exito({});
    } catch (e) {
      return responderError(res, e, { db: deps.db, usuarioId });
    }
  });
}
