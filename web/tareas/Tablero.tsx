import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { Plus, X } from 'lucide-react';
import { NOMBRE_COLUMNA } from '../../compartido/columnas.js';
import type { Catalogo, Columna, Tarea } from '../../compartido/tipos.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { Aviso } from '../ui/Aviso.js';
import { unir } from '../ui/clases.js';
import { Vidrio } from '../ui/Vidrio.js';
import { useHorasEnCurso } from '../horas/HorasProvider.js';
import { useMoverTarea } from './acciones.js';
import {
  anunciosEnCastellano,
  coordenadasDeTeclado,
  esColumna,
  INSTRUCCIONES,
  ORDEN_COLUMNAS,
  TECLAS,
  type DatosArrastre,
} from './arrastre.js';
import { rutaDetalle, useBaseTareas } from './baseTareas.js';
import { FormularioRapido } from './FormularioRapido.js';
import { avancesPorMadre, columnaDeTarea, MSG_TRAYENDO, tareasDeColumna, type Avance } from './logica.js';
import { describirTarea, TarjetaTarea } from './TarjetaTarea.js';

// Entran las primeras de cada columna (las que se ven); las de más abajo ya están cuando se llega a ellas.
const SELECTOR_TARJETAS = '.columna__lista > [data-entra="tarjeta"]:nth-child(-n+8)';

export interface FormularioAbierto {
  columna: Columna;
  proyectoId: number | null;
  responsableId: number | null;
}

export interface TableroProps {
  /** Tareas ya filtradas. */
  tareas: Tarea[];
  /** Todas las tareas (el avance cuenta hijas aunque el filtro las esconda). */
  todas: Tarea[];
  catalogo: Catalogo;
  hoy: string;
  /** `true` cuando llegaron los datos: dispara la entrada de las tarjetas. */
  listo: boolean;
  /** `true` mientras el servidor trae por primera vez los datos de OpenProject. */
  trayendo: boolean;
  formulario: FormularioAbierto | null;
  alPedirFormulario(columna: Columna): void;
  alCerrarFormulario(): void;
  alCrear(tarea: Tarea): void;
}

export function Tablero(props: TableroProps) {
  const { tareas, todas, catalogo, hoy, listo, trayendo, formulario, alPedirFormulario, alCerrarFormulario, alCrear } = props;
  const ref = useRef<HTMLDivElement>(null);
  // Con los datos ya en caché, las tarjetas esperan a que se abran las columnas (como en la referencia);
  // si llegan después, entran apenas llegan.
  const [conDatosAlMontar] = useState(listo);
  useEntradaEscalonada(ref, [listo], SELECTOR_TARJETAS);
  const [aviso, setAviso] = useState<string | null>(null);
  const [activa, setActiva] = useState<Tarea | null>(null);
  // Tareas con un movimiento sin confirmar: no se pueden volver a arrastrar hasta que responda el servidor.
  const [enVuelo, setEnVuelo] = useState<ReadonlySet<number>>(new Set());
  // El setter va envuelto: useMoverTarea también pasa el error como segundo argumento.
  const alFallar = useCallback((mensaje: string) => setAviso(mensaje), []);
  const mover = useMoverTarea(alFallar);
  const navegar = useNavigate();
  const { search } = useLocation();
  const base = useBaseTareas();
  // Soltar una tarjeta sobre sí misma dispara un clic: ese clic no abre la tarea.
  const arrastreReciente = useRef(false);

  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: coordenadasDeTeclado, keyboardCodes: TECLAS }),
  );

  const porId = useMemo(() => new Map(tareas.map((t) => [t.id, t])), [tareas]);
  const avances = useMemo(() => avancesPorMadre(todas, catalogo), [todas, catalogo]);
  const columnas = useMemo(
    () => ORDEN_COLUMNAS.map((c) => ({ columna: c, tareas: tareasDeColumna(tareas, c, catalogo, hoy) })),
    [tareas, catalogo, hoy],
  );
  const anuncios = useMemo(
    () => anunciosEnCastellano((id: UniqueIdentifier) => porId.get(Number(id))?.titulo ?? 'sin título'),
    [porId],
  );

  const abrir = useCallback((id: number) => {
    if (!arrastreReciente.current) navegar({ pathname: rutaDetalle(base, id), search });
  }, [navegar, search, base]);

  const alEmpezar = ({ active }: DragStartEvent) => {
    arrastreReciente.current = true;
    setAviso(null);
    setActiva(porId.get(Number(active.id)) ?? null);
  };

  const terminar = () => {
    setActiva(null);
    window.setTimeout(() => {
      arrastreReciente.current = false;
    }, 0);
  };

  const alSoltar = ({ active, over }: DragEndEvent) => {
    terminar();
    const tarea = porId.get(Number(active.id));
    if (!tarea || !over || !esColumna(over.id) || columnaDeTarea(tarea, catalogo) === over.id) return;
    const id = tarea.id;
    setEnVuelo((previo) => new Set(previo).add(id));
    void mover(tarea, over.id, catalogo).finally(() =>
      setEnVuelo((previo) => new Set([...previo].filter((x) => x !== id))));
  };

  return (
    <DndContext
      sensors={sensores}
      collisionDetection={rectIntersection}
      accessibility={{ announcements: anuncios, screenReaderInstructions: INSTRUCCIONES }}
      onDragStart={alEmpezar}
      onDragEnd={alSoltar}
      onDragCancel={terminar}
    >
      <div ref={ref} className={unir('tablero', conDatosAlMontar && 'tablero--espera')}>
        {columnas.map(({ columna, tareas: deColumna }) => (
          <ColumnaTablero
            key={columna}
            columna={columna}
            tareas={deColumna}
            catalogo={catalogo}
            hoy={hoy}
            listo={listo}
            trayendo={trayendo}
            avances={avances}
            enVuelo={enVuelo}
            formulario={formulario?.columna === columna ? formulario : null}
            alPedirFormulario={alPedirFormulario}
            alCerrarFormulario={alCerrarFormulario}
            alCrear={alCrear}
            alAbrir={abrir}
          />
        ))}
      </div>
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activa && (
            <TarjetaTarea tarea={activa} catalogo={catalogo} hoy={hoy} avance={avances.get(activa.id) ?? null} levantada />
          )}
        </DragOverlay>,
        document.body,
      )}
      {aviso && (
        <div className="tablero__aviso">
          <Aviso tipo="error">
            <span>{aviso}</span>
            <button type="button" className="tablero__aviso-cerrar" aria-label="Cerrar aviso" onClick={() => setAviso(null)}>
              <X size={16} aria-hidden="true" />
            </button>
          </Aviso>
        </div>
      )}
    </DndContext>
  );
}

interface ColumnaTableroProps {
  columna: Columna;
  tareas: Tarea[];
  catalogo: Catalogo;
  hoy: string;
  listo: boolean;
  trayendo: boolean;
  avances: Map<number, Avance>;
  enVuelo: ReadonlySet<number>;
  formulario: FormularioAbierto | null;
  alPedirFormulario(columna: Columna): void;
  alCerrarFormulario(): void;
  alCrear(tarea: Tarea): void;
  alAbrir(id: number): void;
}

function textoVacio(listo: boolean, trayendo: boolean): string {
  if (!listo) return 'Cargando…';
  return trayendo ? MSG_TRAYENDO : 'Sin tareas';
}

function ColumnaTablero(props: ColumnaTableroProps) {
  const { columna, tareas, catalogo, hoy, listo, trayendo, avances, enVuelo, formulario, alPedirFormulario, alCerrarFormulario, alCrear, alAbrir } = props;
  const { setNodeRef, isOver } = useDroppable({ id: columna });
  const nombre = NOMBRE_COLUMNA[columna];
  const idTitulo = `columna-${columna}`;
  const vacia = tareas.length === 0 && formulario === null;

  return (
    <Vidrio
      as="section"
      ref={setNodeRef}
      className={unir('columna', isOver && 'columna--destino')}
      aria-labelledby={idTitulo}
    >
      <header className="columna__cabeza">
        <i className={`columna__punto columna__punto--${columna}`} aria-hidden="true" />
        <h2 id={idTitulo} className="columna__nombre">{nombre}</h2>
        <span className="columna__cuenta tnum">
          {tareas.length}
          <span className="sr-only"> {tareas.length === 1 ? 'tarea' : 'tareas'}</span>
        </span>
        <button
          type="button"
          className="columna__mas"
          aria-label={`Nueva tarea en ${nombre}`}
          aria-expanded={formulario !== null}
          onClick={() => (formulario ? alCerrarFormulario() : alPedirFormulario(columna))}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="columna__lista">
        {formulario && (
          <FormularioRapido
            columna={columna}
            catalogo={catalogo}
            proyectoId={formulario.proyectoId}
            responsableId={formulario.responsableId}
            cargandoProyectos={trayendo}
            alCrear={alCrear}
            alCerrar={alCerrarFormulario}
          />
        )}
        {tareas.map((t) => (
          <TarjetaArrastrable
            key={t.id}
            tarea={t}
            columna={columna}
            catalogo={catalogo}
            hoy={hoy}
            avance={avances.get(t.id) ?? null}
            bloqueada={enVuelo.has(t.id)}
            alAbrir={alAbrir}
          />
        ))}
        {vacia && <p className="columna__vacia">{textoVacio(listo, trayendo)}</p>}
      </div>
    </Vidrio>
  );
}

interface TarjetaArrastrableProps {
  tarea: Tarea;
  columna: Columna;
  catalogo: Catalogo;
  hoy: string;
  avance: Avance | null;
  bloqueada: boolean;
  alAbrir(id: number): void;
}

function TarjetaArrastrable({ tarea, columna, catalogo, hoy, avance, bloqueada, alAbrir }: TarjetaArrastrableProps) {
  const datos: DatosArrastre = { columna };
  const tramo = useHorasEnCurso().enMarcha.find((t) => t.tareaId === tarea.id);
  const trabajo = tramo === undefined ? null : tramo.pausado ? 'pausada' : 'trabajando';
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: tarea.id,
    data: datos,
    disabled: bloqueada,
    attributes: { roleDescription: 'tarea arrastrable' },
  });
  const alTeclear = (evento: KeyboardEvent<HTMLDivElement>) => {
    listeners?.onKeyDown?.(evento);
    if (evento.key === 'Enter' && !isDragging && !evento.defaultPrevented) alAbrir(tarea.id);
  };

  return (
    <TarjetaTarea
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={alTeclear}
      onClick={() => alAbrir(tarea.id)}
      aria-label={describirTarea(tarea, catalogo, hoy, avance, trabajo)}
      aria-busy={bloqueada || undefined}
      data-tarea-id={tarea.id}
      data-entra="tarjeta"
      className={unir(isDragging && 'tarjeta-tarea--fantasma', bloqueada && 'tarjeta-tarea--guardando')}
      tarea={tarea}
      catalogo={catalogo}
      hoy={hoy}
      avance={avance}
    />
  );
}
