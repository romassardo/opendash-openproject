import { gsap } from 'gsap';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { OrdenLinea } from '../../compartido/linea.js';
import type { EstiloProyecto } from '../../compartido/estilos.js';
import { calendarioDe } from '../../compartido/calendarioOp.js';
import { partesDe, type PausasPorTarea } from '../../compartido/pausas.js';
import type { Catalogo, Dependencia, Tarea } from '../../compartido/tipos.js';
import { movimientoReducido } from '../animaciones/entradas.js';
import { diasEntre } from '../fechas.js';
import { tonoPara } from '../ui/tonos.js';
import { Vidrio } from '../ui/Vidrio.js';
import type { Tramo } from './ausencias.js';
import { anterioresEnConflicto, cadena } from './cadena.js';
import type { ContextoLinea } from './contextoLinea.js';
import { EncabezadoFechas } from './EncabezadoFechas.js';
import type { Fila } from './filas.js';
import { anclajes, Flechas } from './Flechas.js';
import { InfoCadena } from './InfoCadena.js';
import { ANCHO_LISTA, altoDeFilas, escalonadoDe, topesDeFilas } from './medidas.js';
import { marcasDe, noLaborablesEnVentana, type Ventana, type Zoom } from './modelo.js';
import { RenglonEncabezado } from './RenglonEncabezado.js';
import { RenglonGrupo } from './RenglonGrupo.js';
import { RenglonProyecto } from './RenglonProyecto.js';
import { RenglonTerminadas } from './RenglonTerminadas.js';
import { RenglonTarea } from './RenglonTarea.js';
import type { CambiosLinea } from './useCambiosLinea.js';
import { useDesplazarVentana, type AlDesplazar } from './useDesplazarVentana.js';
import { useOrdenar } from './useOrdenar.js';
import { useUnir } from './useUnir.js';
import './linea.css';

export interface LineaDeTiempoProps {
  filas: Fila[];
  ventana: Ventana;
  zoom: Zoom;
  tareas: Tarea[];
  dependencias: Dependencia[];
  catalogo: Catalogo;
  hoy: string;
  alAbrir: (tareaId: number) => void;
  /** Estilo elegido para cada proyecto; sin él, el tono sale del id. */
  estilos?: Record<number, EstiloProyecto>;
  /** Con él las barras se mueven y se estiran; sin él la línea es de solo lectura. */
  cambios?: CambiosLinea;
  /** Feriados dentro de la ventana, por fecha. */
  feriados: Map<string, string>;
  /** Tramos de vacaciones de cada persona. */
  vacaciones: Map<number, Tramo[]>;
  alternarGrupo: (id: number) => void;
  /** Muestra u oculta las terminadas de una franja. */
  alternarTerminadas: (franja: string) => void;
  /** Lleva la ventana hasta `fecha` (la marca de una terminada fuera de la ventana). */
  irAFecha?: (fecha: string) => void;
  /** Orden guardado de cada contenedor; sin él se ordena desde el orden inicial. */
  orden?: OrdenLinea;
  /** Abre el alta de una tarea en un proyecto (y dentro de una madre); sin él no hay «+» en los renglones. */
  alCrear?: (proyectoId: number, madreId: number | null) => void;
  /** Tarea recién creada: su barra se resalta y se lleva el foco, lista para moverla. */
  recien?: number | null;
  /** Pausas de cada tarea: sus barras se cortan en cada una. */
  pausas?: PausasPorTarea;
  /** Corre la ventana al arrastrar el fondo a los costados; sin él el fondo no se arrastra. */
  alDesplazar?: AlDesplazar;
  /** Sin filas, lo que dice la pista vacía (que se sigue pudiendo arrastrar). */
  mensajeVacia?: string;
}

/** Alto de la pista vacía: deja lugar para agarrarla y arrastrar. */
const ALTO_SIN_TAREAS = 160;

// Piezas de «medidas.md»: suben 12 px y aparecen con power4.out en 0,55 s, escalonadas ~0,05 s (con tope total, ver `escalonadoDe`).
const ENTRADA_BARRA = { y: 12, duracion: 0.55 };

const ESTADOS = [
  { clave: 'nuevo', nombre: 'Nuevo' },
  { clave: 'curso', nombre: 'En curso' },
  { clave: 'pausa', nombre: 'En pausa' },
  { clave: 'cerrado', nombre: 'Cerrado' },
] as const;

/** En Por persona los encabezados son personas (o «Sin asignar»): ahí los renglones no llevan marcador de persona. */
const esPorPersona = (filas: readonly Fila[]): boolean =>
  filas.some((f) => f.tipo === 'encabezado' && (f.clave.startsWith('persona-') || f.clave === 'sin-asignar'));

/** Línea de tiempo: la lista de tareas a la izquierda, sus barras a la derecha y las flechas de dependencia. */
export function LineaDeTiempo({
  filas, ventana, zoom, tareas, dependencias, catalogo, hoy, alAbrir, estilos = {}, cambios, feriados, vacaciones, alternarGrupo, alternarTerminadas, irAFecha, orden,
  alCrear, recien = null, pausas, alDesplazar, mensajeVacia,
}: LineaDeTiempoProps) {
  const raiz = useRef<HTMLDivElement>(null);
  const desplazar = useDesplazarVentana(ventana, alDesplazar);
  const [foco, setFoco] = useState<number | null>(null);
  const ancho = ventana.dias * ventana.pxPorDia;
  const enfoque = useMemo(() => (foco === null ? null : cadena(foco, dependencias)), [foco, dependencias]);
  const tareaEnfocada = foco === null ? null : tareas.find((t) => t.id === foco) ?? null;
  const topes = useMemo(() => topesDeFilas(filas), [filas]);
  const hoyVisible = hoy >= ventana.desde && hoy <= ventana.hasta;
  const noLaborables = useMemo(() => noLaborablesEnVentana(ventana, zoom, calendarioDe(catalogo), feriados), [ventana, zoom, catalogo, feriados]);
  const posicionHoy = ANCHO_LISTA + diasEntre(ventana.desde, hoy) * ventana.pxPorDia + ventana.pxPorDia / 2;
  const anclaDe = useCallback((id: number) => {
    const a = anclajes(filas, topes).get(id);
    return a ? { x: a.sale, y: a.y } : null;
  }, [filas, topes]);
  const aPista = useCallback((clientX: number, clientY: number) => {
    const caja = raiz.current?.querySelector('.linea__flechas')?.getBoundingClientRect();
    return { x: clientX - (caja?.left ?? 0), y: clientY - (caja?.top ?? 0) };
  }, []);
  const unir = useUnir({ tareas, dependencias, cambios, anclaDe, aPista });
  const unirManejadores = cambios ? unir.manejadores : undefined;
  const ordenando = useOrdenar({ filas, cambios, tareas, dependencias, orden: orden ?? {} });
  const { desplazamientos, levantada, manejadores } = ordenando;
  const ordenar = useMemo(
    () => (cambios ? { desplazamientos, levantada, manejadores } : undefined),
    [cambios, desplazamientos, levantada, manejadores],
  );
  const partesConPausas = useCallback((tarea: Tarea) => {
    const deLaTarea = pausas?.[tarea.id];
    if (!deLaTarea || deLaTarea.length === 0 || tarea.inicio === null || tarea.fin === null) return null;
    return partesDe(tarea.inicio, tarea.fin, deLaTarea, calendarioDe(catalogo));
  }, [pausas, catalogo]);
  // Solo cambia con los datos: no se rehace al pasar el mouse por una barra ni al arrastrar.
  const anteriorEnConflicto = useMemo(() => {
    const manda = anterioresEnConflicto(tareas, dependencias, catalogo);
    return new Map([...manda].map(([id, t]) => [id, t.titulo] as const));
  }, [tareas, dependencias, catalogo]);
  const ctx = useMemo<ContextoLinea>(() => {
    const predecesoraDe = new Map<number, number>();
    for (const d of dependencias) if (!predecesoraDe.has(d.sucesoraId)) predecesoraDe.set(d.sucesoraId, d.predecesoraId);
    return {
      ventana, hoy, catalogo, vacaciones, enfoque, alEnfocar: setFoco, alAbrir, cambios, alternarGrupo, alternarTerminadas, irAFecha, predecesoraDe, unirManejadores, destinoUnir: unir.destino, ordenar,
      anteriorEnConflicto, alCrear: cambios ? alCrear : undefined, recien, partesDe: partesConPausas,
      personas: new Map(catalogo.personas.map((p) => [p.id, p])),
      porId: new Map(tareas.map((t) => [t.id, t])),
      conHijas: new Set(tareas.flatMap((t) => (t.madreId === null ? [] : [t.madreId]))),
      porPersona: esPorPersona(filas),
      tonoDeProyecto: (id) => estilos[id]?.color ?? tonoPara(id),
    };
  }, [ventana, hoy, catalogo, vacaciones, enfoque, alAbrir, cambios, alternarGrupo, alternarTerminadas, irAFecha, dependencias, tareas, filas, estilos, unirManejadores, unir.destino, ordenar, anteriorEnConflicto, alCrear, recien, partesConPausas]);

  // La barra recién creada se lleva el foco una sola vez (lista para Alt+flechas) y se trae a la vista.
  const enfocada = useRef<number | null>(null);
  useEffect(() => {
    if (recien === null || enfocada.current === recien) return;
    const barra = raiz.current?.querySelector<HTMLElement>(`[data-renglon-tarea="${recien}"] [data-tarea-id="${recien}"]`);
    if (!barra) return;
    enfocada.current = recien;
    barra.focus({ preventScroll: true });
    barra.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [recien, filas]);

  // Las barras entran escalonadas una sola vez, al montar; con movimiento reducido no se anima nada.
  useLayoutEffect(() => {
    const contenedor = raiz.current;
    if (!contenedor || movimientoReducido()) return;
    const barras = contenedor.querySelectorAll('[data-entra-barra]');
    if (barras.length === 0) return;
    const animacion = gsap.fromTo(
      barras,
      { autoAlpha: 0, y: ENTRADA_BARRA.y },
      { autoAlpha: 1, y: 0, duration: ENTRADA_BARRA.duracion, ease: 'power4.out', stagger: escalonadoDe(barras.length), clearProps: 'opacity,visibility,transform' },
    );
    return () => {
      animacion.revert();
    };
  }, []);

  return (
    <Vidrio as="section" className="linea" aria-label="Línea de tiempo">
      <div ref={raiz} className="linea__contenido" data-foco={foco === null ? undefined : 'true'} data-ordenando={ordenando.levantada === null ? undefined : 'true'} data-desplazable={desplazar.manejadores ? 'true' : undefined} data-desplazando={desplazar.desplazando ? 'true' : undefined}>
        <div className="linea__desplazable">
          <div className="linea__lienzo" style={{ width: ANCHO_LISTA + ancho }} {...desplazar.manejadores}>
            {/* El rótulo de hoy y las fechas quedan pegados arriba al bajar por la lista. */}
            <div className="linea__cabecera">
              <div className="linea__fila-hoy">
                {hoyVisible && <span className="linea__hoy-rotulo" data-testid="linea-hoy-rotulo" style={{ left: posicionHoy }}>Hoy</span>}
              </div>
              <EncabezadoFechas ventana={ventana} zoom={zoom} feriados={feriados} />
            </div>
            <div className="linea__cuerpo" style={{ height: filas.length === 0 ? ALTO_SIN_TAREAS : altoDeFilas(filas) }}>
              {filas.length === 0 && (
                <div className="renglon linea__sin-tareas" style={{ height: ALTO_SIN_TAREAS, gridTemplateColumns: `${ANCHO_LISTA}px ${ancho}px` }}>
                  <div className="renglon__lista" />
                  <div className="renglon__pista"><p role="status">{mensajeVacia}</p></div>
                </div>
              )}
              <div className="linea__rejilla" style={{ left: ANCHO_LISTA, width: ancho }} aria-hidden="true">
                {marcasDe(ventana, zoom).map((m) => <i key={m.fecha} style={{ left: diasEntre(ventana.desde, m.fecha) * ventana.pxPorDia }} />)}
              </div>
              {noLaborables.map((fecha) => (
                <i
                  key={fecha}
                  className="linea__no-laborable"
                  aria-hidden="true"
                  style={{ left: ANCHO_LISTA + diasEntre(ventana.desde, fecha) * ventana.pxPorDia, width: ventana.pxPorDia }}
                />
              ))}
              {[...feriados].map(([fecha, nombre]) => (
                <i
                  key={fecha}
                  className="linea__feriado"
                  title={nombre}
                  style={{ left: ANCHO_LISTA + diasEntre(ventana.desde, fecha) * ventana.pxPorDia, width: ventana.pxPorDia }}
                />
              ))}
              {filas.map((fila) => {
                if (fila.tipo === 'encabezado') return <RenglonEncabezado key={fila.clave} fila={fila} ctx={ctx} ancho={ancho} />;
                if (fila.tipo === 'grupo') return <RenglonGrupo key={fila.clave} fila={fila} ctx={ctx} ancho={ancho} />;
                if (fila.tipo === 'proyecto') return <RenglonProyecto key={fila.clave} fila={fila} ancho={ancho} />;
                if (fila.tipo === 'terminadas') return <RenglonTerminadas key={fila.clave} fila={fila} ctx={ctx} ancho={ancho} />;
                return <RenglonTarea key={fila.clave} fila={fila} ctx={ctx} ancho={ancho} />;
              })}
              <div className="linea__flechas" style={{ left: ANCHO_LISTA, width: ancho }}>
                <Flechas filas={filas} topes={topes} tareas={tareas} dependencias={dependencias} catalogo={catalogo} ancho={ancho} enfoque={enfoque} temporal={unir.temporal} alSoltar={cambios?.soltar} />
              </div>
              {hoyVisible && (
                <div className="linea__hoy" data-testid="linea-hoy" style={{ left: posicionHoy }} />
              )}
            </div>
          </div>
        </div>
        <InfoCadena tarea={tareaEnfocada} tareas={tareas} dependencias={dependencias} catalogo={catalogo} correrDetras={cambios?.correrDetras} />
        <ul className="linea__leyenda" aria-label="Leyenda">
          {ESTADOS.map((e) => <li key={e.clave}><i className={`leyenda__estado leyenda__estado--${e.clave}`} />{e.nombre}</li>)}
          <li><i className="leyenda__hito" />Hito</li>
          {zoom !== 'trimestre' && <li><i className="leyenda__no-laborable" />Fin de semana</li>}
          <li><i className="leyenda__feriado" />Feriado</li>
          <li><i className="leyenda__vacaciones" />Vacaciones</li>
          <li className="leyenda__conflicto">— — Fechas que se pisan</li>
        </ul>
      </div>
    </Vidrio>
  );
}
