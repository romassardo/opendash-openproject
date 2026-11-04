import { useEffect, useId, useRef, useState } from 'react';
import type { Catalogo, Dependencia, Tarea } from '../../compartido/tipos.js';
import { unir } from '../ui/clases.js';
import { conflictos } from './cadena.js';
import type { Fila } from './filas.js';
import { altoDeFilas, ALTO_RENGLON, anchoVisual } from './medidas.js';
import { puntoMedio, trazoLibre, trazoUnion, type Punto } from './trazos.js';

const MS_ESCONDER = 400;

export interface FlechasProps {
  filas: readonly Fila[];
  /** Borde superior de cada fila (de `topesDeFilas`). */
  topes: readonly number[];
  tareas: Tarea[];
  dependencias: Dependencia[];
  /** Ancho de la pista en píxeles. */
  ancho: number;
  /** Ids de la cadena enfocada; `null` si no hay foco. */
  catalogo: Catalogo;
  enfoque: ReadonlySet<number> | null;
  /** Curva en vuelo mientras se arrastra un puntito para unir. */
  temporal?: { sale: Punto; entra: Punto } | null;
  /** Suelta una unión; sin él las flechas no ofrecen la ×. */
  alSoltar?: (d: Dependencia) => void;
}

export interface Anclaje { entra: number; sale: number; y: number }

/** Dónde entran y salen las flechas de cada barra, calculado desde las filas sin medir el DOM. */
export function anclajes(filas: readonly Fila[], topes: readonly number[]): Map<number, Anclaje> {
  const mapa = new Map<number, Anclaje>();
  filas.forEach((fila, i) => {
    // Una terminada fuera de la ventana no tiene barra: su marca de borde no lleva flechas.
    if ((fila.tipo !== 'tarea' && fila.tipo !== 'grupo') || fila.barra === null || fila.barra.fuera !== null) return;
    if (fila.tipo === 'grupo' && fila.ajena) return;
    const { barra } = fila;
    const centro = barra.x + barra.ancho / 2;
    const y = topes[i]! + ALTO_RENGLON / 2;
    mapa.set(fila.tarea.id, barra.esHito ? { entra: centro - 9, sale: centro + 8, y } : { entra: barra.x - 2, sale: barra.x + anchoVisual(barra.ancho), y });
  });
  return mapa;
}

/** Una curva por dependencia, del fin de la predecesora al inicio de la sucesora. */
export function Flechas({ filas, topes, tareas, dependencias, catalogo, ancho, enfoque, temporal = null, alSoltar }: FlechasProps) {
  const id = useId();
  const puntos = anclajes(filas, topes);
  const enConflicto = conflictos(tareas, dependencias, catalogo);
  const alto = altoDeFilas(filas);
  const [activa, setActiva] = useState<number | null>(null);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelar = () => {
    if (reloj.current !== null) { clearTimeout(reloj.current); reloj.current = null; }
  };
  const entrar = (depId: number) => { cancelar(); setActiva(depId); };
  const salir = () => { cancelar(); reloj.current = setTimeout(() => setActiva(null), MS_ESCONDER); };
  useEffect(() => cancelar, []);
  const titulo = (tareaId: number) => tareas.find((t) => t.id === tareaId)?.titulo ?? '';
  const elegida = alSoltar ? dependencias.find((d) => d.id === activa) : undefined;
  const desdeE = elegida ? puntos.get(elegida.predecesoraId) : undefined;
  const hastaE = elegida ? puntos.get(elegida.sucesoraId) : undefined;
  const medio = desdeE && hastaE ? puntoMedio({ x: desdeE.sale, y: desdeE.y }, { x: hastaE.entra, y: hastaE.y }) : null;
  return (
    <>
      <svg className="flechas" width={ancho} height={alto} aria-hidden="true">
        <defs>
          <marker id={`${id}-punta`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path className="flecha__punta" d="M0,0 L10,5 L0,10 z" />
          </marker>
          <marker id={`${id}-punta-roja`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path className="flecha__punta flecha__punta--conflicto" d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        {dependencias.map((d) => {
          const desde = puntos.get(d.predecesoraId);
          const hasta = puntos.get(d.sucesoraId);
          if (!desde || !hasta) return null;
          const malo = enConflicto.has(d.id);
          const enCadena = enfoque !== null && enfoque.has(d.predecesoraId) && enfoque.has(d.sucesoraId);
          const trazo = trazoUnion({ x: desde.sale, y: desde.y }, { x: hasta.entra, y: hasta.y }, ALTO_RENGLON);
          return (
            <g
              key={d.id}
              data-de={d.predecesoraId}
              data-a={d.sucesoraId}
              onMouseEnter={alSoltar ? () => entrar(d.id) : undefined}
              onMouseLeave={alSoltar ? salir : undefined}
            >
              <path
                className={unir('flecha', malo && 'flecha--conflicto', enCadena && 'flecha--en-cadena')}
                d={trazo}
                markerEnd={`url(#${id}-${malo ? 'punta-roja' : 'punta'})`}
                strokeDasharray={malo ? '5 4' : undefined}
              />
              {alSoltar && <path className="flecha__zona" d={trazo} />}
            </g>
          );
        })}
        {temporal && <path className="flecha flecha--temporal" d={trazoLibre(temporal.sale, temporal.entra)} />}
      </svg>
      {elegida && medio && (
        <button
          type="button"
          className="flecha__soltar"
          style={{ left: medio.x, top: medio.y }}
          aria-label={`Soltar la unión de «${titulo(elegida.predecesoraId)}» a «${titulo(elegida.sucesoraId)}»`}
          onMouseEnter={() => entrar(elegida.id)}
          onMouseLeave={salir}
          onClick={() => { cancelar(); setActiva(null); alSoltar?.(elegida); }}
        >
          ×
        </button>
      )}
    </>
  );
}
