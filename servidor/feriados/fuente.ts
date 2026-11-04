import { z } from 'zod';
import { esFechaValida } from '../../compartido/fechas.js';

export interface FeriadoLista { fecha: string; nombre: string; puente: boolean }

const TIMEOUT_MS = 10_000;
const MAX_NOMBRE = 80;
const esquema = z.array(z.object({ fecha: z.string(), tipo: z.string(), nombre: z.string() }));

/** Trae los feriados de un año de ArgentinaDatos. Lanza si no responde 200 o la forma no es la esperada. */
export async function leerFeriadosDelAnio(baseUrl: string, anio: number, fetchFn: typeof fetch = fetch): Promise<FeriadoLista[]> {
  const respuesta = await fetchFn(`${baseUrl}/${anio}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (respuesta.status !== 200) throw new Error(`feriados: respuesta ${respuesta.status}`);
  const crudo = esquema.safeParse(await respuesta.json());
  if (!crudo.success) throw new Error('feriados: la respuesta no tiene la forma esperada');
  return crudo.data.map((f) => {
    if (!esFechaValida(f.fecha) || !f.fecha.startsWith(`${anio}-`)) throw new Error('feriados: fecha fuera del año pedido');
    const nombre = f.nombre.trim().slice(0, MAX_NOMBRE).trim() || 'Feriado';
    return { fecha: f.fecha, nombre, puente: f.tipo === 'puente' };
  });
}
