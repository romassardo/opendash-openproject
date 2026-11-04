// Service worker de OpenDash: solo sirve la página sin conexión cuando falla una navegación.
// No guarda nunca respuestas de /api/ ni datos.
const CACHE = 'opendash-sin-conexion-v1';
const PAGINA = '/sin-conexion.html';
const ARCHIVOS = [PAGINA, '/iconos/192.png'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  if (evento.request.mode !== 'navigate') return;
  evento.respondWith(fetch(evento.request).catch(() => caches.match(PAGINA)));
});
