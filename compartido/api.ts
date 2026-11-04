export type CodigoError =
  | 'no-sesion'
  | 'token-vencido'
  | 'token-invalido'
  | 'credenciales'
  | 'demasiados-intentos'
  | 'conflicto'
  | 'transicion-no-permitida'
  | 'validacion'
  | 'no-encontrado'
  | 'prohibido'
  | 'sin-conexion'
  | 'resultado-incierto'
  | 'interno';

export type Respuesta<T> =
  | { ok: true; datos: T; desactualizado: boolean }
  | { ok: false; codigo: CodigoError; mensaje: string; atributos?: string[] };

export function exito<T>(datos: T, desactualizado = false): Respuesta<T> {
  return { ok: true, datos, desactualizado };
}

/** `atributos`: los campos de OpenProject que rechazaron el cambio (solo en validaciones), para que la web sepa de qué habla el motivo. */
export function falla(codigo: CodigoError, mensaje: string, atributos: readonly string[] = []): Respuesta<never> {
  return atributos.length === 0 ? { ok: false, codigo, mensaje } : { ok: false, codigo, mensaje, atributos: [...atributos] };
}
