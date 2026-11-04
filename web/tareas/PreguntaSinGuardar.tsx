import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Boton } from '../ui/Boton.js';
import type { Borrador, Borradores } from './borradores.js';
import { MSG_SIN_GUARDAR } from './edicion.js';

interface Pregunta {
  /** Campos por los que se pregunta (`null`: todos). */
  claves: string[] | null;
  /** Cerrar el panel al terminar (si no, solo se resuelve el campo). */
  cerrar: boolean;
}

/**
 * Registro de los borradores del panel y la pregunta «Tenés cambios sin guardar»: cerrar el panel
 * (o salir del editor de la descripción con Escape) con algo escrito pregunta en lugar de perderlo.
 */
export function useBorradoresDelPanel(alCerrar: () => void, alQuedarse: () => void = () => {}) {
  const borradores = useRef(new Map<string, Borrador>());
  const esperas = useRef(new Set<() => Promise<unknown>>());
  const [pregunta, setPregunta] = useState<Pregunta | null>(null);
  const [resolviendo, setResolviendo] = useState(false);

  const contexto = useMemo<Borradores>(() => ({
    registrar(clave, borrador) {
      borradores.current.set(clave, borrador);
      return () => {
        if (borradores.current.get(clave) === borrador) borradores.current.delete(clave);
      };
    },
    registrarEspera(esperar) {
      esperas.current.add(esperar);
      return () => {
        esperas.current.delete(esperar);
      };
    },
    preguntar: (claves, cerrar) => setPregunta({ claves, cerrar }),
  }), []);

  // Lo que falla igual deja su aviso y lo escrito a la vista: acá solo importa que haya terminado.
  const esperarEscrituras = () => Promise.allSettled([...esperas.current].map((esperar) => esperar()));

  const sucios = (claves: string[] | null): Borrador[] =>
    [...borradores.current].filter(([clave, b]) => (claves === null || claves.includes(clave)) && b.sucio()).map(([, b]) => b);

  /** Cierra si no queda nada sin guardar (después de esperar las escrituras en curso); si queda, pregunta. */
  const intentarCerrar = useCallback(async () => {
    await esperarEscrituras();
    if (sucios(null).length === 0) alCerrar();
    else setPregunta({ claves: null, cerrar: true });
  }, [alCerrar]);

  const guardar = async () => {
    if (!pregunta) return;
    setResolviendo(true);
    // Lo que ya está en camino no se vuelve a mandar: primero se espera y después se ve qué quedó.
    await esperarEscrituras();
    let todo = true;
    for (const borrador of sucios(pregunta.claves)) todo = (await borrador.guardar()) && todo;
    setResolviendo(false);
    setPregunta(null);
    // Si algo no se pudo guardar el panel queda abierto, con su aviso y lo escrito a la vista.
    if (todo && pregunta.cerrar) alCerrar();
    else alQuedarse();
  };

  const descartar = () => {
    if (!pregunta) return;
    sucios(pregunta.claves).forEach((b) => b.descartar());
    setPregunta(null);
    if (pregunta.cerrar) alCerrar();
  };

  /** Tira todo lo escrito sin preguntar (la tarea ya no existe). */
  const descartarTodo = () => sucios(null).forEach((b) => b.descartar());

  const seguir = () => {
    const primero = pregunta ? sucios(pregunta.claves)[0] : undefined;
    setPregunta(null);
    alQuedarse();
    primero?.enfocar();
  };

  /** Si queda algo escrito sin guardar (lo usan el freno de navegación y el aviso al cerrar la pestaña). */
  const haySucios = useCallback(() => sucios(null).length > 0, []);

  return { contexto, haySucios, preguntando: pregunta !== null, resolviendo, intentarCerrar, guardar, descartar, descartarTodo, seguir };
}

export interface PreguntaSinGuardarProps {
  ocupada: boolean;
  alGuardar(): void;
  alDescartar(): void;
  alSeguir(): void;
}

export function PreguntaSinGuardar({ ocupada, alGuardar, alDescartar, alSeguir }: PreguntaSinGuardarProps) {
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    caja.current?.querySelector<HTMLButtonElement>('[data-accion="guardar"]')?.focus();
  }, []);
  return (
    <div ref={caja} className="detalle-salida" role="alertdialog" aria-labelledby={id} data-conserva-borrador="">
      <p id={id} className="detalle-salida__titulo">{MSG_SIN_GUARDAR}</p>
      <p className="detalle-salida__texto">Podés guardarlos, descartarlos o seguir editando.</p>
      <div className="detalle__botones">
        <Boton variante="fantasma" onClick={alSeguir}>Seguir editando</Boton>
        <Boton variante="secundario" disabled={ocupada} onClick={alDescartar}>Descartar</Boton>
        <Boton variante="primario" data-accion="guardar" disabled={ocupada} onClick={alGuardar}>
          {ocupada ? 'Guardando…' : 'Guardar'}
        </Boton>
      </div>
    </div>
  );
}
