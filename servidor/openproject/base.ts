import type { Persona } from '../../compartido/tipos.js';
import type { Registro } from '../registro.js';
import type { TipoErrorOp } from './errores.js';
import { aPersona } from './mapeo.js';

// Piezas que comparten el cliente de OpenProject y los módulos que lo componen (adjuntos, miembros, versiones, proyectos).

/** Lo que el cliente le presta a cada módulo: la base, el fetch con el token y los pedidos ya armados. */
export interface ContextoOp {
  base: string;
  llamar: typeof fetch;
  autorizacion: string;
  registro: Registro;
  /** `idempotente`: un POST que se puede repetir sin efecto; si no llega es `red`, no `incierto`. */
  pedir(metodo: string, ruta: string, cuerpo?: unknown, idempotente?: boolean): Promise<unknown>;
  /** Recorre todas las páginas de una colección. */
  todos(ruta: string, extra?: Record<string, string>): Promise<unknown[]>;
}

export const TAMANO_PAGINA = 100;
export const ESPERA_MAXIMA_MS = 30_000;
export const MAXIMO_REDIRECCIONES = 3;
export const MAXIMO_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAXIMO_ADJUNTO_RESPALDO = 5_242_880;

export const MENSAJE_POR_TIPO: Record<TipoErrorOp, string> = {
  'no-autorizado': 'OpenProject no reconoce el token',
  prohibido: 'OpenProject no permite esta acción con tu usuario',
  'no-encontrado': 'OpenProject no encontró el recurso pedido',
  conflicto: 'El recurso cambió en OpenProject desde que lo cargaste',
  validacion: 'OpenProject rechazó los datos enviados',
  red: 'No se pudo hablar con OpenProject',
  incierto: 'OpenProject no respondió y no se sabe si guardó el pedido',
};

export const href = (recurso: string, id: number): { href: string } => ({ href: `/api/v3/${recurso}/${id}` });
export const hrefONulo = (recurso: string, id: number | null): { href: string | null } => ({ href: id === null ? null : `/api/v3/${recurso}/${id}` });

/** Campos que OpenProject señala en un error de validación: `_embedded.details.attribute` o, con varios errores, el de cada uno. */
export function atributosDelCuerpo(texto: string): string[] {
  try {
    const cuerpo = JSON.parse(texto) as { _embedded?: { details?: { attribute?: unknown }; errors?: { _embedded?: { details?: { attribute?: unknown } } }[] } } | null;
    const crudos = [cuerpo?._embedded?.details?.attribute, ...(cuerpo?._embedded?.errors ?? []).map((e) => e?._embedded?.details?.attribute)];
    return crudos.filter((a): a is string => typeof a === 'string');
  } catch {
    return [];
  }
}

export function mensajeDelCuerpo(texto: string): string | null {
  try {
    const cuerpo: unknown = JSON.parse(texto);
    const mensaje = (cuerpo as { message?: unknown } | null)?.message;
    return typeof mensaje === 'string' && mensaje !== '' ? mensaje : null;
  } catch {
    return null;
  }
}

export const idNumericoDe = (hal: unknown): number | null => {
  const id = (hal as { id?: unknown } | null)?.id;
  return typeof id === 'number' ? id : null;
};

export const personasDe = (elementos: unknown[]): Persona[] =>
  elementos.map(aPersona).filter((p): p is Persona => p !== null);

/** ¿La respuesta HAL trae ese enlace en `_links`? (así OpenProject dice qué se puede hacer). */
export function tieneEnlace(hal: unknown, nombre: string): boolean {
  const enlaces = (hal as { _links?: Record<string, unknown> } | null)?._links;
  return enlaces != null && enlaces[nombre] != null;
}

/** Lee el cuerpo por partes; si pasa de `maximo` bytes cancela la lectura y devuelve `null`. */
export async function leerAcotado(res: Response, maximo: number): Promise<Buffer | null> {
  if (res.body === null) return Buffer.alloc(0);
  const lector = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > maximo) {
      await lector.cancel();
      return null;
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}
