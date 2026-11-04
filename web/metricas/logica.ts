import type { Catalogo, HorasPorDia, Tarea } from '../../compartido/tipos.js';
import { fechaArgentina, rangoDias, sumarDias } from '../fechas.js';
import { columnaDeTarea, esHitoDe } from '../tareas/logica.js';

// Lógica pura de la pantalla Métricas. El período son los `periodo` días que terminan hoy;
// el anterior, los `periodo` días previos. `hoy` es 'YYYY-MM-DD' en hora argentina.

export type Periodo = 7 | 30 | 90
export interface Indicador { valor: number | null; anterior: number | null; variacion: number | null }
export interface Metricas {
  completadas: Indicador; aTiempo: Indicador; horasTrabajadas: Indicador; cicloDias: Indicador;
  ritmo: { fecha: string; actual: number; anterior: number }[];
  porProyecto: { proyectoId: number; cantidad: number; porcentaje: number }[];
  horasPorDia: { fecha: string; horas: number }[];
  realEstimado: { porPersona: FilaRealEstimado[]; porProyecto: FilaRealEstimado[] };
}

/** Lo real contra lo estimado de una persona o un proyecto, sobre sus tareas cerradas del período. */
export interface FilaRealEstimado { id: number; real: number; estimado: number; cociente: number; tareas: number }

const SEG_HORA = 3600;
const MS_DIA = 86_400_000;

const redondear = (valor: number, decimales: number): number => {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
};

/** Cierre de una tarea que no es hito, con su día argentino. */
export interface Cierre { tarea: Tarea; dia: string }

/** Conjunto de los `periodo` días que terminan hoy. */
export const diasDelPeriodo = (hoy: string, periodo: Periodo): Set<string> =>
  new Set(rangoDias(sumarDias(hoy, -(periodo - 1)), hoy));

/** Definición única de «completada»: la usan las cifras de Métricas y el CSV. */
export function cierresDe(tareas: Tarea[], catalogo: Catalogo): Cierre[] {
  const esHito = esHitoDe(catalogo);
  return tareas.flatMap((tarea) => {
    if (esHito(tarea) || columnaDeTarea(tarea, catalogo) !== 'cerrado' || tarea.cerradaEl === null) return [];
    const dia = fechaArgentina(tarea.cerradaEl);
    return dia ? [{ tarea, dia }] : [];
  });
}

const variacionPorcentual = (valor: number | null, anterior: number | null): number | null =>
  valor !== null && anterior !== null && anterior > 0 ? Math.round(((valor - anterior) / anterior) * 100) : null;

const variacionAbsoluta = (valor: number | null, anterior: number | null, decimales: number): number | null =>
  valor !== null && anterior !== null ? redondear(valor - anterior, decimales) : null;

const promedio = (valores: number[]): number | null => (valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null);

function porcentajeATiempo(cierres: Cierre[]): number | null {
  const conFin = cierres.filter((c) => c.tarea.fin !== null);
  if (conFin.length === 0) return null;
  const aTiempo = conFin.filter((c) => c.dia <= (c.tarea.fin ?? '')).length;
  return Math.round((aTiempo / conFin.length) * 100);
}

function cicloPromedio(cierres: Cierre[]): number | null {
  const dias = cierres.flatMap(({ tarea }) => {
    const ms = Date.parse(tarea.cerradaEl ?? '') - Date.parse(tarea.creada);
    return Number.isNaN(ms) ? [] : [ms / MS_DIA];
  });
  const media = promedio(dias);
  return media === null ? null : redondear(media, 1);
}

/** Agrupa las cerradas con estimación y horas trabajadas por la clave dada; el cociente es trabajado sobre estimado. */
function agruparRealEstimado(cierres: Cierre[], clave: (t: Tarea) => number | null): FilaRealEstimado[] {
  const grupos = new Map<number, { real: number; estimado: number; tareas: number }>();
  for (const { tarea } of cierres) {
    const id = clave(tarea);
    if (id === null || !tarea.estimacionHoras || !tarea.horasReales) continue;
    const grupo = grupos.get(id) ?? { real: 0, estimado: 0, tareas: 0 };
    grupos.set(id, { real: grupo.real + tarea.horasReales, estimado: grupo.estimado + tarea.estimacionHoras, tareas: grupo.tareas + 1 });
  }
  return [...grupos]
    .map(([id, g]) => ({ id, ...g, cociente: redondear(g.real / g.estimado, 2) }))
    .sort((a, b) => b.real - a.real || a.id - b.id);
}

const realContraEstimado = (cierres: Cierre[]): Metricas['realEstimado'] => ({
  porPersona: agruparRealEstimado(cierres, (t) => t.responsableId),
  porProyecto: agruparRealEstimado(cierres, (t) => t.proyectoId),
});

export function calcularMetricas(
  tareas: Tarea[], catalogo: Catalogo, horas: HorasPorDia[], periodo: Periodo, hoy: string,
): Metricas {
  const dias = rangoDias(sumarDias(hoy, -(periodo - 1)), hoy);
  const diasAnteriores = rangoDias(sumarDias(hoy, -(2 * periodo - 1)), sumarDias(hoy, -periodo));
  const delPeriodo = diasDelPeriodo(hoy, periodo);
  const delAnterior = new Set(diasAnteriores);

  const cierres = cierresDe(tareas, catalogo);
  const actuales = cierres.filter((c) => delPeriodo.has(c.dia));
  const previas = cierres.filter((c) => delAnterior.has(c.dia));

  const completadas: Indicador = {
    valor: actuales.length, anterior: previas.length, variacion: variacionPorcentual(actuales.length, previas.length),
  };
  const aTiempoActual = porcentajeATiempo(actuales);
  const aTiempoAnterior = porcentajeATiempo(previas);
  const cicloActual = cicloPromedio(actuales);
  const cicloAnterior = cicloPromedio(previas);

  const segundosPorDia = new Map<string, number>();
  for (const h of horas) segundosPorDia.set(h.dia, (segundosPorDia.get(h.dia) ?? 0) + h.segundos);
  const horasEn = (lista: string[]): number => redondear(lista.reduce((acc, d) => acc + (segundosPorDia.get(d) ?? 0), 0) / SEG_HORA, 1);
  const horasActual = horasEn(dias);
  const horasAnterior = horasEn(diasAnteriores);

  const contar = (lista: Cierre[]): Map<string, number> => {
    const cuenta = new Map<string, number>();
    for (const c of lista) cuenta.set(c.dia, (cuenta.get(c.dia) ?? 0) + 1);
    return cuenta;
  };
  const cuentaActual = contar(actuales);
  const cuentaAnterior = contar(previas);

  const porProyecto = new Map<number, number>();
  for (const { tarea } of actuales) porProyecto.set(tarea.proyectoId, (porProyecto.get(tarea.proyectoId) ?? 0) + 1);

  return {
    completadas,
    aTiempo: { valor: aTiempoActual, anterior: aTiempoAnterior, variacion: variacionAbsoluta(aTiempoActual, aTiempoAnterior, 0) },
    horasTrabajadas: { valor: horasActual, anterior: horasAnterior, variacion: variacionPorcentual(horasActual, horasAnterior) },
    cicloDias: { valor: cicloActual, anterior: cicloAnterior, variacion: variacionAbsoluta(cicloActual, cicloAnterior, 1) },
    ritmo: dias.map((fecha, i) => ({
      fecha,
      actual: cuentaActual.get(fecha) ?? 0,
      anterior: cuentaAnterior.get(diasAnteriores[i] ?? '') ?? 0,
    })),
    porProyecto: [...porProyecto]
      .map(([proyectoId, cantidad]) => ({ proyectoId, cantidad, porcentaje: Math.round((cantidad / actuales.length) * 100) }))
      .sort((a, b) => b.cantidad - a.cantidad || a.proyectoId - b.proyectoId),
    horasPorDia: dias.map((fecha) => ({ fecha, horas: (segundosPorDia.get(fecha) ?? 0) / SEG_HORA })),
    realEstimado: realContraEstimado(actuales),
  };
}
