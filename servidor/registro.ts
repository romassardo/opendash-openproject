import type { FastifyBaseLogger } from 'fastify';
import { pino } from 'pino';

/** Lo mínimo que necesitan los módulos del servidor para avisar; Fastify y pino lo cumplen. */
export type Registro = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

const nada = (): void => {};

/** Registro que no hace nada: lo que usan las pruebas y todo lo que no recibe uno. */
export const REGISTRO_MUDO: Registro = { info: nada, warn: nada, error: nada };

export function crearRegistro(produccion: boolean): FastifyBaseLogger {
  return pino({ level: produccion ? 'info' : 'warn' });
}
