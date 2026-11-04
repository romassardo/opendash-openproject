import ICAL from 'ical.js';
import { instanteArgentino, sumarDias } from '../../compartido/fechas.js';
import type { Reunion, VentanaFechas } from '../../compartido/tipos.js';
import { enlaceParaUnirse } from './enlaces.js';

export class ErrorIcs extends Error {}

const TOPE_OCURRENCIAS = 2000;            // por serie, contando desde el inicio de la ventana
const TOPE_ITERACIONES = 50_000;           // por serie, contando también las anteriores a la ventana
const MARGEN_MS = 86_400_000;               // las ocurrencias que empiezan un día antes todavía pueden tocar la ventana

const texto = (comp: ICAL.Component, nombre: string): string => {
  const valor = comp.getFirstPropertyValue(nombre);
  return typeof valor === 'string' ? valor.trim() : '';
};

/** Instante de un valor del ICS; las fechas sueltas y las horas flotantes valen hora argentina. */
function aInstante(t: ICAL.Time): Date {
  const dos = (n: number) => String(n).padStart(2, '0');
  const dia = `${String(t.year).padStart(4, '0')}-${dos(t.month)}-${dos(t.day)}`;
  if (t.isDate) return instanteArgentino(dia);
  if (t.zone.tzid === 'floating') return new Date(`${dia}T${dos(t.hour)}:${dos(t.minute)}:${dos(t.second)}-03:00`);
  return t.toJSDate();
}

export type AvisoIcs = 'evento-salteado' | 'serie-cortada';

/** Un texto puede traer varios VCALENDAR seguidos: ICAL.parse devuelve entonces una lista de jCal. */
function parsear(contenido: string): ICAL.Component[] {
  try {
    const jcal = ICAL.parse(contenido) as unknown[];
    const lista = Array.isArray(jcal[0]) ? (jcal as unknown[][]) : [jcal];
    const raices = lista.map((j) => new ICAL.Component(j as unknown[]));
    if (raices.length === 0 || raices.some((r) => r.name !== 'vcalendar')) throw new Error('no es un VCALENDAR');
    return raices;
  } catch (error) {
    throw new ErrorIcs('El texto no es un calendario iCalendar válido.', { cause: error });
  }
}

function registrarZonas(raices: ICAL.Component[]): void {
  ICAL.TimezoneService.reset();
  for (const vtz of raices.flatMap((r) => r.getAllSubcomponents('vtimezone'))) {
    const tzid = texto(vtz, 'tzid');
    if (tzid) ICAL.TimezoneService.register(new ICAL.Timezone({ component: vtz, tzid }));
  }
}

const cancelado = (comp: ICAL.Component): boolean => texto(comp, 'status').toUpperCase() === 'CANCELLED';

function esLibre(comp: ICAL.Component): boolean {
  const ocupacion = texto(comp, 'x-microsoft-cdo-busystatus').toUpperCase();
  return ocupacion ? ocupacion === 'FREE' : texto(comp, 'transp').toUpperCase() === 'TRANSPARENT';
}

function armarReunion(item: ICAL.Event, inicio: ICAL.Time, fin: ICAL.Time): Reunion {
  const comp = item.component;
  const desde = aInstante(inicio).toISOString();
  const lugar = texto(comp, 'location');
  const unirse = enlaceParaUnirse(lugar || null, texto(comp, 'description') || null);
  return {
    id: `${item.uid}:${desde}`,
    titulo: texto(comp, 'summary') || 'Sin título',
    lugar: lugar || null,
    inicio: desde,
    fin: aInstante(fin).toISOString(),
    diaEntero: inicio.isDate || texto(comp, 'x-microsoft-cdo-alldayevent').toUpperCase() === 'TRUE',
    libre: esLibre(comp),
    enlace: unirse?.enlace ?? null,
    plataforma: unirse?.plataforma ?? null,
  };
}

/** Las reuniones del ICS que tocan la ventana (días argentinos, inclusive), ordenadas por inicio. Un evento defectuoso se saltea. */
export function leerIcs(contenido: string, ventana: VentanaFechas, alAviso?: (aviso: AvisoIcs) => void): Reunion[] {
  const raices = parsear(contenido);
  registrarZonas(raices);
  const desde = instanteArgentino(ventana.desde).getTime();
  const hasta = instanteArgentino(sumarDias(ventana.hasta, 1)).getTime();
  const resultado: Reunion[] = [];

  const agregar = (item: ICAL.Event, inicio: ICAL.Time, fin: ICAL.Time): void => {
    if (cancelado(item.component)) return;
    const reunion = armarReunion(item, inicio, fin);
    const t0 = Date.parse(reunion.inicio);
    const t1 = Date.parse(reunion.fin);
    if (Number.isNaN(t0) || Number.isNaN(t1)) throw new Error('fecha inválida');
    if (t0 < hasta && (t1 > desde || (t1 === t0 && t0 >= desde))) resultado.push(reunion);
  };

  // Un evento que no se puede leer no anula el resto del calendario.
  const seguro = (leer: () => void): void => {
    try { leer(); } catch { alAviso?.('evento-salteado'); }
  };

  const expandir = (maestro: ICAL.Event): void => {
    const iterador = maestro.iterator();
    let contadas = 0;
    for (let n = 0; n < TOPE_ITERACIONES && contadas < TOPE_OCURRENCIAS; n += 1) {
      const ocurrencia = iterador.next();
      if (!ocurrencia) return;
      const inicio = aInstante(ocurrencia).getTime();
      if (inicio >= hasta) return;
      if (inicio < desde - MARGEN_MS) continue;
      contadas += 1;
      const detalle = maestro.getOccurrenceDetails(ocurrencia);
      seguro(() => agregar(detalle.item, detalle.startDate, detalle.endDate));
    }
    alAviso?.('serie-cortada');   // salió por un tope, no porque la serie terminara o pasara la ventana
  };

  const maestros = new Map<string, ICAL.Event>();
  const excepciones: ICAL.Event[] = [];
  for (const comp of raices.flatMap((r) => r.getAllSubcomponents('vevent'))) {
    seguro(() => {
      const e = new ICAL.Event(comp);
      if (e.isRecurrenceException()) excepciones.push(e);
      else maestros.set(e.uid, e);
    });
  }

  for (const e of excepciones) {
    seguro(() => {
      const maestro = maestros.get(e.uid);
      if (maestro) maestro.relateException(e);
      else agregar(e, e.startDate, e.endDate);   // excepción sin su serie: vale sola
    });
  }

  for (const maestro of maestros.values()) {
    seguro(() => {
      if (cancelado(maestro.component)) return;
      if (maestro.isRecurring()) expandir(maestro);
      else agregar(maestro, maestro.startDate, maestro.endDate);
    });
  }

  return resultado.sort((a, b) => a.inicio.localeCompare(b.inicio));
}
