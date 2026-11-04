import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useBlocker, type Blocker } from 'react-router';
import { Flag, X } from 'lucide-react';
import { etiquetaPrioridad } from '../../compartido/prioridades.js';
import type { Catalogo, Tarea } from '../../compartido/tipos.js';
import { ErrorApi, EVENTO_TOKEN_VENCIDO } from '../api/cliente.js';
import { useCatalogo, useTarea, useTareas, type DetalleTarea as Detalle } from '../api/consultas.js';
import { useEntradaCajon } from '../animaciones/entradas.js';
import { Aviso } from '../ui/Aviso.js';
import { useAvisos as useAvisosFlotantes } from '../ui/avisos.js';
import { Boton } from '../ui/Boton.js';
import { unir } from '../ui/clases.js';
import { atraparTab } from '../ui/foco.js';
import { bloquearFondo } from '../ui/inerte.js';
import { Pildora } from '../ui/Pildora.js';
import { useTonoProyecto } from '../ui/useTonoProyecto.js';
import { Vidrio } from '../ui/Vidrio.js';
import { BotonTrabajar } from '../horas/BotonTrabajar.js';
import { useEdicionTarea, type Avisos, type TipoAviso } from './accionesDetalle.js';
import { ContextoBorradores, useEsperaDeEscrituras } from './borradores.js';
import { CampoEstado, CamposTarea } from './CamposTarea.js';
import { CampoTitulo } from './CampoTitulo.js';
import { DescripcionTarea } from './DescripcionTarea.js';
import { EstimadoReal } from './EstimadoReal.js';
import { SeccionBorrar } from './SeccionBorrar.js';
import { SeccionAdjuntos } from './SeccionAdjuntos.js';
import { PreguntaSinGuardar, useBorradoresDelPanel } from './PreguntaSinGuardar.js';
import { Comentarios, EsperaA, Historial, Subtareas } from './SeccionesDetalle.js';
import { SeccionPausas } from './SeccionPausas.js';
import './detalle.css';

export interface DetalleTareaProps {
  /** Id de la ruta; `NaN` si no es un número. */
  id: number;
  alCerrar(): void;
}

interface AvisoPanel { campo: string; texto: string; tipo: TipoAviso }

/**
 * Panel modal: el resto de la página queda inerte, el foco entra al abrirse, Tab no se escapa,
 * Escape llama a `alEscape` (si nadie lo usó antes) y al cerrarse el foco vuelve a la tarjeta o fila.
 */
function useFocoDelPanel(caja: RefObject<HTMLElement | null>, id: number, alEscape: () => void): void {
  useLayoutEffect(() => {
    const panel = caja.current;
    const capa = panel?.parentElement ?? null;
    const origen = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    let liberar = capa ? bloquearFondo(capa) : () => {};
    // Con el token vencido, el diálogo del token es la única salida: el panel le libera el fondo
    // (si no, quedaría inerte y no se podría usar) y lo retoma cuando el foco vuelve al panel.
    let cedido = false;
    const ceder = () => {
      cedido = true;
      liberar();
    };
    const retomar = () => {
      if (!cedido || !capa) return;
      cedido = false;
      liberar = bloquearFondo(capa);
    };
    window.addEventListener(EVENTO_TOKEN_VENCIDO, ceder);
    capa?.addEventListener('focusin', retomar);
    panel?.focus();
    return () => {
      window.removeEventListener(EVENTO_TOKEN_VENCIDO, ceder);
      capa?.removeEventListener('focusin', retomar);
      liberar();
      const destino = origen?.isConnected ? origen : document.querySelector<HTMLElement>(`[data-tarea-id="${id}"]`);
      destino?.focus();
    };
  }, [caja, id]);

  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => {
      const panel = caja.current;
      // Con otro diálogo encima (el del token), el panel queda inerte y las teclas son de ese diálogo.
      if (!panel || panel.closest('[inert]')) return;
      const objetivo = evento.target instanceof Node ? evento.target : null;
      if (objetivo && objetivo !== document.body && !panel.contains(objetivo)) return;
      if (evento.key === 'Escape' && !evento.defaultPrevented) {
        evento.preventDefault();
        alEscape();
      } else if (!evento.defaultPrevented) {
        atraparTab(evento, panel);
      }
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [caja, alEscape]);
}

/**
 * Con borradores sin guardar frena toda navegación que cambie la dirección (enlaces internos, Atrás y
 * Adelante) y hace la pregunta de siempre; cerrar la pestaña pide la confirmación del navegador.
 */
function useFrenoDeNavegacion(
  haySucios: () => boolean,
  preguntar: (claves: string[] | null, cerrar: boolean) => void,
  bloqueo: { current: Blocker | null },
): void {
  const freno = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search) && haySucios(),
  );
  bloqueo.current = freno;
  const bloqueada = freno.state === 'blocked';
  useEffect(() => {
    if (bloqueada) preguntar(null, true);
  }, [bloqueada, preguntar]);

  useEffect(() => {
    const alSalir = (evento: BeforeUnloadEvent) => {
      if (haySucios()) evento.preventDefault();
    };
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, [haySucios]);
}

/** Panel lateral con el detalle de una tarea, sobre el tablero o la lista (ruta `/tareas/:id`). */
export function DetalleTarea({ id, alCerrar }: DetalleTareaProps) {
  const valido = Number.isInteger(id) && id > 0;
  const detalle = useTarea(valido ? id : 0);
  const catalogo = useCatalogo();
  const caja = useRef<HTMLElement>(null);
  const idTitulo = useId();
  // Cerrar con algo escrito sin guardar pregunta antes («Tenés cambios sin guardar»). Si la pregunta
  // vino de una navegación frenada, resolverla la deja seguir o quedarse; si no, cierra el panel.
  const bloqueo = useRef<Blocker | null>(null);
  const borradores = useBorradoresDelPanel(
    () => (bloqueo.current?.state === 'blocked' ? bloqueo.current.proceed() : alCerrar()),
    () => (bloqueo.current?.state === 'blocked' ? bloqueo.current.reset() : undefined),
  );
  const { preguntando, intentarCerrar, seguir } = borradores;
  useFrenoDeNavegacion(borradores.haySucios, borradores.contexto.preguntar, bloqueo);
  const alEscape = useMemo(
    () => () => (preguntando ? seguir() : void intentarCerrar()),
    [preguntando, seguir, intentarCerrar],
  );
  useFocoDelPanel(caja, id, alEscape);
  const flotantes = useAvisosFlotantes();
  // Borrada: lo escrito sin guardar ya no tiene a dónde ir, así que se cierra sin la pregunta.
  const alBorrar = (titulo: string) => {
    borradores.descartarTodo();
    alCerrar();
    flotantes.avisar({ texto: `Borraste «${titulo}»` });
  };
  useEntradaCajon(caja);

  const noEncontrada = !valido || (detalle.error instanceof ErrorApi && detalle.error.codigo === 'no-encontrado');
  let contenido;
  if (noEncontrada) {
    contenido = (
      <div className="detalle__estado-vacio">
        <h2 id={idTitulo} className="detalle__aviso-titulo">No se encontró la tarea</h2>
        <p className="tarjeta__sub">Puede que la hayan borrado o que no tengas acceso a su proyecto.</p>
        <Boton variante="secundario" onClick={alCerrar}>Volver a las tareas</Boton>
      </div>
    );
  } else if (detalle.data && catalogo.data) {
    contenido = <Contenido idTitulo={idTitulo} detalle={detalle.data} catalogo={catalogo.data} alBorrar={alBorrar} />;
  } else if (detalle.error || catalogo.error) {
    const error = detalle.error ?? catalogo.error;
    contenido = (
      <div className="detalle__estado-vacio">
        <h2 id={idTitulo} className="detalle__aviso-titulo">No se pudo abrir la tarea</h2>
        <Aviso tipo="error">{error instanceof ErrorApi ? error.mensaje : 'No se pudo cargar la tarea.'}</Aviso>
        <Boton variante="secundario" onClick={() => void Promise.all([detalle.refetch(), catalogo.refetch()])}>Reintentar</Boton>
      </div>
    );
  } else {
    contenido = <h2 id={idTitulo} className="detalle__cargando">Cargando la tarea…</h2>;
  }

  return createPortal(
    <div className="detalle-capa">
      {/* Sin robar el foco: lo escrito no se guarda solo por tocar afuera; decide la pregunta. */}
      <div className="detalle__velo" aria-hidden="true" onMouseDown={(e) => e.preventDefault()} onClick={() => void intentarCerrar()} />
      <Vidrio
        ref={caja}
        variante="denso"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-busy={!noEncontrada && !detalle.data}
        tabIndex={-1}
        className="detalle"
      >
        <div className="detalle__barra">
          {!noEncontrada && detalle.data && catalogo.data && <Etiquetas tarea={detalle.data.tarea} catalogo={catalogo.data} />}
          <button type="button" className="detalle__cerrar" aria-label="Cerrar" data-conserva-borrador="" onClick={() => void intentarCerrar()}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <ContextoBorradores.Provider value={borradores.contexto}>
          <div className="detalle__desplazable">{contenido}</div>
        </ContextoBorradores.Provider>
        {preguntando && (
          <PreguntaSinGuardar
            ocupada={borradores.resolviendo}
            alGuardar={() => void borradores.guardar()}
            alDescartar={borradores.descartar}
            alSeguir={seguir}
          />
        )}
      </Vidrio>
    </div>,
    document.body,
  );
}

function Etiquetas({ tarea, catalogo }: { tarea: Tarea; catalogo: Catalogo }) {
  const tonoProyecto = useTonoProyecto();
  const proyecto = catalogo.proyectos.find((p) => p.id === tarea.proyectoId);
  const prioridad = catalogo.prioridades.find((p) => p.id === tarea.prioridadId);
  const urgente = prioridad?.nivel === 'inmediata';
  return (
    <div className="detalle__etiquetas">
      <Pildora color={`var(--tono-${tonoProyecto(tarea.proyectoId)})`}>{proyecto?.nombre ?? 'Proyecto sin datos'}</Pildora>
      {prioridad?.alta ? (
        <span className={unir('etiqueta-prioridad', urgente && 'etiqueta-prioridad--urgente')}>
          {urgente && <Flag size={12} aria-hidden="true" />}
          {urgente ? 'Urgente' : 'Alta'}
        </span>
      ) : (
        prioridad && <span className="detalle__prioridad">{etiquetaPrioridad(prioridad)}</span>
      )}
    </div>
  );
}

function Contenido({ idTitulo, detalle, catalogo, alBorrar }: { idTitulo: string; detalle: Detalle; catalogo: Catalogo; alBorrar: (titulo: string) => void }) {
  const { tarea, actividades } = detalle;
  const lista = useTareas();
  const [aviso, setAviso] = useState<AvisoPanel | null>(null);
  const avisos = useMemo<Avisos>(() => ({
    avisar: (campo, texto, tipo = 'error') => setAviso({ campo, texto, tipo }),
    limpiar: (campo) => setAviso((previo) => (previo?.campo === campo ? null : previo)),
  }), []);
  const edicion = useEdicionTarea(tarea.id, avisos);
  useEsperaDeEscrituras(edicion.esperar);
  const todas = lista.data?.tareas;
  const comunes = { tarea, edicion, avisos };
  const cerrada = catalogo.estados.find((e) => e.id === tarea.estadoId)?.cerrado === true;

  return (
    <>
      <header className="detalle__cabeza">
        <h2 id={idTitulo} className="sr-only">{tarea.titulo}</h2>
        <CampoTitulo {...comunes} />
        <p className="detalle__guardando" role="status">{edicion.ocupada ? 'Guardando…' : ''}</p>
      </header>
      <CampoEstado {...comunes} catalogo={catalogo} />
      {!cerrada && <BotonTrabajar tareaId={tarea.id} titulo={tarea.titulo} />}
      <EstimadoReal tarea={tarea} />
      <CamposTarea {...comunes} catalogo={catalogo} todas={todas} />
      <DescripcionTarea tarea={tarea} edicion={edicion} />
      <SeccionAdjuntos tareaId={tarea.id} catalogo={catalogo} />
      {todas && lista.data && (
        <>
          <Subtareas tarea={tarea} todas={todas} catalogo={catalogo} edicion={edicion} />
          <EsperaA tarea={tarea} todas={todas} catalogo={catalogo} edicion={edicion} dependencias={lista.data.dependencias} />
          <SeccionPausas tarea={tarea} todas={todas} catalogo={catalogo} />
        </>
      )}
      <Comentarios actividades={actividades} catalogo={catalogo} edicion={edicion} />
      <Historial actividades={actividades} />
      <SeccionBorrar tarea={tarea} alBorrar={() => alBorrar(tarea.titulo)} />
      {aviso && (
        <div className="detalle__aviso">
          <Aviso tipo={aviso.tipo}>
            <span>{aviso.texto}</span>
            <button type="button" className="tablero__aviso-cerrar" aria-label="Cerrar aviso" onClick={() => setAviso(null)}>
              <X size={16} aria-hidden="true" />
            </button>
          </Aviso>
        </div>
      )}
    </>
  );
}
