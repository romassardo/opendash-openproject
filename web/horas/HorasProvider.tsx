import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { hoyArgentina } from '../../compartido/fechas.js';
import type { EstadoHoras, Tramo } from '../../compartido/tipos.js';
import { useCatalogo, useHoras, useTareas } from '../api/consultas.js';
import { useAccionesHoras, type AccionesHoras } from '../api/mutaciones.js';
import { mensajeDeError } from '../tareas/acciones.js';
import { ConfirmarHorasExtra } from './ConfirmarHorasExtra.js';
import { pideEstimado, saltear, salteadasHoy } from './estimacion.js';
import { PermisoInactividad } from './PermisoInactividad.js';
import { PreguntaInactividad } from './PreguntaInactividad.js';
import { useInactividad } from './useInactividad.js';

const PASO_MS = 1000;

export type TramoEnMarcha = Tramo & { segundosVivos: number };

export interface RelojHoras {
  /** Los tramos abiertos con lo contado hasta este segundo. */
  enMarcha: TramoEnMarcha[];
  totalHoySegundos: number;
}

interface HorasEnCurso extends RelojHoras {
  estado: EstadoHoras | undefined;
  acciones: AccionesHoras;
  /**
   * ▶ en una tarea: la primera vez explica para qué es el permiso de inactividad (se pide con «Permitir»). Con el día
   * lleno pregunta antes si se sigue con horas extra; si la respuesta es no, no arranca nada.
   */
  trabajar(tareaId: number): Promise<void>;
  /** Retoma un tramo en pausa; con el día lleno pregunta antes por las horas extra, como `trabajar`. */
  seguir(tramoId: number): Promise<void>;
  /** Marca horas extra sin preguntar (quien llama ya lo dijo, como el aviso del tope) y arranca la tarea. */
  seguirConExtra(tareaId: number): Promise<void>;
  /** Tareas recién arrancadas sin «Estimado», para pedírselo a la persona. */
  porEstimar: number[];
  /** Saca la tarea de las que piden estimado; con `saltear`, no vuelve a pedirlo hoy. */
  terminarEstimacion(tareaId: number, saltear: boolean): void;
}

const Contexto = createContext<HorasEnCurso | null>(null);

export function useHorasEnCurso(): HorasEnCurso {
  const valor = useContext(Contexto);
  if (valor === null) throw new Error('useHorasEnCurso se usa dentro de HorasProvider');
  return valor;
}

/** El reloj de lo que está en marcha: se actualiza cada segundo mientras algo corre. */
export function useReloj(): RelojHoras {
  const { enMarcha, totalHoySegundos } = useHorasEnCurso();
  return { enMarcha, totalHoySegundos };
}

/**
 * Lleva el cronómetro: vive en el marco, así el reloj sigue al cambiar de pantalla. El servidor tiene la cuenta;
 * acá solo se suma el tiempo pasado desde la última respuesta a cada tramo que corre.
 */
export function HorasProvider({ children }: { children: ReactNode }) {
  const consulta = useHoras();
  const estado = consulta.data;
  const acciones = useAccionesHoras();
  const tareas = useTareas().data?.tareas;
  const catalogo = useCatalogo().data;
  const [ahora, setAhora] = useState(() => Date.now());
  const corriendo = estado?.enMarcha.some((t) => !t.pausado) ?? false;
  const respondido = consulta.dataUpdatedAt;

  // Cada respuesta nueva pone el reloj al día sin esperar el paso.
  useLayoutEffect(() => {
    setAhora(Date.now());
  }, [respondido]);

  useEffect(() => {
    if (!corriendo) return;
    const paso = window.setInterval(() => setAhora(Date.now()), PASO_MS);
    return () => window.clearInterval(paso);
  }, [corriendo]);

  const reloj = useMemo<RelojHoras>(() => {
    if (estado === undefined) return { enMarcha: [], totalHoySegundos: 0 };
    const activos = estado.enMarcha.filter((t) => !t.pausado).length;
    const pasados = activos === 0 ? 0 : Math.max(0, Math.round((ahora - respondido) / 1000));
    // Cada tarea en marcha suma el tiempo entero; el día, que es de reloj, lo suma una sola vez.
    const enMarcha = estado.enMarcha.map((t) => (t.pausado ? t : { ...t, segundosVivos: t.segundosVivos + pasados }));
    // Con horas extra el día no tiene tope.
    const tope = estado.horasExtra ? Number.POSITIVE_INFINITY : Math.max(estado.jornadaSegundos, estado.totalHoySegundos);
    return { enMarcha, totalHoySegundos: Math.min(estado.totalHoySegundos + pasados, tope) };
  }, [estado, ahora, respondido]);

  // Con todo en pausa no corre nada: ni se detecta la inactividad ni se pregunta.
  const tareasCorriendo = useMemo(() => reloj.enMarcha.filter((t) => !t.pausado).map((t) => t.tareaId), [reloj.enMarcha]);
  const hayCorriendo = tareasCorriendo.length > 0;
  const inactividad = useInactividad(hayCorriendo);
  const { pedirPermiso, noPedir, limpiar, necesitaExplicar } = inactividad;
  const [explicando, setExplicando] = useState(false);
  const [errorInactividad, setErrorInactividad] = useState<string | null>(null);
  // La pregunta de horas extra abierta: se resuelve con la respuesta de la persona.
  const [preguntaExtra, setPreguntaExtra] = useState<((seguir: boolean) => void) | null>(null);
  const [porEstimar, setPorEstimar] = useState<number[]>([]);

  // Sin nada corriendo no queda ninguna pregunta vieja esperando.
  useEffect(() => {
    if (!hayCorriendo) {
      limpiar();
      setErrorInactividad(null);
    }
  }, [hayCorriendo, limpiar]);

  const terminarEstimacion = useCallback((tareaId: number, saltearHoy: boolean) => {
    if (saltearHoy) saltear(tareaId, hoyArgentina());
    setPorEstimar((lista) => lista.filter((id) => id !== tareaId));
  }, []);

  const diaLleno = estado !== undefined && !estado.horasExtra && reloj.totalHoySegundos >= estado.jornadaSegundos;
  const { trabajar: trabajarEnServidor, seguir: seguirEnServidor, horasExtra } = acciones;
  const valor = useMemo<HorasEnCurso>(() => {
    const anotarSiFaltaEstimado = (tareaId: number): void => {
      const tarea = tareas?.find((t) => t.id === tareaId);
      if (tarea === undefined || catalogo === undefined || salteadasHoy(hoyArgentina()).has(tareaId)) return;
      if (pideEstimado(tarea, tareas ?? [], catalogo)) setPorEstimar((lista) => (lista.includes(tareaId) ? lista : [...lista, tareaId]));
    };
    const arrancar = async (tareaId: number): Promise<void> => {
      limpiar();
      if (necesitaExplicar) setExplicando(true);
      await trabajarEnServidor(tareaId);
      anotarSiFaltaEstimado(tareaId);
    };
    /** Con el día lleno pregunta por las horas extra; `false` si la persona no quiere seguir. */
    const hayLugar = async (): Promise<boolean> => {
      if (!diaLleno) return true;
      const seguir = await new Promise<boolean>((resolver) => setPreguntaExtra(() => resolver));
      if (seguir) await horasExtra();
      return seguir;
    };
    return {
      ...reloj,
      estado,
      acciones,
      trabajar: async (tareaId) => {
        if (await hayLugar()) await arrancar(tareaId);
      },
      seguir: async (tramoId) => {
        if (await hayLugar()) await seguirEnServidor(tramoId);
      },
      seguirConExtra: async (tareaId) => {
        await horasExtra();
        await arrancar(tareaId);
      },
      porEstimar,
      terminarEstimacion,
    };
  }, [reloj, estado, acciones, limpiar, necesitaExplicar, trabajarEnServidor, seguirEnServidor, horasExtra, diaLleno, tareas, catalogo,
    porEstimar, terminarEstimacion]);

  const responderExtra = (seguir: boolean): void => {
    preguntaExtra?.(seguir);
    setPreguntaExtra(null);
  };

  return (
    <Contexto.Provider value={valor}>
      {children}
      {preguntaExtra !== null && estado !== undefined && (
        <ConfirmarHorasExtra jornadaHoras={estado.jornadaSegundos / 3600} alSeguir={() => responderExtra(true)} alCancelar={() => responderExtra(false)} />
      )}
      {explicando && necesitaExplicar && (
        <PermisoInactividad
          alPermitir={() => { setExplicando(false); void pedirPermiso(); }}
          alRechazar={() => { setExplicando(false); noPedir(); }}
        />
      )}
      {inactividad.desde !== null && hayCorriendo && (
        <PreguntaInactividad
          desde={inactividad.desde}
          tareaIds={tareasCorriendo}
          error={errorInactividad}
          alResponder={(seguia, desde) => {
            setErrorInactividad(null);
            // La pregunta se va solo cuando el servidor la recibió: si falla, sigue para poder reintentar.
            acciones.inactividad(desde.toISOString(), seguia).then(
              () => limpiar(),
              (fallo: unknown) => setErrorInactividad(mensajeDeError(fallo)),
            );
          }}
        />
      )}
    </Contexto.Provider>
  );
}
