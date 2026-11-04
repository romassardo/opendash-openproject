import type { Fila } from './filas.js';

// Medidas de la línea de tiempo (boceto B): un renglón por tarea, la lista a la izquierda y las barras a la derecha.
/** Ancho de la lista de nombres, fija a la izquierda. */
export const ANCHO_LISTA = 340;
export const ALTO_RENGLON = 34;
/** Franja de persona o proyecto: 44 px más 12 px de aire arriba. */
export const ALTO_ENCABEZADO = 56;
export const ALTO_PROYECTO = 30;
export const ALTO_TERMINADAS = 30;
export const ALTO_BARRA = 26;
/** Sangría de la lista por cada nivel de grupo. */
export const SANGRIA = 20;

const altoDe = (fila: Fila): number => {
  switch (fila.tipo) {
    case 'encabezado': return ALTO_ENCABEZADO;
    case 'proyecto': return ALTO_PROYECTO;
    case 'terminadas': return ALTO_TERMINADAS;
    default: return ALTO_RENGLON;
  }
};

/** Borde superior de cada fila, medido desde el comienzo del cuerpo. */
export function topesDeFilas(filas: readonly Fila[]): number[] {
  let arriba = 0;
  return filas.map((fila) => {
    const tope = arriba;
    arriba += altoDe(fila);
    return tope;
  });
}

/** Alto total de las filas. */
export const altoDeFilas = (filas: readonly Fila[]): number => filas.reduce((suma, fila) => suma + altoDe(fila), 0);

/** Una barra nunca se ve más angosta que esto, aunque el zoom la achique. */
export const ANCHO_MINIMO_BARRA = 10;
/** Debajo de este ancho la barra no alcanza para el avatar: queda solo de color. */
export const ANCHO_PARA_AVATAR = 36;
/** Ancho visual de una barra: el de las fechas, con el mínimo legible. */
export const anchoVisual = (ancho: number): number => Math.max(ANCHO_MINIMO_BARRA, ancho);
/** Una barra más corta que esto solo se mueve: no lleva bordes para estirar. */
export const ANCHO_PARA_ESTIRAR = 24;
/** Relleno del texto de horas dentro de la barra: si no entra con este margen, va afuera. */
export const MARGEN_HORAS = 14;
/** Ancho aproximado de un carácter del texto de horas (12 px). */
export const PX_POR_CARACTER_HORAS = 7;
/** Distancia entre el final de la barra y las horas cuando van afuera. */
export const SEPARACION_HORAS = 10;
/** ¿Entra el texto de horas dentro de una barra de ese ancho? */
export const entranHoras = (ancho: number, texto: string): boolean => ancho >= texto.length * PX_POR_CARACTER_HORAS + MARGEN_HORAS;

/** Pausa entre barras de la entrada escalonada: 0,05 s, pero el total no pasa de 0,6 s aunque haya muchas barras. */
export const ESCALONADO_ENTRADA = 0.05;
export const TOPE_ESCALONADO_ENTRADA = 0.6;
export const escalonadoDe = (cantidad: number): number => Math.min(ESCALONADO_ENTRADA, TOPE_ESCALONADO_ENTRADA / Math.max(1, cantidad));
