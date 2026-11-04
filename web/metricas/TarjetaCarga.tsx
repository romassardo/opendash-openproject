import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { intervaloCarga, totalesCarga, type IntervaloCarga, type PeriodoCarga, type TareaLarga } from '../equipo/carga.js';
import type { IntegranteEquipo } from '../equipo/equipo.js';
import { BarraCarga } from '../graficos/BarraCarga.js';
import { numeroEs } from '../graficos/geometria.js';
import { diaMesCorto, diasEntre, mesDe, sumarDias } from '../fechas.js';
import { Avatar } from '../ui/Avatar.js';
import { Pildora } from '../ui/Pildora.js';
import { Segmentado } from '../ui/Segmentado.js';
import { Vidrio } from '../ui/Vidrio.js';
import { plural } from '../ui/plural.js';

const OPCIONES_PERIODO: { valor: PeriodoCarga; etiqueta: string }[] = [
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'quincena', etiqueta: 'Quincena' },
  { valor: 'mes', etiqueta: 'Mes' },
];

const QUE_CUBRE: Record<PeriodoCarga, string> = {
  semana: 'esta semana',
  quincena: 'esta semana y la próxima',
  mes: 'las próximas 4 semanas',
};

/**
 * Días hábiles del período, de lunes a viernes: «19 – 23 oct» dentro del mismo mes, «19 oct – 13 nov» si cruza.
 * Solo es lo que se muestra: una tarea con fecha de sábado o domingo sigue contando en su semana.
 */
function rangoHabil({ desde, hasta }: IntervaloCarga): string {
  const viernes = sumarDias(hasta, -2);
  return `${mesDe(desde) === mesDe(viernes) ? Number(desde.slice(8)) : diaMesCorto(desde)} – ${diaMesCorto(viernes)}`;
}

const formatoDiaSemana = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: 'UTC' });

/** « · feriado el lunes» en la semana, « · feriado el 9 nov» en los otros períodos, « · 2 feriados» con varios. */
function tramoFeriados(feriados: string[], periodo: PeriodoCarga): string {
  const [unico] = feriados;
  if (unico === undefined) return '';
  if (feriados.length > 1) return ` · ${feriados.length} feriados`;
  return ` · feriado el ${periodo === 'semana' ? formatoDiaSemana.format(new Date(`${unico}T00:00:00Z`)) : diaMesCorto(unico)}`;
}

/** «5 – 9 ene» dentro del mismo mes, «28 dic – 9 ene» si cruza. */
const rangoVacaciones = ({ desde, hasta }: { desde: string; hasta: string }): string =>
  `${mesDe(desde) === mesDe(hasta) ? Number(desde.slice(8)) : diaMesCorto(desde)} – ${diaMesCorto(hasta)}`;

/** Debajo del nombre: el rol, las vacaciones del período y, con la opción, las horas de reuniones. */
function detalleFila(i: IntegranteEquipo, restarReuniones: boolean): string {
  const partes = [i.rol || i.persona.login || ''];
  if (i.ajuste.vacaciones.length > 0) partes.push(`de vacaciones ${i.ajuste.vacaciones.map(rangoVacaciones).join(', ')}`);
  if (restarReuniones) {
    if (i.ajuste.sinCalendario) partes.push('sin calendario');
    else if (i.ajuste.horasReunion !== null) partes.push(`${numeroEs(i.ajuste.horasReunion)} h de reuniones`);
  }
  return partes.filter((p) => p !== '').join(' · ');
}

const textoLibres = (libres: number): string => (libres < 0 ? `${numeroEs(-libres)} h de más` : `${numeroEs(libres)} h libres`);

/** Fracción (0 a 1) del tramo de la tarea que ya pasó a `hoy`. */
const avanceDelTramo = (larga: TareaLarga, hoy: string): number => {
  const total = diasEntre(larga.inicio, larga.fin);
  return total > 0 ? Math.min(1, Math.max(0, diasEntre(larga.inicio, hoy) / total)) : 1;
};

function TramoLargo({ larga, hoy }: { larga: TareaLarga; hoy: string }) {
  const avance = `${avanceDelTramo(larga, hoy) * 100}%`;
  return (
    <li className="carga-larga">
      <p className="carga-larga__cabeza">
        <span className="carga-larga__titulo">{larga.titulo}</span>
        <span className="carga-larga__fechas tnum">{`${diaMesCorto(larga.inicio)} – ${diaMesCorto(larga.fin)}`}</span>
      </p>
      <div className="carga-larga__tramo" aria-hidden="true">
        <span className="carga-larga__pasado" style={{ width: avance }} />
        <span className="carga-larga__hoy" style={{ left: avance }} />
      </div>
      <p className="carga-larga__semana tnum">
        {`semana ${larga.semanaActual} de ${larga.semanasTotales} · ${numeroEs(larga.horasSemana)} h por semana`}
      </p>
    </li>
  );
}

export interface TarjetaCargaProps {
  /** Con la carga ya calculada para `periodo`. */
  integrantes: IntegranteEquipo[];
  hoy: string;
  periodo: PeriodoCarga;
  /** Los feriados de lunes a viernes del período. */
  feriados: string[];
  restarReuniones: boolean;
  onCambioPeriodo(periodo: PeriodoCarga): void;
}

/** Horas del período de cada persona contra su capacidad; tocar la fila despliega sus tareas largas. */
export function TarjetaCarga({ integrantes, hoy, periodo, feriados, restarReuniones, onCambioPeriodo }: TarjetaCargaProps) {
  const [abiertas, setAbiertas] = useState<ReadonlySet<number>>(new Set());
  const excedidos = integrantes.filter((i) => i.carga.excedida).length;
  const tareasAbiertas = integrantes.reduce((total, i) => total + i.carga.abiertas, 0);
  const totales = totalesCarga(integrantes.map((i) => i.carga));

  const alternar = (id: number) =>
    setAbiertas((previas) => {
      const siguientes = new Set(previas);
      if (!siguientes.delete(id)) siguientes.add(id);
      return siguientes;
    });

  return (
    <Vidrio as="section" className="metricas__carga" aria-labelledby="metricas-carga">
      <header className="metricas__cabeza">
        <div>
          <h2 id="metricas-carga" className="tarjeta__titulo">Carga</h2>
          <p className="tarjeta__sub">{`Horas estimadas de ${QUE_CUBRE[periodo]} (${rangoHabil(intervaloCarga(hoy, periodo))}${tramoFeriados(feriados, periodo)}) contra la capacidad${restarReuniones ? ' menos reuniones' : ''}`}</p>
        </div>
        <Segmentado etiqueta="Período de la carga" tamano="chico" opciones={OPCIONES_PERIODO} valor={periodo} onCambio={onCambioPeriodo} />
      </header>
      <div className="carga-total">
        <p className="carga-total__quien">{`Todo el equipo · ${plural(integrantes.length, 'persona', 'personas')}`}</p>
        <ul className="carga-total__cifras tnum" aria-label="Total del equipo">
          <li><b>{numeroEs(totales.horas)} h</b> asignadas</li>
          <li><b>{numeroEs(totales.capacidad)} h</b> de capacidad</li>
          <li className="carga-total__libres"><b>{numeroEs(totales.libres)} h</b> libres</li>
        </ul>
      </div>
      <div className="carga-pie">
        <p className="tarjeta__sub tnum">{plural(tareasAbiertas, 'tarea abierta', 'tareas abiertas')}</p>
        <Pildora color={excedidos > 0 ? 'var(--carga-excedida)' : 'var(--carga-ok)'}>
          {excedidos > 0 ? `${excedidos} por encima de su capacidad` : 'Todos dentro de su capacidad'}
        </Pildora>
      </div>
      <ul className="carga-lista">
        {integrantes.map((i) => {
          const abierta = abiertas.has(i.persona.id);
          return (
            <li key={i.persona.id} className="carga-fila" data-abierta={abierta ? 'true' : undefined}>
              <button type="button" className="carga-fila__persona" aria-expanded={abierta} onClick={() => alternar(i.persona.id)}>
                <Avatar persona={i.persona} tamano={36} />
                <span className="carga-fila__texto">
                  <b>{i.persona.nombre}</b>
                  <small>{detalleFila(i, restarReuniones)}</small>
                </span>
                <ChevronDown className="carga-fila__flecha" size={16} aria-hidden="true" />
              </button>
              <div className="carga-fila__barra">
                <BarraCarga horas={i.carga.horas} capacidad={i.carga.capacidad} />
                <p className="carga-fila__numeros tnum">
                  <small>{`${numeroEs(i.carga.horas)} h / ${numeroEs(i.carga.capacidad)} h`}</small>
                  <small className="carga-fila__libres" data-excedida={i.carga.excedida ? 'true' : undefined}>
                    {textoLibres(i.carga.capacidad - i.carga.horas)}
                  </small>
                </p>
              </div>
              {abierta && (
                i.carga.largas.length > 0 ? (
                  <ul className="carga-largas">
                    {i.carga.largas.map((l) => <TramoLargo key={l.tareaId} larga={l} hoy={hoy} />)}
                  </ul>
                ) : (
                  <p className="carga-largas carga-largas--vacio tarjeta__sub">Sin tareas largas.</p>
                )
              )}
            </li>
          );
        })}
      </ul>
    </Vidrio>
  );
}
