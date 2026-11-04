import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

// Borradores del panel de detalle (título, descripción, comentario): antes de cerrar el panel se
// pregunta qué hacer con lo escrito en lugar de perderlo.

export interface Borrador {
  /** `true` si hay algo escrito sin guardar (también una «Tu versión» pendiente). */
  sucio(): boolean;
  /** Intenta guardarlo; `true` si quedó guardado. */
  guardar(): Promise<boolean>;
  descartar(): void;
  enfocar(): void;
}

export interface Borradores {
  registrar(clave: string, borrador: Borrador): () => void;
  /** Suma algo que esperar (escrituras en curso, un comentario en camino) antes de decidir si hay algo sin guardar. */
  registrarEspera(esperar: () => Promise<unknown>): () => void;
  /** Muestra «Tenés cambios sin guardar» para `claves` (o todas); con `cerrar`, cierra al terminar. */
  preguntar(claves: string[] | null, cerrar: boolean): void;
}

export const ContextoBorradores = createContext<Borradores | null>(null);

/** Registra el borrador de un campo mientras está montado, siempre con las funciones del último render. */
export function useBorrador(clave: string, borrador: Borrador): void {
  const contexto = useContext(ContextoBorradores);
  const ultimo = useRef(borrador);
  useLayoutEffect(() => {
    ultimo.current = borrador;
  });
  useEffect(() => contexto?.registrar(clave, {
    sucio: () => ultimo.current.sucio(),
    guardar: () => ultimo.current.guardar(),
    descartar: () => ultimo.current.descartar(),
    enfocar: () => ultimo.current.enfocar(),
  }), [contexto, clave]);
}

/** Da a conocer las escrituras en curso: cerrar el panel las espera antes de ver qué quedó sin guardar. */
export function useEsperaDeEscrituras(esperar: () => Promise<unknown>): void {
  const contexto = useContext(ContextoBorradores);
  useEffect(() => contexto?.registrarEspera(esperar), [contexto, esperar]);
}

/** Pregunta por lo escrito de un campo sin cerrar el panel (Escape en el editor de la descripción). */
export function usePreguntarPorBorrador(): (claves: string[]) => void {
  const contexto = useContext(ContextoBorradores);
  return (claves) => contexto?.preguntar(claves, false);
}

/** Atributo de lo que no hace guardar al título cuando le llega el foco (la pregunta, el cerrar). */
export const CONSERVA_BORRADOR = 'data-conserva-borrador';

/** Sale del foco hacia algo que no tiene que disparar el guardado al salir. */
export function vaHaciaConservar(destino: EventTarget | null): boolean {
  return destino instanceof Element && destino.closest(`[${CONSERVA_BORRADOR}]`) !== null;
}

/** Escape con algo sin guardar lo descarta y no cierra el panel. */
export function escapeDescarta(evento: KeyboardEvent, sucio: boolean, descartar: () => void): void {
  if (evento.key !== 'Escape' || !sucio) return;
  evento.preventDefault();
  descartar();
}

/** Estado con una copia en ref: lo leen funciones que corren después de un `await`, antes del próximo render. */
export function useEstadoVivo<T>(inicial: T): [T, (valor: T) => void, { readonly current: T }] {
  const [valor, setValor] = useState(inicial);
  const ref = useRef(inicial);
  const poner = (nuevo: T) => {
    ref.current = nuevo;
    setValor(nuevo);
  };
  return [valor, poner, ref];
}
