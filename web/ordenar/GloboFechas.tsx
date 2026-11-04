import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Catalogo, Dependencia, Tarea } from '../../compartido/tipos.js';
import { calendarioDe } from '../../compartido/calendarioOp.js';
import { inicioMinimo } from '../linea/cascada.js';
import type { CambiosLinea } from '../linea/useCambiosLinea.js';
import { fechasValidas, MSG_FECHAS } from '../tareas/edicion.js';
import { columnaDeTarea, esHitoDe } from '../tareas/logica.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';

const diaMes = (fecha: string): string => `${Number(fecha.slice(8, 10))}/${Number(fecha.slice(5, 7))}`;

export interface GloboFechasProps {
  /** La tarea cuyas fechas se cambian (en una sucesora automática, la que de verdad se mueve). */
  tarea: Tarea;
  tareas: Tarea[];
  dependencias: Dependencia[];
  catalogo: Catalogo;
  cambios: Pick<CambiosLinea, 'guardar'>;
  alCerrar(): void;
  /** Id del globito: el botón que lo abrió lo señala con `aria-controls`. */
  id?: string;
}

/** Hasta cuándo no puede empezar una sucesora manual, y el título de la anterior que manda; `null` si nada la frena. */
export function topeDeInicio(
  tarea: Tarea, tareas: Tarea[], dependencias: Dependencia[], catalogo: Catalogo,
): { desde: string; anterior: string } | null {
  if (!tarea.programacionManual) return null;
  const cal = calendarioDe(catalogo);
  const cerradas = new Set(tareas.filter((t) => columnaDeTarea(t, catalogo) === 'cerrado').map((t) => t.id));
  const minimo = inicioMinimo(tarea.id, tareas, dependencias, cal, cerradas);
  if (minimo === null) return null;
  const quien = dependencias
    .filter((d) => d.sucesoraId === tarea.id)
    .find((d) => inicioMinimo(tarea.id, tareas, [d], cal, cerradas) === minimo);
  const titulo = quien === undefined ? undefined : tareas.find((t) => t.id === quien.predecesoraId)?.titulo;
  return { desde: minimo, anterior: titulo ?? 'la anterior' };
}

/** Globito con el inicio y el fin (o la única fecha de un hito). Guarda como la línea: con cascada y «Deshacer». */
export function GloboFechas({ tarea, tareas, dependencias, catalogo, cambios, alCerrar, id }: GloboFechasProps) {
  const esHito = esHitoDe(catalogo)(tarea);
  const [inicio, setInicio] = useState(tarea.inicio ?? '');
  const [fin, setFin] = useState(tarea.fin ?? '');
  const [guardando, setGuardando] = useState(false);
  const idAviso = useId();
  const primero = useRef<HTMLInputElement>(null);
  useEffect(() => primero.current?.focus(), []);

  const tope = useMemo(() => topeDeInicio(tarea, tareas, dependencias, catalogo), [tarea, tareas, dependencias, catalogo]);
  const nuevoInicio = inicio === '' ? null : inicio;
  const nuevoFin = esHito ? nuevoInicio : fin === '' ? null : fin;
  const antes = nuevoInicio !== null && tope !== null && nuevoInicio < tope.desde;
  const ordenado = esHito || fechasValidas(nuevoInicio, nuevoFin);
  const hayCambio = nuevoInicio !== tarea.inicio || nuevoFin !== tarea.fin;
  const sinFechas = nuevoInicio === null && nuevoFin === null;
  const puede = !antes && ordenado && hayCambio && !sinFechas && !guardando;
  const mensaje = antes && tope !== null
    ? `No puede empezar antes del ${diaMes(tope.desde)}, cuando termina «${tope.anterior}»`
    : !ordenado ? MSG_FECHAS : null;

  const guardar = async () => {
    if (!puede) return;
    setGuardando(true);
    try {
      const guardadas = await cambios.guardar(tarea, { inicio: nuevoInicio, fin: nuevoFin }, esHito);
      if (guardadas !== null) alCerrar();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form
      id={id}
      className="ordenar__globo"
      role="dialog"
      aria-label={`Fechas de «${tarea.titulo}»`}
      onSubmit={(e) => { e.preventDefault(); void guardar(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); alCerrar(); } }}
    >
      {esHito ? (
        <label className="ordenar__campo">
          <span>Fecha</span>
          <input ref={primero} type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} aria-describedby={mensaje ? idAviso : undefined} />
        </label>
      ) : (
        <>
          <label className="ordenar__campo">
            <span>Inicio</span>
            <input ref={primero} type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} aria-describedby={mensaje ? idAviso : undefined} />
          </label>
          <label className="ordenar__campo">
            <span>Fin</span>
            <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
          </label>
        </>
      )}
      {mensaje && <Aviso tipo="error"><span id={idAviso}>{mensaje}</span></Aviso>}
      <div className="ordenar__globo-botones">
        <Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="primario" type="submit" disabled={!puede}>Guardar</Boton>
      </div>
    </form>
  );
}
