// Puerto y origen del servidor falso (Outlook y ArgentinaDatos) que comparten la configuración de Playwright,
// el propio servidor y los specs.
export const PUERTO_FALSO = 5198;
export const ORIGEN_FALSO = `http://127.0.0.1:${PUERTO_FALSO}`;
/** Cuántos minutos después de pedirlo empieza la reunión que suma `?proxima=1` (el servidor falso y los specs la comparten). */
export const MINUTOS_REUNION_PROXIMA = 3;
