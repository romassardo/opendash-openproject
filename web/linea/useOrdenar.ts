import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { OrdenLinea } from '../../compartido/linea.js';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import type { Fila } from './filas.js';
import { ALTO_RENGLON, topesDeFilas } from './medidas.js';
import { aplicarOrden, moverEnLista } from './ordenLista.js';
import type { CambiosLinea } from './useCambiosLinea.js';
import type { PointerHandlers } from './useUnir.js';

export interface OpcionesOrdenar {
  filas: Fila[];
  cambios: CambiosLinea | undefined;
  /** Todas las tareas (también las fuera de la ventana): el orden guardado las incluye. */
  tareas: readonly Tarea[];
  dependencias: readonly Dependencia[];
  orden: OrdenLinea;
}

export type ManejadoresOrden = PointerHandlers & { onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };

type FilaOrdenable = Extract<Fila, { tipo: 'tarea' | 'grupo' }>;
interface Gesto { clave: string; contenedor: string; inicioY: number; dy: number }

const esOrdenable = (f: Fila): f is FilaOrdenable => (f.tipo === 'tarea' || f.tipo === 'grupo') && f.contenedor !== null;

/** Ids del contenedor (proyecto y madre) en el orden vigente, con las tareas que no se ven en la ventana. */
function idsCompletos(contenedor: string, visibles: readonly FilaOrdenable[], o: OpcionesOrdenar): number[] {
  const enVisibles = new Set(visibles.map((f) => f.tarea.id));
  const [proyecto, madre] = contenedor.split(':').map(Number);
  const delContenedor = o.tareas.filter((t) => enVisibles.has(t.id) || (t.proyectoId === proyecto && (t.madreId ?? 0) === madre));
  return aplicarOrden(delContenedor, o.orden[contenedor], o.dependencias).map((t) => t.id);
}

/** Orden completo del contenedor con la tarea movida justo junto a su nueva vecina visible. */
function idsTrasMover(completos: readonly number[], visibles: readonly number[], id: number, destino: number): number[] {
  const nuevosVisibles = moverEnLista(visibles, id, destino);
  const sinLa = completos.filter((i) => i !== id);
  const posicion = nuevosVisibles.indexOf(id);
  const anterior = nuevosVisibles[posicion - 1];
  if (anterior !== undefined) {
    const en = sinLa.indexOf(anterior) + 1;
    return [...sinLa.slice(0, en), id, ...sinLa.slice(en)];
  }
  const siguiente = nuevosVisibles[posicion + 1];
  const en = siguiente === undefined ? sinLa.length : sinLa.indexOf(siguiente);
  return [...sinLa.slice(0, en), id, ...sinLa.slice(en)];
}

const limitar = (n: number, max: number): number => Math.max(0, Math.min(n, max));

/** Ordenar la lista arrastrando el ⠿ de un renglón (o con Alt+↑/↓), dentro de su contenedor. */
export function useOrdenar(opciones: OpcionesOrdenar) {
  const { filas, cambios } = opciones;
  const [gesto, setGesto] = useState<Gesto | null>(null);
  const activo = useRef(false);
  const topes = useMemo(() => topesDeFilas(filas), [filas]);

  const hermanas = useCallback((contenedor: string): { fila: FilaOrdenable; tope: number }[] => (
    filas.flatMap((f, i) => (esOrdenable(f) && f.contenedor === contenedor ? [{ fila: f, tope: topes[i]! }] : []))
  ), [filas, topes]);

  /** Índice (entre las visibles del contenedor) al que cae la fila arrastrada. */
  const destinoDe = useCallback((g: Gesto): number => {
    const lista = hermanas(g.contenedor);
    const origen = lista.findIndex((h) => h.fila.clave === g.clave);
    if (origen === -1) return 0;
    const y = lista[origen]!.tope + g.dy;
    let mejor = origen;
    lista.forEach((h, i) => {
      if (Math.abs(h.tope - y) < Math.abs(lista[mejor]!.tope - y)) mejor = i;
    });
    return mejor;
  }, [hermanas]);

  const confirmar = useCallback((fila: FilaOrdenable, destino: number) => {
    if (!cambios || fila.contenedor === null) return;
    const lista = hermanas(fila.contenedor).map((h) => h.fila);
    const origen = lista.findIndex((f) => f.clave === fila.clave);
    if (origen === -1 || destino === origen) return;
    const visibles = lista.map((f) => f.tarea.id);
    const completos = idsCompletos(fila.contenedor, lista, opciones);
    const ids = idsTrasMover(completos, visibles, fila.tarea.id, destino);
    if (ids.length === completos.length && ids.every((x, i) => x === completos[i])) return;
    void cambios.ordenar(fila.contenedor, ids);
  }, [cambios, hermanas, opciones]);

  const terminar = useCallback(() => {
    activo.current = false;
    setGesto(null);
  }, []);

  const manejadores = useCallback((fila: FilaOrdenable): ManejadoresOrden => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || !cambios || cambios.ocupado || activo.current || fila.contenedor === null) return;
      e.stopPropagation();
      activo.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setGesto({ clave: fila.clave, contenedor: fila.contenedor, inicioY: e.clientY, dy: 0 });
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      setGesto((g) => (g?.clave === fila.clave ? { ...g, dy: e.clientY - g.inicioY } : g));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      if (gesto?.clave !== fila.clave) return;
      const final = { ...gesto, dy: e.clientY - gesto.inicioY };
      terminar();
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      confirmar(fila, destinoDe(final));
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      if (gesto?.clave !== fila.clave) return;
      terminar();
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
    // Si el navegador le saca el puntero al asa (sin soltar ni cancelar), el renglón vuelve a su lugar.
    onLostPointerCapture: () => {
      if (activo.current && gesto?.clave === fila.clave) terminar();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !cambios || cambios.ocupado || activo.current || fila.contenedor === null) return;
      e.preventDefault();
      const lista = hermanas(fila.contenedor);
      const origen = lista.findIndex((h) => h.fila.clave === fila.clave);
      confirmar(fila, limitar(origen + (e.key === 'ArrowUp' ? -1 : 1), lista.length - 1));
    },
  }), [cambios, gesto, terminar, confirmar, destinoDe, hermanas]);

  /** Cuánto se corre cada renglón (px en vertical) durante el arrastre: el levantado sigue al puntero, los demás le hacen lugar. */
  const desplazamientos = useMemo(() => {
    const mapa = new Map<string, number>();
    if (gesto === null) return mapa;
    const lista = hermanas(gesto.contenedor);
    const origen = lista.findIndex((h) => h.fila.clave === gesto.clave);
    if (origen === -1) return mapa;
    const destino = destinoDe(gesto);
    mapa.set(gesto.clave, gesto.dy);
    lista.forEach((h, i) => {
      if (i === origen) return;
      if (destino > origen && i > origen && i <= destino) mapa.set(h.fila.clave, -ALTO_RENGLON);
      if (destino < origen && i < origen && i >= destino) mapa.set(h.fila.clave, ALTO_RENGLON);
    });
    return mapa;
  }, [gesto, hermanas, destinoDe]);

  return { desplazamientos, manejadores, levantada: gesto?.clave ?? null };
}
