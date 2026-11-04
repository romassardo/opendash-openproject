import type { FastifyInstance } from 'fastify';

// Nadie puede meter OpenDash en un iframe ajeno; la CSP propia de una ruta (el avatar) se respeta.
export function registrarCabeceras(app: FastifyInstance): void {
  app.addHook('onSend', async (req, res, payload) => {
    res.header('X-Frame-Options', 'DENY');
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('Referrer-Policy', 'same-origin');
    if (req.url.startsWith('/api/') && res.getHeader('cache-control') === undefined) {
      res.header('Cache-Control', 'no-store');
    }
    if (res.getHeader('content-security-policy') === undefined) {
      res.header('Content-Security-Policy', "frame-ancestors 'none'");
    }
    return payload;
  });
}
