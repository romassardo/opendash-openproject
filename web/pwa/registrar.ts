/** Registra el service worker (solo sirve la página sin conexión). Un fallo se ignora en silencio. */
export function registrar(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  } catch {
    // Sin service worker la app anda igual.
  }
}
