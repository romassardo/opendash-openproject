export type TipoErrorOp = 'no-autorizado' | 'prohibido' | 'no-encontrado' | 'conflicto' | 'validacion' | 'red' | 'incierto';

export class ErrorOp extends Error {
  readonly tipo: TipoErrorOp;
  readonly estadoHttp: number | null;
  /** Campos de OpenProject que rechazó una validación (`version`, `dueDate`…); vacío si no los dijo. */
  readonly atributos: readonly string[];

  constructor(tipo: TipoErrorOp, mensaje: string, estadoHttp: number | null = null, opciones?: ErrorOptions & { atributos?: readonly string[] }) {
    super(mensaje, opciones);
    this.atributos = opciones?.atributos ?? [];
    this.name = 'ErrorOp';
    this.tipo = tipo;
    this.estadoHttp = estadoHttp;
  }
}

/** Un POST que no se sabe si llegó (sin respuesta, 502 o 504) es `incierto`: reintentarlo podría duplicar el alta. */
export function tipoDeEstadoHttp(estado: number, metodo = 'GET'): TipoErrorOp {
  if (estado === 401) return 'no-autorizado';
  if (estado === 403) return 'prohibido';
  if (estado === 404) return 'no-encontrado';
  if (estado === 409) return 'conflicto';
  if (estado === 400 || estado === 422) return 'validacion';
  if (metodo === 'POST' && (estado === 502 || estado === 504)) return 'incierto';
  return 'red';
}
