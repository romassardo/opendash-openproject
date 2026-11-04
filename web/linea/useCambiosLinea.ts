import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Pausa, PausaNueva } from '../../compartido/pausas.js';
import type { Dependencia, NuevaTarea, Tarea } from '../../compartido/tipos.js';
import { useCatalogo } from '../api/consultas.js';
import { useAvisoActual, useAvisos } from '../ui/avisos.js';
import type { FechasBarra } from './arrastre.js';
import {
  aplicarCorrerDetras, aplicarCrear, aplicarDeshacer, aplicarMover, aplicarOrden, aplicarPausar, aplicarQuitarPausa, aplicarSoltar, aplicarUnir,
  type ContextoCambios, type Resultado,
} from './aplicar.js';
import type { EdicionFechas } from './escrituras.js';
import type { Paso } from './registro.js';

export interface CambiosLinea extends EdicionFechas {
  unir(antesId: number, despuesId: number): Promise<void>;
  soltar(dependencia: Dependencia): Promise<void>;
  ordenar(contenedor: string, ids: number[]): Promise<void>;
  /** Corre la sucesora pisada detrás de su anterior (y las manuales que pisa en cascada). */
  correrDetras(sucesoraId: number): Promise<void>;
  /** Crea la tarea; devuelve la creada, o `null` si no se pudo (el aviso dice por qué) o había otro cambio en curso. */
  crear(nueva: NuevaTarea): Promise<Tarea | null>;
  /** Pausa la tarea en esas fechas (ya pasadas a días de trabajo); `true` si quedó pausada. */
  pausar(tarea: Tarea, nueva: PausaNueva, fechas: { desde: string; hasta: string }): Promise<boolean>;
  quitarPausa(pausa: Pausa, titulo: string): Promise<void>;
  deshacer(): Promise<void>;
  avisar(texto: string): void;
  ocupado: boolean;
}

/**
 * Aplica los gestos de la línea contra la API, de a uno por vez, y publica lo hecho en el aviso flotante del marco,
 * con «Deshacer» mientras dura. Hay un solo aviso: un cambio nuevo lo reemplaza; el «Deshacer» sobrevive a cambiar de pantalla.
 */
export function useCambiosLinea(vacacionesDe: (tarea: Tarea) => string | null, alAbrir?: (id: number) => void): CambiosLinea {
  const cliente = useQueryClient();
  const catalogo = useCatalogo().data;
  const avisos = useAvisos();
  const aviso = useAvisoActual();
  const [ocupado, setOcupado] = useState(false);
  const ocupadoRef = useRef(false);
  const pasos = useRef<Paso[]>([]);
  // Texto del aviso que publicó este hook: mientras no se vea, `deshacer()` no tiene nada que deshacer.
  const textoPublicado = useRef<string | null>(null);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);
  useEffect(() => {
    if (aviso === null || aviso.texto !== textoPublicado.current) pasos.current = [];
  }, [aviso]);
  // Siempre lo último recibido, sin volver a crear los gestos en cada render.
  const vacacionesRef = useRef(vacacionesDe);
  vacacionesRef.current = vacacionesDe;
  const catalogoRef = useRef(catalogo);
  catalogoRef.current = catalogo;
  const avisosRef = useRef(avisos);
  avisosRef.current = avisos;
  const alAbrirRef = useRef(alAbrir);
  alAbrirRef.current = alAbrir;

  const deshacerRef = useRef<(hechos: readonly Paso[]) => Promise<void>>(async () => undefined);
  const publicar = useCallback((resultado: Resultado) => {
    const hechos = resultado.pasos;
    pasos.current = hechos;
    textoPublicado.current = resultado.texto;
    const { abrirId } = resultado;
    const accion = abrirId !== undefined && alAbrirRef.current !== undefined
      ? { etiqueta: 'Abrir', alHacer: () => alAbrirRef.current?.(abrirId) }
      : hechos.length > 0 ? { etiqueta: 'Deshacer', alHacer: () => deshacerRef.current(hechos) } : undefined;
    avisosRef.current.avisar({ texto: resultado.texto, error: resultado.error, detalle: resultado.vacaciones, accion });
  }, []);

  const ejecutar = useCallback(async (trabajo: (ctx: ContextoCambios) => Promise<Resultado>): Promise<Resultado | null> => {
    const cat = catalogoRef.current;
    if (ocupadoRef.current || !cat) return null;
    ocupadoRef.current = true;
    setOcupado(true);
    try {
      const resultado = await trabajo({ cliente, catalogo: cat, vacacionesDe: (t) => vacacionesRef.current(t) });
      publicar(resultado);
      return resultado;
    } finally {
      ocupadoRef.current = false;
      if (montado.current) setOcupado(false);
    }
  }, [cliente, publicar]);

  const deshacerPasos = useCallback(async (hechos: readonly Paso[]) => {
    if (hechos.length === 0 || ocupadoRef.current) return;
    await ejecutar((ctx) => aplicarDeshacer(ctx, hechos));
  }, [ejecutar]);

  const guardar = useCallback(async (tarea: Tarea, fechas: FechasBarra, esHito: boolean): Promise<FechasBarra | null> => {
    if (fechas.inicio === tarea.inicio && fechas.fin === tarea.fin) return null;
    const resultado = await ejecutar((ctx) => aplicarMover(ctx, tarea, fechas, esHito));
    return resultado === null || resultado.pasos.length === 0 ? null : fechas;
  }, [ejecutar]);

  const unir = useCallback(async (antesId: number, despuesId: number) => {
    await ejecutar((ctx) => aplicarUnir(ctx, antesId, despuesId));
  }, [ejecutar]);
  const soltar = useCallback(async (dependencia: Dependencia) => {
    await ejecutar((ctx) => aplicarSoltar(ctx, dependencia));
  }, [ejecutar]);
  const ordenar = useCallback(async (contenedor: string, ids: number[]) => {
    await ejecutar((ctx) => aplicarOrden(ctx, contenedor, ids));
  }, [ejecutar]);
  const correrDetras = useCallback(async (sucesoraId: number) => {
    await ejecutar((ctx) => aplicarCorrerDetras(ctx, sucesoraId));
  }, [ejecutar]);
  const crear = useCallback(async (nueva: NuevaTarea) => {
    const resultado = await ejecutar((ctx) => aplicarCrear(ctx, nueva));
    return resultado?.creada ?? null;
  }, [ejecutar]);
  const pausar = useCallback(async (tarea: Tarea, nueva: PausaNueva, fechas: { desde: string; hasta: string }) => {
    const resultado = await ejecutar((ctx) => aplicarPausar(ctx, tarea, nueva, fechas));
    return resultado !== null && resultado.pasos.length > 0;
  }, [ejecutar]);
  const quitarPausa = useCallback(async (pausa: Pausa, titulo: string) => {
    await ejecutar((ctx) => aplicarQuitarPausa(ctx, pausa, titulo));
  }, [ejecutar]);
  deshacerRef.current = deshacerPasos;
  const deshacer = useCallback(() => deshacerPasos(pasos.current), [deshacerPasos]);

  const avisar = useCallback((texto: string) => {
    pasos.current = [];
    textoPublicado.current = null;
    avisosRef.current.avisar({ texto, error: true });
  }, []);
  const guardando = useCallback(() => ocupadoRef.current, []);

  return { guardar, guardando, unir, soltar, ordenar, correrDetras, crear, pausar, quitarPausa, deshacer, avisar, ocupado };
}
