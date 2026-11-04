import type { Reunion } from './tipos.js';

/** Semanas que mira la carga del equipo (el servidor las calcula y la web arma el «mes» con ellas). */
export const SEMANAS_CARGA_MAXIMAS = 4;

/** Cuenta como reunión la que tiene horario (no es de día entero) y no está marcada «libre». */
export const cuentaComoReunion = (r: Reunion): boolean => !r.diaEntero && !r.libre;

/** Está en curso la reunión que cuenta y ya empezó sin haber terminado (inicio ≤ ahora < fin). */
export const enCurso = (r: Reunion, ahora: Date): boolean => {
  const momento = ahora.getTime();
  return cuentaComoReunion(r) && Date.parse(r.inicio) <= momento && momento < Date.parse(r.fin);
};
