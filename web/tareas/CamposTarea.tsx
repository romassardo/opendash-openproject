import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Calendar, ChevronDown, Clock, CornerLeftUp, Flag, FolderClosed, Tag, X } from 'lucide-react';
import { NOMBRE_COLUMNA } from '../../compartido/columnas.js';
import { etiquetaPrioridad } from '../../compartido/prioridades.js';
import type { CambiosTarea, Catalogo, Columna, Persona, Tarea } from '../../compartido/tipos.js';
import { Avatar } from '../ui/Avatar.js';
import { unir } from '../ui/clases.js';
import { Segmentado, type OpcionSegmentado } from '../ui/Segmentado.js';
import type { Avisos, EdicionTarea } from './accionesDetalle.js';
import { ORDEN_COLUMNAS } from './arrastre.js';
import { PreguntaMoverProyecto } from './PreguntaMoverProyecto.js';
import { escapeDescarta } from './borradores.js';
import { BuscadorTareas } from './BuscadorTareas.js';
import { descendientes, fechasValidas, leerHoras, mostrarHoras, MSG_FECHAS, MSG_HORAS, opcionesResponsable } from './edicion.js';
import { columnaDeTarea } from './logica.js';

// Campos del panel de detalle. Cada uno edita en el lugar y manda solo su propio cambio.

interface CampoProps {
  tarea: Tarea;
  edicion: EdicionTarea;
  avisos: Avisos;
}

interface Campo<T> {
  /** Lo que se muestra: el borrador mientras se edita o se guarda; si no, el valor del servidor. */
  valor: T;
  editar(valor: T): void;
  descartar(): void;
  /** Guarda `valor` con `enviar` si difiere del servidor; al terminar (bien o mal) vuelve al servidor. */
  confirmar(valor: T, enviar: () => Promise<unknown>): Promise<void>;
}

function useCampo<T>(servidor: T): Campo<T> {
  const [borrador, setBorrador] = useState<{ valor: T } | null>(null);
  // Último valor mandado y todavía sin respuesta (Enter y después salir del campo no lo mandan dos veces).
  const enviando = useRef<{ valor: T } | null>(null);
  return {
    valor: borrador ? borrador.valor : servidor,
    editar: (valor) => setBorrador({ valor }),
    descartar: () => setBorrador(null),
    async confirmar(valor, enviar) {
      if (enviando.current && Object.is(enviando.current.valor, valor)) return;
      // Igual al servidor y sin nada en camino: no hay cambio. Con algo en camino sí se manda (es volver atrás).
      if (!enviando.current && Object.is(valor, servidor)) {
        setBorrador(null);
        return;
      }
      const propio = { valor };
      enviando.current = propio;
      setBorrador({ valor });
      try {
        await enviar();
      } finally {
        if (enviando.current === propio) enviando.current = null;
        // Si mientras tanto se siguió editando, ese borrador se conserva.
        setBorrador((previo) => (previo && Object.is(previo.valor, valor) ? null : previo));
      }
    },
  };
}

const OPCIONES_ESTADO: OpcionSegmentado<Columna>[] = ORDEN_COLUMNAS.map((c) => ({ valor: c, etiqueta: NOMBRE_COLUMNA[c] }));

export function CampoEstado({ tarea, edicion, catalogo }: CampoProps & { catalogo: Catalogo }) {
  // La columna elegida se ve al instante; vuelve a la del servidor al responder.
  const [pendiente, setPendiente] = useState<Columna | null>(null);
  const elegir = async (columna: Columna) => {
    setPendiente(columna);
    await edicion.mover(columna, catalogo);
    setPendiente(null);
  };
  return (
    <Segmentado
      etiqueta="Estado"
      className="detalle__estado"
      opciones={OPCIONES_ESTADO}
      valor={pendiente ?? columnaDeTarea(tarea, catalogo)}
      onCambio={(columna) => void elegir(columna)}
    />
  );
}

interface CeldaProps {
  etiqueta: ReactNode;
  /** id del control que nombra la etiqueta; sin él la etiqueta es solo un rótulo. */
  para?: string;
  icono?: ReactNode;
  ancha?: boolean;
  children: ReactNode;
}

function Celda({ etiqueta, para, icono, ancha = false, children }: CeldaProps) {
  return (
    <div className={unir('detalle-campo', ancha && 'detalle-campo--ancho')}>
      {para ? <label className="detalle-campo__etiqueta" htmlFor={para}>{etiqueta}</label> : <span className="detalle-campo__etiqueta">{etiqueta}</span>}
      <div className="detalle-campo__valor">
        {icono && <span className="detalle-campo__icono" aria-hidden="true">{icono}</span>}
        {children}
      </div>
    </div>
  );
}

interface Opcion { valor: string; texto: string; deshabilitada?: boolean }

interface CampoSelectProps extends CampoProps {
  etiqueta: string;
  icono: ReactNode | ((valor: string) => ReactNode);
  servidor: string;
  opciones: Opcion[];
  cambios(valor: string): CambiosTarea;
  /** Si está, elegir un valor no guarda hasta que la pregunta se confirme (cancelar deja el valor del servidor). */
  pregunta?(valor: string, confirmar: () => void, cancelar: () => void): ReactNode;
}

/** Selección que guarda al elegir (o al confirmar la pregunta, si tiene). */
function CampoSelect({ etiqueta, icono, servidor, opciones, cambios, pregunta, edicion }: CampoSelectProps) {
  const id = useId();
  const campo = useCampo(servidor);
  const [pendiente, setPendiente] = useState<string | null>(null);
  const guardar = (valor: string) => void campo.confirmar(valor, () => edicion.guardar(cambios(valor)));
  return (
    <Celda etiqueta={etiqueta} para={id} icono={typeof icono === 'function' ? icono(campo.valor) : icono}>
      <select
        id={id}
        className="detalle-campo__control detalle-campo__select"
        value={campo.valor}
        onChange={(e) => {
          const valor = e.target.value;
          if (pregunta && valor !== servidor) setPendiente(valor);
          else guardar(valor);
        }}
      >
        {opciones.map((o) => <option key={o.valor} value={o.valor} disabled={o.deshabilitada}>{o.texto}</option>)}
      </select>
      <ChevronDown size={16} className="detalle-campo__flecha" aria-hidden="true" />
      {pregunta && pendiente !== null && pregunta(
        pendiente,
        () => {
          setPendiente(null);
          guardar(pendiente);
        },
        () => setPendiente(null),
      )}
    </Celda>
  );
}

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, 'es-AR');

function personaDe(id: number | null, catalogo: Catalogo): Persona | null {
  if (id === null) return null;
  return catalogo.personas.find((p) => p.id === id) ?? { id, nombre: 'Persona sin datos', login: null, email: null, avatarUrl: null };
}

/** Agrega el valor actual si no está entre las opciones (así el control no miente). */
function conActual(opciones: Opcion[], actual: string, texto: string): Opcion[] {
  return opciones.some((o) => o.valor === actual) ? opciones : [...opciones, { valor: actual, texto }];
}

/** `fecha` es la única fecha de un hito: se lee de inicio (= fin) y se guarda aparte. */
type Clave = 'inicio' | 'fin' | 'fecha';

/** Fecha: elegida en el calendario se guarda enseguida; tecleada, al confirmar (Enter o salir). */
function CampoFecha({ tarea, edicion, avisos, clave, etiqueta }: CampoProps & { clave: Clave; etiqueta: string }) {
  const id = useId();
  const servidor = (clave === 'fecha' ? tarea.inicio : tarea[clave]) ?? '';
  const campo = useCampo(servidor);
  const tecleando = useRef(false);

  const confirmar = (valor: string, entrada: HTMLInputElement) => {
    tecleando.current = false;
    // Una fecha a medio escribir llega vacía con `badInput`: no es «borrar la fecha».
    if (entrada.validity.badInput) return campo.descartar();
    const nueva = valor === '' ? null : valor;
    if (clave === 'fecha') return void campo.confirmar(valor, () => edicion.guardar({ fecha: nueva }));
    const inicio = clave === 'inicio' ? nueva : tarea.inicio;
    const fin = clave === 'fin' ? nueva : tarea.fin;
    if (!fechasValidas(inicio, fin)) {
      avisos.avisar(clave, MSG_FECHAS);
      return campo.descartar();
    }
    void campo.confirmar(valor, () => edicion.guardar(clave === 'inicio' ? { inicio: nueva } : { fin: nueva }));
  };

  return (
    <Celda etiqueta={etiqueta} para={id} icono={<Calendar size={17} />}>
      <input
        id={id}
        type="date"
        className="detalle-campo__control"
        value={campo.valor}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmar(campo.valor, e.currentTarget);
          } else if (e.key === 'Escape') {
            escapeDescarta(e, campo.valor !== servidor, campo.descartar);
          } else if (e.key !== 'Tab' && e.key !== 'Shift') {
            tecleando.current = true;
          }
        }}
        onChange={(e) => (tecleando.current ? campo.editar(e.target.value) : confirmar(e.target.value, e.target))}
        onBlur={(e) => {
          if (campo.valor !== servidor || e.currentTarget.validity.badInput) confirmar(campo.valor, e.currentTarget);
          tecleando.current = false;
        }}
      />
    </Celda>
  );
}

function CampoEstimacion({ tarea, edicion, avisos }: CampoProps) {
  const id = useId();
  const servidor = mostrarHoras(tarea.estimacionHoras);
  const campo = useCampo(servidor);
  const confirmar = () => {
    const { valida, horas } = leerHoras(campo.valor);
    if (!valida) {
      avisos.avisar('estimacionHoras', MSG_HORAS);
      return campo.descartar();
    }
    if (horas === tarea.estimacionHoras) return campo.descartar();
    void campo.confirmar(campo.valor, () => edicion.guardar({ estimacionHoras: horas }));
  };
  return (
    <Celda etiqueta={<>Estimado <span className="sr-only">(horas)</span></>} para={id} icono={<Clock size={17} />}>
      <input
        id={id}
        className="detalle-campo__control detalle-campo__horas"
        inputMode="decimal"
        autoComplete="off"
        placeholder="Sin estimar"
        value={campo.valor}
        onChange={(e) => campo.editar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmar();
          }
          escapeDescarta(e, campo.valor !== servidor, campo.descartar);
        }}
        onBlur={() => {
          if (campo.valor !== servidor) confirmar();
        }}
      />
      {campo.valor.trim() !== '' && <span className="detalle-campo__unidad" aria-hidden="true">h</span>}
    </Celda>
  );
}

function CampoMadre({ tarea, edicion, catalogo, todas }: CampoProps & { catalogo: Catalogo; todas: Tarea[] }) {
  const madre = tarea.madreId === null ? null : todas.find((t) => t.id === tarea.madreId);
  // Ni ella misma, ni sus descendientes (sería un ciclo), ni hitos (no pueden tener hijas), ni la madre actual.
  const candidatas = useMemo(() => {
    const abajo = descendientes(tarea.id, todas);
    const hitos = new Set(catalogo.tipos.filter((t) => t.esHito).map((t) => t.id));
    return todas.filter((t) => t.id !== tarea.id && t.id !== tarea.madreId && !abajo.has(t.id) && !hitos.has(t.tipoId));
  }, [tarea.id, tarea.madreId, todas, catalogo.tipos]);

  return (
    <Celda etiqueta="Tarea madre" ancha>
      <div className="detalle-madre">
        {tarea.madreId === null ? (
          <span className="detalle-madre__actual">
            <CornerLeftUp size={17} aria-hidden="true" />
            <span className="detalle-madre__vacia">Sin madre</span>
          </span>
        ) : (
          <span className="detalle-madre__actual">
            <CornerLeftUp size={17} aria-hidden="true" />
            <span className="detalle-madre__titulo">{madre?.titulo ?? `Tarea #${tarea.madreId}`}</span>
            <button
              type="button"
              className="detalle__quitar"
              aria-label="Quitar tarea madre"
              disabled={edicion.ocupada}
              onClick={() => void edicion.guardar({ madreId: null })}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </span>
        )}
        <BuscadorTareas
          etiqueta="Buscar tarea madre"
          placeholder={tarea.madreId === null ? 'Elegir una madre' : 'Cambiar de madre'}
          candidatas={candidatas}
          catalogo={catalogo}
          alElegir={(elegida) => void edicion.guardar({ madreId: elegida.id })}
        />
      </div>
    </Celda>
  );
}

export interface CamposTareaProps extends CampoProps {
  catalogo: Catalogo;
  /** Tareas visibles (para buscar la madre); `undefined` mientras carga la lista. */
  todas: Tarea[] | undefined;
}

/** Grilla de campos: responsable, proyecto, fechas, estimación, prioridad y tarea madre. */
export function CamposTarea({ tarea, edicion, avisos, catalogo, todas }: CamposTareaProps) {
  const comunes = { tarea, edicion, avisos };
  const esHito = catalogo.tipos.find((t) => t.id === tarea.tipoId)?.esHito === true;
  const responsable = String(tarea.responsableId ?? '');
  const personas = opcionesResponsable(tarea, catalogo);
  const proyectos = conActual(
    catalogo.proyectos.filter((p) => p.activo).sort(porNombre).map((p) => ({ valor: String(p.id), texto: p.nombre })),
    String(tarea.proyectoId),
    catalogo.proyectos.find((p) => p.id === tarea.proyectoId)?.nombre ?? 'Proyecto sin datos',
  );
  const prioridades = conActual(
    catalogo.prioridades.map((p) => ({ valor: String(p.id), texto: etiquetaPrioridad(p) })),
    String(tarea.prioridadId),
    'Prioridad sin datos',
  );

  // Las cerradas y bloqueadas se ven (OpenProject las rechaza al elegirlas) pero no se eligen.
  const versiones = conActual(
    [
      { valor: '', texto: 'Sin versión' },
      ...catalogo.versiones.filter((v) => v.proyectoId === tarea.proyectoId).sort(porNombre).map((v): Opcion =>
        v.estado === 'abierta' ? { valor: String(v.id), texto: v.nombre } : { valor: String(v.id), texto: `${v.nombre} (${v.estado})`, deshabilitada: true }),
    ],
    tarea.versionId === null ? '' : String(tarea.versionId),
    'Versión sin datos',
  );

  return (
    <div className="detalle-campos">
      <CampoSelect
        {...comunes}
        etiqueta="Responsable"
        icono={(valor) => <Avatar persona={personaDe(valor === '' ? null : Number(valor), catalogo)} tamano={24} />}
        servidor={responsable}
        opciones={personas}
        cambios={(valor) => ({ responsableId: valor === '' ? null : Number(valor) })}
      />
      <CampoSelect
        {...comunes}
        etiqueta="Proyecto"
        icono={<FolderClosed size={17} />}
        servidor={String(tarea.proyectoId)}
        opciones={proyectos}
        cambios={(valor) => ({ proyectoId: Number(valor) })}
        pregunta={(valor, alMover, alCancelar) => (
          <PreguntaMoverProyecto proyecto={proyectos.find((p) => p.valor === valor)?.texto ?? 'otro proyecto'} alMover={alMover} alCancelar={alCancelar} />
        )}
      />
      {esHito ? (
        <CampoFecha {...comunes} clave="fecha" etiqueta="Fecha" />
      ) : (
        <>
          <CampoFecha {...comunes} clave="inicio" etiqueta="Inicio" />
          <CampoFecha {...comunes} clave="fin" etiqueta="Fin" />
        </>
      )}
      <CampoEstimacion {...comunes} />
      <CampoSelect
        {...comunes}
        etiqueta="Prioridad"
        icono={<Flag size={17} />}
        servidor={String(tarea.prioridadId)}
        opciones={prioridades}
        cambios={(valor) => ({ prioridadId: Number(valor) })}
      />
      <CampoSelect
        {...comunes}
        etiqueta="Versión"
        icono={<Tag size={17} />}
        servidor={tarea.versionId === null ? '' : String(tarea.versionId)}
        opciones={versiones}
        cambios={(valor) => ({ versionId: valor === '' ? null : Number(valor) })}
      />
      {todas && <CampoMadre {...comunes} catalogo={catalogo} todas={todas} />}
    </div>
  );
}
