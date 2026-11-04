import type { Database } from 'better-sqlite3';
import type { FastifyReply } from 'fastify';
import { falla, type Respuesta } from '../compartido/api.js';
import { marcarTokenVencido } from './auth/clientes.js';
import { ErrorOp } from './openproject/errores.js';

export const MSG_INCIERTO = 'OpenProject no respondió a tiempo y no sabemos si lo guardó. Revisá antes de volver a intentar.';
export const MSG_TOKEN_VENCIDO = 'Tu token de OpenProject venció, cargá uno nuevo';

interface Contexto { db: Database; usuarioId: number }

/**
 * Traduce un error de OpenProject al estado HTTP y al sobre de la API propia.
 * Lo que no es un ErrorOp se relanza a propósito: el manejador de la app lo responde como 500 `interno`.
 */
export function aRespuestaError(e: unknown, contexto: Contexto): { estado: number; cuerpo: Respuesta<never> } {
  if (!(e instanceof ErrorOp)) throw e;
  switch (e.tipo) {
    case 'no-autorizado':
      marcarTokenVencido(contexto.db, contexto.usuarioId);
      return { estado: 401, cuerpo: falla('token-vencido', MSG_TOKEN_VENCIDO) };
    case 'prohibido':
      return { estado: 403, cuerpo: falla('prohibido', 'No tenés permiso para hacer eso en OpenProject') };
    case 'no-encontrado':
      return { estado: 404, cuerpo: falla('no-encontrado', 'No se encontró en OpenProject') };
    case 'conflicto':
      return { estado: 409, cuerpo: falla('conflicto', 'Alguien modificó la tarea antes que vos') };
    case 'validacion':
      return { estado: 422, cuerpo: falla('validacion', e.message, e.atributos) };
    case 'red':
      return { estado: 503, cuerpo: falla('sin-conexion', 'Sin conexión con OpenProject') };
    case 'incierto':
      return { estado: 503, cuerpo: falla('resultado-incierto', MSG_INCIERTO) };
  }
}

export function responderError(res: FastifyReply, e: unknown, contexto: Contexto): FastifyReply {
  const { estado, cuerpo } = aRespuestaError(e, contexto);
  return res.code(estado).send(cuerpo);
}

export function responderTokenVencido(res: FastifyReply): FastifyReply {
  return res.code(401).send(falla('token-vencido', MSG_TOKEN_VENCIDO));
}
