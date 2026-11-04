import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Tarea } from '../../compartido/tipos.js';
import { deltaDiasDe, fechasTrasGesto, type FechasBarra, type Gesto } from './arrastre.js';
import type { EdicionFechas } from './escrituras.js';

/** Desplazamiento mínimo (px) para que un clic cuente como arrastre. */
const UMBRAL_ARRASTRE = 3;

export interface OpcionesGesto {
  tarea: Tarea;
  esHito: boolean;
  /** Sin edición (o sin permiso de arrastrar, como un corchete) la barra solo se abre. */
  edicion: EdicionFechas | undefined;
  /** Si la barra tiene bordes para estirar. */
  estirable: boolean;
  pxPorDia: number;
  alAbrir: (id: number) => void;
}

interface Arrastre { gesto: Gesto; x0: number; movio: boolean }

const mismas = (a: FechasBarra, b: FechasBarra): boolean => a.inicio === b.inicio && a.fin === b.fin;

/** Mover y estirar una barra con el puntero o con Alt+flechas; devuelve los manejadores y la vista previa. */
export function useGestoBarra({ tarea, esHito, edicion, estirable, pxPorDia, alAbrir }: OpcionesGesto) {
  const [previa, setPrevia] = useState<FechasBarra | null>(null);
  const arrastre = useRef<Arrastre | null>(null);
  const recienArrastrada = useRef(false);
  // La tarea tal como estaba al EMPEZAR el gesto (con su lockVersion): la vista previa se calcula y se escribe sobre
  // esa base, así un cambio ajeno llegado en el medio termina en 409 en vez de pisarse sin avisar.
  const base = useRef<Tarea | null>(null);
  const deInicio = (): Tarea => base.current ?? tarea;
  const empezar = () => { base.current ??= tarea; };
  // Con un guardado en vuelo la copia local trae el lockVersion viejo: un gesto nuevo terminaría en un 409 falso.
  const ocupada = () => edicion?.guardando(tarea.id) === true;
  const soltarBase = () => { base.current = null; };
  const descartar = () => { soltarBase(); setPrevia(null); };

  const guardar = async (fechas: FechasBarra) => {
    const origen = deInicio();
    soltarBase();
    if (!edicion || mismas(fechas, { inicio: origen.inicio, fin: origen.fin })) {
      setPrevia(null);
      return;
    }
    try {
      await edicion.guardar(origen, fechas, esHito);
    } finally {
      setPrevia(null);
    }
  };

  const fechasDe = (evento: PointerEvent<HTMLElement>, a: Arrastre): FechasBarra =>
    fechasTrasGesto(deInicio(), a.gesto, deltaDiasDe(evento.clientX - a.x0, pxPorDia), esHito);

  const alBajar = (evento: PointerEvent<HTMLElement>) => {
    if (!edicion || evento.button !== 0 || ocupada()) return;
    const pedido = (evento.target as HTMLElement).dataset.gesto as Gesto | undefined;
    const gesto = pedido && estirable ? pedido : 'mover';
    empezar();
    arrastre.current = { gesto, x0: evento.clientX, movio: false };
    evento.currentTarget.setPointerCapture?.(evento.pointerId);
  };

  const alMover = (evento: PointerEvent<HTMLElement>) => {
    const a = arrastre.current;
    if (!a) return;
    if (!a.movio && Math.abs(evento.clientX - a.x0) < UMBRAL_ARRASTRE) return;
    a.movio = true;
    const fechas = fechasDe(evento, a);
    const origen = deInicio();
    setPrevia(mismas(fechas, { inicio: origen.inicio, fin: origen.fin }) ? null : fechas);
  };

  const terminar = (evento: PointerEvent<HTMLElement>, confirmar: boolean) => {
    const a = arrastre.current;
    arrastre.current = null;
    evento.currentTarget.releasePointerCapture?.(evento.pointerId);
    if (!a?.movio) {
      soltarBase();
      return;
    }
    // El clic que sigue a un arrastre no debe abrir el detalle.
    recienArrastrada.current = true;
    setTimeout(() => { recienArrastrada.current = false; }, 0);
    if (confirmar) void guardar(fechasDe(evento, a));
    else descartar();
  };

  const alTeclear = (evento: KeyboardEvent<HTMLElement>) => {
    const conAlt = evento.altKey && (evento.key === 'ArrowLeft' || evento.key === 'ArrowRight');
    // Alt+flecha es «atrás/adelante» del navegador: con la barra enfocada nunca debe navegar, sea editable o no.
    if (conAlt) evento.preventDefault();
    if (!edicion) return;
    if (conAlt) {
      if (ocupada()) return;
      empezar();
      const origen = deInicio();
      const sentido = evento.key === 'ArrowLeft' ? -1 : 1;
      const fechas = fechasTrasGesto(previa ?? { inicio: origen.inicio, fin: origen.fin }, evento.shiftKey ? 'fin' : 'mover', sentido, esHito);
      // Un gesto que no cambia nada (Alt+Shift sobre un hito, volver al punto de partida) no deja fantasma.
      if (mismas(fechas, { inicio: origen.inicio, fin: origen.fin })) descartar();
      else setPrevia(fechas);
    } else if (previa && evento.key === 'Enter') {
      evento.preventDefault();
      void guardar(previa);
    } else if (previa && evento.key === 'Escape') {
      evento.preventDefault();
      descartar();
    }
  };

  const alHacerClic = () => {
    if (recienArrastrada.current) {
      recienArrastrada.current = false;
      return;
    }
    alAbrir(tarea.id);
  };

  return {
    previa,
    manejadores: {
      onPointerDown: alBajar,
      onPointerMove: alMover,
      onPointerUp: (e: PointerEvent<HTMLElement>) => terminar(e, true),
      onPointerCancel: (e: PointerEvent<HTMLElement>) => terminar(e, false),
      onKeyDown: alTeclear,
      onClick: alHacerClic,
    },
    descartar,
  };
}
