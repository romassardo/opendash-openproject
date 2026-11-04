import type { FastifyInstance } from 'fastify';
import { falla } from '../../compartido/api.js';

const METODOS_QUE_ESCRIBEN = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function mismoHost(origen: string, host: string | undefined): boolean {
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

// La cookie de sesión es SameSite=Strict; esto cierra el resto: un pedido que escribe tiene que
// venir de esta misma página. Sin Origin (curl, pruebas) pasa salvo que el navegador diga cross-site.
export function registrarChequeoOrigen(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, res) => {
    if (!METODOS_QUE_ESCRIBEN.has(req.method)) return;
    // El enrutador decodifica la ruta (/%61pi/ llega a /api/): se decide con la ruta que encontró él.
    const camino = req.routeOptions.url ?? req.url.split('?')[0] ?? '';
    if (!camino.startsWith('/api/')) return;
    const origen = req.headers.origin;
    const ajeno = origen !== undefined ? !mismoHost(origen, req.headers.host) : req.headers['sec-fetch-site'] === 'cross-site';
    if (ajeno) return res.code(403).send(falla('prohibido', 'La solicitud viene de otro sitio'));
  });
}
