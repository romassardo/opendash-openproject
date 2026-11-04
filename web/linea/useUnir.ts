import { useCallback, useRef, useState, type DOMAttributes, type PointerEvent } from 'react';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import type { Punto } from './trazos.js';
import { motivoParaNoUnir, textoNoUnir } from './unir.js';
import type { CambiosLinea } from './useCambiosLinea.js';

export type PointerHandlers = Pick<DOMAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'>;

export interface OpcionesUnir {
  tareas: Tarea[];
  dependencias: Dependencia[];
  cambios: CambiosLinea | undefined;
  /** Dónde sale la flecha de la tarea (su borde derecho), en coordenadas de la pista. */
  anclaDe(id: number): Punto | null;
  /** Pasa una posición de pantalla a coordenadas de la pista. */
  aPista(clientX: number, clientY: number): Punto;
}

export interface DestinoUnir { id: number; vale: boolean }

interface Origen { id: number; sale: Punto }

/** Id de la tarea cuyo renglón está bajo el puntero, o `null` si cae fuera de todo renglón. */
function renglonBajo(clientX: number, clientY: number): number | null {
  const elemento = document.elementFromPoint(clientX, clientY);
  const renglon = elemento?.closest<HTMLElement>('[data-renglon-tarea]');
  if (!renglon) return null;
  const id = Number(renglon.dataset.renglonTarea);
  return Number.isFinite(id) ? id : null;
}

/** Unir arrastrando el puntito de una barra hasta el renglón de otra tarea, como los nodos de n8n. */
export function useUnir({ tareas, dependencias, cambios, anclaDe, aPista }: OpcionesUnir) {
  const [temporal, setTemporal] = useState<{ sale: Punto; entra: Punto } | null>(null);
  const [destino, setDestino] = useState<DestinoUnir | null>(null);
  const origen = useRef<Origen | null>(null);

  const terminar = useCallback(() => {
    origen.current = null;
    setTemporal(null);
    setDestino(null);
  }, []);

  const destinoEn = useCallback((x: number, y: number): DestinoUnir | null => {
    const o = origen.current;
    const id = renglonBajo(x, y);
    if (!o || id === null || id === o.id) return null;
    return { id, vale: motivoParaNoUnir(o.id, id, tareas, dependencias) === null };
  }, [tareas, dependencias]);

  const manejadores = useCallback((id: number): PointerHandlers => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || !cambios || cambios.ocupado || origen.current) return;
      const sale = anclaDe(id);
      if (!sale) return;
      e.stopPropagation();
      origen.current = { id, sale };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setTemporal({ sale, entra: aPista(e.clientX, e.clientY) });
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const o = origen.current;
      if (!o || o.id !== id) return;
      setTemporal({ sale: o.sale, entra: aPista(e.clientX, e.clientY) });
      const nuevo = destinoEn(e.clientX, e.clientY);
      // Mismo renglón y mismo veredicto: no hay estado nuevo, así no se vuelve a dibujar todo en cada movimiento.
      setDestino((previo) => (previo?.id === nuevo?.id && previo?.vale === nuevo?.vale ? previo : nuevo));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const o = origen.current;
      if (!o || o.id !== id) return;
      const idDestino = renglonBajo(e.clientX, e.clientY);
      terminar();
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (idDestino === null || !cambios) return;
      const motivo = motivoParaNoUnir(o.id, idDestino, tareas, dependencias);
      if (motivo === 'misma') return;
      if (motivo === null) {
        void cambios.unir(o.id, idDestino);
        return;
      }
      const antes = tareas.find((t) => t.id === o.id);
      const despues = tareas.find((t) => t.id === idDestino);
      if (antes && despues) cambios.avisar(textoNoUnir(motivo, antes, despues));
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      if (origen.current?.id !== id) return;
      terminar();
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
    // Si el navegador le saca el puntero al puntito (sin soltar ni cancelar), el gesto termina igual.
    onLostPointerCapture: () => {
      if (origen.current?.id === id) terminar();
    },
  }), [cambios, anclaDe, aPista, destinoEn, terminar, tareas, dependencias]);

  return { temporal, destino, manejadores };
}
