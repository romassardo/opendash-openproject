import { aAdjunto } from './mapeo.js';
import type { ClienteOp } from './cliente.js';
import { ErrorOp, tipoDeEstadoHttp } from './errores.js';
import { ESPERA_MAXIMA_MS, leerAcotado, MAXIMO_ADJUNTO_RESPALDO, MAXIMO_REDIRECCIONES, MENSAJE_POR_TIPO, tieneEnlace, type ContextoOp } from './base.js';

/** Adjuntos de las tareas: lista, subida, bajada con tope de tamaño, borrado y máximo de la instancia. */
export function crearAdjuntosOp(ctx: ContextoOp): Pick<ClienteOp, 'adjuntos' | 'adjunto' | 'puedeAdjuntar' | 'subirAdjunto' | 'borrarAdjunto' | 'maximoAdjunto' | 'bajarAdjunto'> {
  const { pedir, todos } = ctx;
  const { base, llamar, autorizacion } = ctx;

  // Igual que el avatar: la URL se arma con el id y solo se siguen redirecciones dentro de OpenProject.
  async function bajarAdjunto(id: number, maxBytes: number): Promise<{ tipo: string; bytes: Buffer }> {
    const origen = new URL(base).origin;
    let url = `${base}/api/v3/attachments/${id}/content`;
    for (let salto = 0; salto <= MAXIMO_REDIRECCIONES; salto++) {
      let res: Response;
      try {
        res = await llamar(url, {
          headers: { Authorization: autorizacion, Accept: '*/*' },
          redirect: 'manual',
          signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
        });
      } catch (causa) {
        throw new ErrorOp('red', MENSAJE_POR_TIPO.red, null, { cause: causa });
      }
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const destino = res.headers.get('location');
        const siguiente = destino === null ? null : new URL(destino, url);
        if (siguiente === null || siguiente.origin !== origen) {
          throw new ErrorOp('red', 'OpenProject mandó el archivo a otro sitio y no se descargó', res.status);
        }
        url = siguiente.href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        const tipo = tipoDeEstadoHttp(res.status);
        throw new ErrorOp(tipo, MENSAJE_POR_TIPO[tipo], res.status);
      }
      const demasiado = () => new ErrorOp('validacion', 'El archivo pesa más del máximo permitido', res.status);
      const declarado = Number(res.headers.get('content-length'));
      if (Number.isFinite(declarado) && declarado > maxBytes) {
        await res.body?.cancel();
        throw demasiado();
      }
      let bytes: Buffer | null;
      try {
        bytes = await leerAcotado(res, maxBytes);
      } catch (causa) {
        throw new ErrorOp('red', MENSAJE_POR_TIPO.red, res.status, { cause: causa });
      }
      if (bytes === null) throw demasiado();
      return { tipo: res.headers.get('content-type') ?? 'application/octet-stream', bytes };
    }
    throw new ErrorOp('red', 'OpenProject redirigió demasiadas veces', null);
  }

  return {
    async adjuntos(tareaId) {
      return (await todos(`/api/v3/work_packages/${tareaId}/attachments`)).map(aAdjunto);
    },

    async adjunto(id) {
      return aAdjunto(await pedir('GET', `/api/v3/attachments/${id}`));
    },

    async puedeAdjuntar(tareaId) {
      return tieneEnlace(await pedir('GET', `/api/v3/work_packages/${tareaId}`), 'addAttachment');
    },

    async subirAdjunto(tareaId, nombre, tipo, datos) {
      const form = new FormData();
      form.append('metadata', JSON.stringify({ fileName: nombre }));
      form.append('file', new Blob([new Uint8Array(datos)], { type: tipo }), nombre);
      return aAdjunto(await pedir('POST', `/api/v3/work_packages/${tareaId}/attachments`, form));
    },

    bajarAdjunto,

    async borrarAdjunto(id) {
      await pedir('DELETE', `/api/v3/attachments/${id}`);
    },

    async maximoAdjunto() {
      try {
        const max = ((await pedir('GET', '/api/v3/configuration')) as { maximumAttachmentFileSize?: unknown } | null)?.maximumAttachmentFileSize;
        return typeof max === 'number' && max > 0 ? max : MAXIMO_ADJUNTO_RESPALDO;
      } catch (error) {
        // Sin sesión o sin red no se inventa un máximo: el respaldo es solo para 403, 404 o una respuesta rara.
        if (error instanceof ErrorOp && (error.tipo === 'no-autorizado' || error.tipo === 'red')) throw error;
        return MAXIMO_ADJUNTO_RESPALDO;
      }
    },
  };
}
