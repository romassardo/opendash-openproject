import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { X } from 'lucide-react';
import type { Actividad, Catalogo, Dependencia, Persona, Tarea } from '../../compartido/tipos.js';
import { Avatar } from '../ui/Avatar.js';
import { Boton } from '../ui/Boton.js';
import { unir } from '../ui/clases.js';
import { tiempoRelativo } from '../ui/tiempo.js';
import { anteriorEnConflicto } from '../linea/cadena.js';
import { useCambiosLinea } from '../linea/useCambiosLinea.js';
import { useVacacionesDe } from '../linea/useVacacionesDe.js';
import type { EdicionTarea } from './accionesDetalle.js';
import { BuscadorTareas } from './BuscadorTareas.js';
import { rutaDetalle, useBaseTareas } from './baseTareas.js';
import { useBorrador, useEsperaDeEscrituras, useEstadoVivo } from './borradores.js';
import { CasillaTarea, type Completador } from './CasillaTarea.js';
import { ancestros, comentariosDe, descendientes, fechaCompleta, sucesorasDe, ultimosCambios } from './edicion.js';
import { columnaDeTarea } from './logica.js';
import { TextoMarkdown } from './texto.js';

// Secciones del panel de detalle debajo de los campos.

export function Seccion({ titulo, extra, children }: { titulo: string; extra?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="detalle-seccion" aria-labelledby={id}>
      <header className="detalle-seccion__cabeza">
        <h3 id={id} className="detalle-seccion__titulo">{titulo}</h3>
        {extra}
      </header>
      {children}
    </section>
  );
}

/** Ctrl/⌘+Enter manda el formulario del campo. */
export function enviarConControl(evento: KeyboardEvent<HTMLTextAreaElement>): void {
  if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) {
    evento.preventDefault();
    evento.currentTarget.form?.requestSubmit();
  }
}

function Fecha({ instante }: { instante: string }) {
  return <time className="detalle__fecha" dateTime={instante} title={fechaCompleta(instante)}>{tiempoRelativo(instante)}</time>;
}

function personaDe(id: number | null, catalogo: Catalogo): Persona {
  if (id === null) return { id: 0, nombre: 'OpenProject', login: null, email: null, avatarUrl: null };
  return catalogo.personas.find((p) => p.id === id) ?? { id, nombre: 'Persona sin datos', login: null, email: null, avatarUrl: null };
}

interface ConTareas {
  tarea: Tarea;
  todas: Tarea[];
  catalogo: Catalogo;
  edicion: EdicionTarea;
}

/** Enlace que abre otra tarea en el panel, conservando los filtros del tablero. */
function EnlaceTarea({ tarea, className }: { tarea: Tarea; className?: string }) {
  const { search } = useLocation();
  const base = useBaseTareas();
  return <Link to={{ pathname: rutaDetalle(base, tarea.id), search }} className={unir('detalle__enlace', className)}>{tarea.titulo}</Link>;
}

export function Subtareas({ tarea, todas, catalogo, edicion }: ConTareas) {
  const hijas = useMemo(() => todas.filter((t) => t.madreId === tarea.id).sort((a, b) => a.id - b.id), [todas, tarea.id]);
  const cerradas = hijas.filter((t) => columnaDeTarea(t, catalogo) === 'cerrado').length;
  const [titulo, setTitulo] = useState('');
  const [creando, setCreando] = useState(false);
  const [enVuelo, setEnVuelo] = useState<ReadonlySet<number>>(new Set());

  // Las subtareas se mueven por la cola del detalle (que relee la tarea y avisa en su sección).
  const accion: Completador = {
    enVuelo,
    completar: async (hija, cat) => {
      setEnVuelo((previo) => new Set(previo).add(hija.id));
      try {
        await edicion.moverSubtarea(hija, columnaDeTarea(hija, cat) === 'cerrado' ? 'nuevo' : 'cerrado', cat);
      } finally {
        setEnVuelo((previo) => new Set([...previo].filter((x) => x !== hija.id)));
      }
    },
  };

  const agregar = async (evento: FormEvent) => {
    evento.preventDefault();
    const limpio = titulo.trim();
    if (limpio === '' || creando) return;
    setCreando(true);
    if (await edicion.crearSubtarea(limpio, tarea.proyectoId)) setTitulo('');
    setCreando(false);
  };

  return (
    <Seccion titulo="Subtareas" extra={<span className="detalle__cuenta tnum">{`${cerradas}/${hijas.length}`}</span>}>
      <ul className="detalle-filas" aria-label="Subtareas">
        {hijas.map((hija) => {
          const cerrada = columnaDeTarea(hija, catalogo) === 'cerrado';
          return (
            <li key={hija.id} className="detalle-fila">
              <CasillaTarea tarea={hija} catalogo={catalogo} accion={accion} />
              <EnlaceTarea tarea={hija} className={unir('detalle-fila__titulo', cerrada && 'detalle-fila__titulo--hecha')} />
              <span aria-hidden="true">
                <Avatar persona={hija.responsableId === null ? null : personaDe(hija.responsableId, catalogo)} tamano={22} />
              </span>
            </li>
          );
        })}
      </ul>
      <form className="detalle-agregar" onSubmit={(e) => void agregar(e)}>
        <input
          className="detalle__caja"
          aria-label="Nueva subtarea"
          placeholder="Agregar una subtarea"
          maxLength={255}
          autoComplete="off"
          value={titulo}
          readOnly={creando}
          onChange={(e) => setTitulo(e.target.value)}
        />
        <Boton variante="secundario" type="submit" disabled={titulo.trim() === '' || creando}>Agregar subtarea</Boton>
      </form>
    </Seccion>
  );
}

export function EsperaA({ tarea, todas, catalogo, edicion, dependencias }: ConTareas & { dependencias: Dependencia[] }) {
  const porId = useMemo(() => new Map(todas.map((t) => [t.id, t])), [todas]);
  const espera = useMemo(() => dependencias.filter((d) => d.sucesoraId === tarea.id), [dependencias, tarea.id]);
  // Las que se están agregando: no se pueden elegir de nuevo hasta que responda el servidor.
  const [agregando, setAgregando] = useState<ReadonlySet<number>>(new Set());
  const { search } = useLocation();
  const base = useBaseTareas();
  const navegar = useNavigate();
  const cambios = useCambiosLinea(useVacacionesDe(), (id) => navegar({ pathname: rutaDetalle(base, id), search }));
  // La anterior que pisa a esta tarea (la que termina más tarde), si hay.
  const pisadaPor = useMemo(() => anteriorEnConflicto(tarea.id, todas, dependencias, catalogo), [tarea.id, todas, dependencias, catalogo]);
  // Ni ella misma, ni las que ya espera, ni las que la esperan a ella (sería un ciclo), ni su familia.
  const candidatas = useMemo(() => {
    const fuera = new Set([
      tarea.id,
      ...espera.map((d) => d.predecesoraId),
      ...sucesorasDe(tarea.id, dependencias),
      ...ancestros(tarea.id, todas),
      ...descendientes(tarea.id, todas),
      ...agregando,
    ]);
    return todas.filter((t) => !fuera.has(t.id));
  }, [todas, tarea.id, espera, dependencias, agregando]);

  const agregar = async (previa: Tarea) => {
    setAgregando((previo) => new Set(previo).add(previa.id));
    await edicion.agregarEspera(previa.id);
    setAgregando((previo) => new Set([...previo].filter((x) => x !== previa.id)));
  };

  return (
    <Seccion titulo="Espera a…">
      <ul className="detalle-filas" aria-label="Espera a…">
        {espera.map((d) => {
          const previa = porId.get(d.predecesoraId);
          const nombre = previa?.titulo ?? `Tarea #${d.predecesoraId}`;
          return (
            <li key={d.id} className={unir('detalle-fila', previa && previa.id === pisadaPor?.id && 'detalle-fila--pisada')}>
              <i className={`columna__punto columna__punto--${previa ? columnaDeTarea(previa, catalogo) : 'nuevo'}`} aria-hidden="true" />
              {previa ? <EnlaceTarea tarea={previa} className="detalle-fila__titulo" /> : <span className="detalle-fila__titulo">{nombre}</span>}
              {previa && previa.id === pisadaPor?.id && (
                <span className="detalle-fila__pisa">
                  <span className="detalle-fila__aviso" role="note">{`Empieza antes de que termine «${previa.titulo}».`}</span>
                  <Boton variante="secundario" disabled={cambios.ocupado || edicion.ocupada} onClick={() => void cambios.correrDetras(tarea.id)}>Correr detrás</Boton>
                </span>
              )}
              <button
                type="button"
                className="detalle__quitar"
                aria-label={`Quitar «${nombre}» de Espera a…`}
                disabled={edicion.ocupada}
                onClick={() => void edicion.quitarEspera(d)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {espera.length === 0 && <p className="detalle__vacio">No espera a ninguna tarea.</p>}
      <BuscadorTareas
        etiqueta="Agregar a «Espera a…»"
        placeholder="Buscar una tarea que tenga que terminar antes"
        candidatas={candidatas}
        catalogo={catalogo}
        alElegir={(previa) => void agregar(previa)}
      />
    </Seccion>
  );
}

export function Comentarios({ actividades, catalogo, edicion }: { actividades: Actividad[]; catalogo: Catalogo; edicion: EdicionTarea }) {
  const comentarios = useMemo(() => comentariosDe(actividades), [actividades]);
  const [texto, setTexto, textoVivo] = useEstadoVivo('');
  const [enviando, setEnviando] = useState(false);
  const caja = useRef<HTMLTextAreaElement>(null);
  // Envío en camino: mientras tanto el texto no cuenta como sin guardar y guardar espera a este envío.
  const enVuelo = useRef<Promise<boolean> | null>(null);

  const comentar = (): Promise<boolean> => {
    if (enVuelo.current) return enVuelo.current;
    const limpio = textoVivo.current.trim();
    if (limpio === '') return Promise.resolve(true);
    setEnviando(true);
    const envio = edicion.comentar(limpio)
      .then((listo) => {
        if (listo) setTexto('');
        return listo;
      })
      .finally(() => {
        enVuelo.current = null;
        setEnviando(false);
      });
    enVuelo.current = envio;
    return envio;
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    comentar().catch(() => undefined);
  };

  // Cerrar el panel espera a que termine el envío (y a que se borre lo enviado) antes de ver qué quedó.
  const esperarEnvio = useCallback(() => enVuelo.current ?? Promise.resolve(true), []);
  useEsperaDeEscrituras(esperarEnvio);

  useBorrador('comentario', {
    sucio: () => enVuelo.current === null && textoVivo.current.trim() !== '',
    guardar: comentar,
    descartar: () => setTexto(''),
    enfocar: () => caja.current?.focus(),
  });

  return (
    <Seccion titulo="Comentarios">
      <ul className="detalle-comentarios" aria-label="Comentarios">
        {comentarios.map((a) => {
          const autor = personaDe(a.autorId, catalogo);
          return (
            <li key={a.id} className="comentario">
              <span aria-hidden="true"><Avatar persona={autor} tamano={28} /></span>
              <div className="comentario__cuerpo">
                <p className="comentario__cabeza">
                  <b>{autor.nombre}</b>
                  <Fecha instante={a.creada} />
                </p>
                <TextoMarkdown texto={a.comentario} className="comentario__texto" />
              </div>
            </li>
          );
        })}
      </ul>
      {comentarios.length === 0 && <p className="detalle__vacio">Todavía no hay comentarios.</p>}
      <form className="detalle-agregar" onSubmit={enviar}>
        <textarea
          ref={caja}
          className="detalle__caja detalle-agregar__comentario"
          aria-label="Nuevo comentario"
          placeholder="Escribí un comentario"
          rows={1}
          value={texto}
          readOnly={enviando}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={enviarConControl}
        />
        <Boton variante="secundario" type="submit" disabled={texto.trim() === '' || enviando}>Comentar</Boton>
      </form>
    </Seccion>
  );
}

export function Historial({ actividades }: { actividades: Actividad[] }) {
  const cambios = useMemo(() => ultimosCambios(actividades), [actividades]);
  return (
    <Seccion titulo="Historial">
      {cambios.length === 0 ? (
        <p className="detalle__vacio">Sin cambios registrados.</p>
      ) : (
        <ul className="detalle-historial" aria-label="Historial">
          {cambios.map((c) => (
            <li key={c.clave} className="detalle-historial__linea">
              <span>{c.texto}</span>
              <Fecha instante={c.creada} />
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}
