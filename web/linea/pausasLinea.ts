import type { Partes } from '../../compartido/pausas.js';
import { diaMesCorto, diasEntre, sumarDias } from '../fechas.js';
import type { Ventana } from './modelo.js';

// Las pausas sobre la barra: los huecos (en px, desde el borde izquierdo de la barra) y su texto. Todo puro.

export interface HuecoBarra { izquierda: number; ancho: number }

/** Lo que no es trabajo entre el inicio y el fin: entre dos tramos de trabajo, y después del último si el fin cae en una pausa. */
function huecosEnFechas(partes: Partes, fin: string): { desde: string; hasta: string }[] {
  const { trabajo } = partes;
  const huecos = trabajo.slice(1).map((t, i) => ({ desde: sumarDias(trabajo[i]!.hasta, 1), hasta: sumarDias(t.desde, -1) }));
  const ultimo = trabajo.at(-1);
  if (ultimo !== undefined && ultimo.hasta < fin && partes.pausas.length > 0) huecos.push({ desde: sumarDias(ultimo.hasta, 1), hasta: fin });
  return huecos;
}

/** Los huecos de la barra en px, recortados a lo que se ve de ella. */
export function huecosDeBarra(
  partes: Partes, fin: string, ventana: Pick<Ventana, 'desde' | 'pxPorDia'>, barra: { x: number; ancho: number },
): HuecoBarra[] {
  const x = (fecha: string): number => diasEntre(ventana.desde, fecha) * ventana.pxPorDia - barra.x;
  return huecosEnFechas(partes, fin).flatMap((h) => {
    const izquierda = Math.max(0, x(h.desde));
    const derecha = Math.min(barra.ancho, x(h.hasta) + ventana.pxPorDia);
    return derecha > izquierda ? [{ izquierda, ancho: derecha - izquierda }] : [];
  });
}

/** Máscara que vuelve transparentes los huecos de la barra (con su borde y su relleno); `undefined` sin huecos. */
export function mascaraDeHuecos(huecos: readonly HuecoBarra[]): string | undefined {
  if (huecos.length === 0) return undefined;
  const cortes = huecos.map((h) => `#000 ${h.izquierda}px, transparent ${h.izquierda}px ${h.izquierda + h.ancho}px, #000 ${h.izquierda + h.ancho}px`);
  return `linear-gradient(90deg, #000 0, ${cortes.join(', ')})`;
}

/** «en pausa del 5 nov al 6 nov y el 12 nov», para el título y la etiqueta de la barra; `null` sin pausas. */
export function textoPausas(partes: Partes | null): string | null {
  if (partes === null || partes.pausas.length === 0) return null;
  const rangos = partes.pausas.map((p) => (p.desde === p.hasta ? `el ${diaMesCorto(p.desde)}` : `del ${diaMesCorto(p.desde)} al ${diaMesCorto(p.hasta)}`));
  const lista = rangos.length === 1 ? rangos[0] : `${rangos.slice(0, -1).join(', ')} y ${rangos.at(-1)}`;
  return `en pausa ${lista}`;
}
