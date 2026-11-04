import { useState, type ReactNode } from 'react';
import { hoyArgentina, sumarDias } from '../../compartido/fechas.js';
import type { Tarea, Tramo } from '../../compartido/tipos.js';
import { useCatalogo, useTareas, useYo } from '../api/consultas.js';
import { abiertasPropias } from '../inicio/logica.js';
import { BuscadorTareas } from '../tareas/BuscadorTareas.js';
import { mensajeDeError } from '../tareas/acciones.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { CorreccionTramo } from './CorreccionTramo.js';
import { useHorasEnCurso } from './HorasProvider.js';
import { PedirEstimacion } from './PedirEstimacion.js';
import './horas.css';

const diaLargo = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: 'UTC' });
const diaCorto = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
/** Un pendiente recién cerrado se está cargando: solo se avisa si pasó este rato sin cargarse. */
const ESPERA_PENDIENTE_MS = 2 * 60_000;
const DIAS_CON_NOMBRE = 6;

/** «Hoy», «Ayer», «El viernes» (hasta una semana atrás) o «El 24/10». */
export function cuandoFue(dia: string, hoy: string): string {
  if (dia === hoy) return 'Hoy';
  if (dia === sumarDias(hoy, -1)) return 'Ayer';
  const fecha = new Date(`${dia}T12:00:00Z`);
  for (let atras = 2; atras <= DIAS_CON_NOMBRE; atras++) if (dia === sumarDias(hoy, -atras)) return `El ${diaLargo.format(fecha)}`;
  return `El ${diaCorto.format(fecha)}`;
}

const esPendienteViejo = (t: Tramo, ahora: number): boolean =>
  t.estado === 'pendiente' && (t.fin === null || ahora - Date.parse(t.fin) >= ESPERA_PENDIENTE_MS);

/**
 * Lo que el marco le cuenta a la persona de sus tramos: el estimado que falta en lo recién arrancado, frenados solos,
 * pendientes de cargar y rechazados.
 */
export function AvisosHoras() {
  const { estado, porEstimar } = useHorasEnCurso();
  const tareas = useTareas().data?.tareas;
  // Si la tarea ya tiene estimado (se cargó en otro lado), no se pide.
  const estimar = porEstimar.map((id) => tareas?.find((t) => t.id === id)).filter((t): t is Tarea => t !== undefined && t.estimacionHoras === null);
  const avisos = estado?.avisos ?? [];
  const jornada = (estado?.jornadaSegundos ?? 0) / 3600;
  const ahora = Date.now();
  const pendientes = avisos.filter((t) => t.estado === 'pendiente');
  const viejos = pendientes.filter((t) => esPendienteViejo(t, ahora));
  // Los pendientes recién cerrados se están cargando en segundo plano: no se avisa todavía.
  const propios = avisos.filter((t) => t.estado !== 'pendiente');
  if (propios.length === 0 && viejos.length === 0 && estimar.length === 0) return null;
  return (
    <div className="horas-avisos" aria-label="Avisos de horas">
      {estimar.map((t) => <PedirEstimacion key={t.id} tarea={t} />)}
      {propios.map((t) => <AvisoTramo key={t.id} tramo={t} jornada={jornada} />)}
      {viejos.length === 1 && <AvisoTramo tramo={viejos[0]!} jornada={jornada} />}
      {viejos.length > 1 && <AvisoPendientes cantidad={viejos.length} />}
    </div>
  );
}

/** Varios pendientes juntos en un solo aviso, que se puede ocultar hasta que cambie la cantidad. */
function AvisoPendientes({ cantidad }: { cantidad: number }) {
  const [ocultoPara, setOcultoPara] = useState<number | null>(null);
  if (ocultoPara === cantidad) return null;
  return (
    <Aviso tipo="info" className="horas-aviso">
      <p className="horas-aviso__texto">{`${cantidad} tramos pendientes de cargar a OpenProject`}</p>
      <div className="horas-aviso__botones">
        <Boton variante="fantasma" onClick={() => setOcultoPara(cantidad)}>Ocultar</Boton>
      </div>
    </Aviso>
  );
}

function AvisoTramo({ tramo, jornada }: { tramo: Tramo; jornada: number }) {
  const { acciones, enMarcha, estado, seguirConExtra } = useHorasEnCurso();
  const tareas = useTareas().data?.tareas;
  const catalogo = useCatalogo().data;
  const yo = useYo().data;
  const [modo, setModo] = useState<'aviso' | 'corregir' | 'pasar'>('aviso');
  const [error, setError] = useState<string | null>(null);
  const titulo = tareas?.find((t) => t.id === tramo.tareaId)?.titulo ?? 'la tarea';

  const ejecutar = async (accion: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await accion();
    } catch (fallo) {
      setError(mensajeDeError(fallo));
    }
  };

  const botones = (): ReactNode => {
    if (tramo.estado === 'rechazado') {
      return (
        <>
          <Boton variante="secundario" disabled={acciones.pendiente} onClick={() => void ejecutar(() => acciones.reintentar(tramo.id))}>Reintentar</Boton>
          <Boton variante="secundario" onClick={() => setModo('pasar')}>Pasarlo a otra tarea</Boton>
          <Boton variante="fantasma" disabled={acciones.pendiente} onClick={() => void ejecutar(() => acciones.descartar(tramo.id))}>Descartar</Boton>
        </>
      );
    }
    if (tramo.estado === 'pendiente') return null;
    // Lo frenó el tope hoy: se puede seguir como horas extra (si ya corre otra vez, no hace falta).
    const seguirExtra = tramo.frenadoSolo === 'tope' && tramo.dia === hoyArgentina() && !enMarcha.some((t) => t.tareaId === tramo.tareaId);
    return (
      <>
        {seguirExtra && (
          <Boton variante="primario" disabled={acciones.pendiente} onClick={() => void ejecutar(async () => {
            await seguirConExtra(tramo.tareaId);
            await acciones.vistoAviso(tramo.id);
          })}>
            {estado?.horasExtra ? 'Seguir' : 'Seguir con horas extra'}
          </Boton>
        )}
        <Boton variante="secundario" disabled={acciones.pendiente} onClick={() => void ejecutar(() => acciones.vistoAviso(tramo.id))}>Está bien</Boton>
        <Boton variante="fantasma" onClick={() => setModo('corregir')}>Corregir</Boton>
      </>
    );
  };

  const texto = (): string => {
    if (tramo.estado === 'rechazado') return `«${titulo}»: no se pudo cargar: ${tramo.motivo ?? 'OpenProject no aceptó la carga'}`;
    if (tramo.estado === 'pendiente') return `«${titulo}»: pendiente de cargar`;
    const cuando = cuandoFue(tramo.dia, hoyArgentina());
    return `${cuando} «${titulo}» se frenó solo ${tramo.frenadoSolo === 'medianoche' ? 'a la medianoche' : `al llegar a las ${jornada} h`}`;
  };

  return (
    <Aviso tipo={tramo.estado === 'rechazado' ? 'error' : 'info'} className="horas-aviso">
      <p className="horas-aviso__texto">{texto()}</p>
      {modo === 'aviso' && <div className="horas-aviso__botones">{botones()}</div>}
      {modo === 'corregir' && <CorreccionTramo tramo={tramo} alGuardar={() => { setModo('aviso'); void acciones.vistoAviso(tramo.id).catch(() => undefined); }} />}
      {modo === 'pasar' && tareas && catalogo && yo && (
        <div className="horas-aviso__pasar">
          <BuscadorTareas etiqueta="Pasar a la tarea" placeholder="Buscar una tarea" candidatas={abiertasPropias(tareas, catalogo, yo.id)} catalogo={catalogo}
            alElegir={(tarea) => void ejecutar(() => acciones.pasar(tramo.id, tarea.id))} />
          <Boton variante="fantasma" onClick={() => setModo('aviso')}>Cancelar</Boton>
        </div>
      )}
      {error !== null && <p className="horas-aviso__error" role="alert">{error}</p>}
    </Aviso>
  );
}
