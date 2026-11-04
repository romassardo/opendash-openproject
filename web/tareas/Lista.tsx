import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Calendar, ChevronDown, Flag, X } from 'lucide-react';
import { NOMBRE_COLUMNA } from '../../compartido/columnas.js';
import type { Catalogo, Columna, Persona, Tarea } from '../../compartido/tipos.js';
import { BotonJugarChico } from '../horas/BotonJugarChico.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { Aviso } from '../ui/Aviso.js';
import { Avatar } from '../ui/Avatar.js';
import { unir } from '../ui/clases.js';
import { Pildora } from '../ui/Pildora.js';
import { Segmentado, type OpcionSegmentado } from '../ui/Segmentado.js';
import { useTonoProyecto } from '../ui/useTonoProyecto.js';
import { Vidrio } from '../ui/Vidrio.js';
import { rutaDetalle, useBaseTareas } from './baseTareas.js';
import { CasillaTarea, useCompletarTarea, type Completador } from './CasillaTarea.js';
import { HorasTarea } from './HorasTarea.js';
import { avancesPorMadre, fechaAmigable, MSG_TRAYENDO, tareasDeColumna, vencida, type Avance } from './logica.js';
import { esOrdenLista, ordenarTareas, ORDEN_INICIAL, type OrdenLista } from './ordenLista.js';

const CLAVE_ORDEN = 'od:orden-lista';
const CLAVE_COLAPSADOS = 'od:grupos-lista';
const COLUMNAS: Columna[] = ['nuevo', 'curso', 'pausa', 'cerrado'];
// Entran las filas que se ven; el resto ya está cuando se baja.
const FILAS_CON_ENTRADA = 14;

const ORDENES: OpcionSegmentado<OrdenLista>[] = [
  { valor: 'vencimiento', etiqueta: 'Vencimiento' },
  { valor: 'prioridad', etiqueta: 'Prioridad' },
];

function leerOrden(): OrdenLista {
  try {
    const guardado = window.localStorage.getItem(CLAVE_ORDEN);
    return esOrdenLista(guardado) ? guardado : ORDEN_INICIAL;
  } catch {
    return ORDEN_INICIAL;
  }
}

function leerColapsados(): ReadonlySet<Columna> {
  try {
    const guardado: unknown = JSON.parse(window.localStorage.getItem(CLAVE_COLAPSADOS) ?? '[]');
    return new Set(Array.isArray(guardado) ? COLUMNAS.filter((c) => guardado.includes(c)) : []);
  } catch {
    return new Set();
  }
}

function guardar(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento la preferencia simplemente no se recuerda.
  }
}

export interface ListaProps {
  tareas: Tarea[];
  todas: Tarea[];
  catalogo: Catalogo;
  hoy: string;
  /** `true` mientras el servidor trae por primera vez los datos de OpenProject. */
  trayendo?: boolean;
  /** Título del grupo de arriba: el de la pantalla (por defecto, el de todas las tareas). */
  titulo?: string;
}

function responsableDe(tarea: Tarea, catalogo: Catalogo): Persona | null {
  if (tarea.responsableId === null) return null;
  return catalogo.personas.find((p) => p.id === tarea.responsableId)
    ?? { id: tarea.responsableId, nombre: 'Persona sin datos', login: null, email: null, avatarUrl: null };
}

/** Las mismas tareas que el tablero, en grupos por columna y ordenadas dentro de cada una. */
export function Lista({ tareas, todas, catalogo, hoy, trayendo = false, titulo = 'Todas las tareas' }: ListaProps) {
  const ref = useRef<HTMLElement>(null);
  const [orden, setOrden] = useState<OrdenLista>(leerOrden);
  const [colapsados, setColapsados] = useState<ReadonlySet<Columna>>(leerColapsados);
  const [aviso, setAviso] = useState<string | null>(null);
  const completador = useCompletarTarea(setAviso);
  // Un intento nuevo borra el aviso del anterior.
  const accion: Completador = {
    enVuelo: completador.enVuelo,
    completar: (tarea, cat) => {
      setAviso(null);
      return completador.completar(tarea, cat);
    },
  };
  const navegar = useNavigate();
  const { search } = useLocation();
  const base = useBaseTareas();

  const avances = useMemo(() => avancesPorMadre(todas, catalogo), [todas, catalogo]);
  const grupos = useMemo(
    () => COLUMNAS
      .map((columna) => ({ columna, tareas: ordenarTareas(tareasDeColumna(tareas, columna, catalogo, hoy), orden, catalogo) }))
      .filter((g) => g.tareas.length > 0),
    [tareas, catalogo, hoy, orden],
  );
  const total = grupos.reduce((suma, g) => suma + g.tareas.length, 0);

  useEntradaEscalonada(ref, [], '[data-entra="fila"]');

  const elegirOrden = (nuevo: OrdenLista) => {
    setOrden(nuevo);
    guardar(CLAVE_ORDEN, nuevo);
  };

  const alternarGrupo = (columna: Columna) => {
    const nuevos = new Set(colapsados);
    if (!nuevos.delete(columna)) nuevos.add(columna);
    setColapsados(nuevos);
    guardar(CLAVE_COLAPSADOS, JSON.stringify([...nuevos]));
  };

  const abrir = useCallback((id: number) => navegar({ pathname: rutaDetalle(base, id), search }), [navegar, search, base]);

  let indiceFila = 0;
  return (
    <>
      <Vidrio as="section" ref={ref} className="lista" aria-labelledby="lista-titulo">
        <div className="lista__desplazable">
          <header className="lista__cabeza">
            <div>
              <h2 id="lista-titulo" className="lista__titulo-grupo">{titulo}</h2>
              <p className="lista__sub">{`${total} en el tablero`}</p>
            </div>
            <Segmentado etiqueta="Ordenar por" tamano="chico" opciones={ORDENES} valor={orden} onCambio={elegirOrden} />
          </header>
          {grupos.map(({ columna, tareas: deGrupo }) => {
            const abierto = !colapsados.has(columna);
            const idGrupo = `lista-grupo-${columna}`;
            return (
              <section key={columna} className="lista__grupo" aria-labelledby={idGrupo}>
                <h3 className="lista__grupo-cabeza">
                  <button type="button" id={idGrupo} className="lista__grupo-boton" aria-expanded={abierto} onClick={() => alternarGrupo(columna)}>
                    <ChevronDown size={16} className={unir('lista__chevron', !abierto && 'lista__chevron--cerrado')} aria-hidden="true" />
                    <i className={`columna__punto columna__punto--${columna}`} aria-hidden="true" />
                    <span>{NOMBRE_COLUMNA[columna]}</span>
                    <span className="columna__cuenta tnum">
                      {deGrupo.length}
                      <span className="sr-only"> {deGrupo.length === 1 ? 'tarea' : 'tareas'}</span>
                    </span>
                  </button>
                </h3>
                {abierto && (
                  <ul className="lista__filas">
                    {deGrupo.map((tarea) => (
                      <FilaTarea
                        key={tarea.id}
                        tarea={tarea}
                        catalogo={catalogo}
                        hoy={hoy}
                        cerrada={columna === 'cerrado'}
                        avance={avances.get(tarea.id) ?? null}
                        accion={accion}
                        conEntrada={indiceFila++ < FILAS_CON_ENTRADA}
                        alAbrir={abrir}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {total === 0 && <p className="columna__vacia">{trayendo ? MSG_TRAYENDO : 'Sin tareas'}</p>}
        </div>
      </Vidrio>
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
    </>
  );
}

interface FilaTareaProps {
  tarea: Tarea;
  catalogo: Catalogo;
  hoy: string;
  cerrada: boolean;
  avance: Avance | null;
  accion: Completador;
  conEntrada: boolean;
  alAbrir(id: number): void;
}

function FilaTarea({ tarea, catalogo, hoy, cerrada, avance, accion, conEntrada, alAbrir }: FilaTareaProps) {
  const tonoProyecto = useTonoProyecto();
  const proyecto = catalogo.proyectos.find((p) => p.id === tarea.proyectoId);
  const tono = `var(--tono-${tonoProyecto(tarea.proyectoId)})`;
  const prioridad = catalogo.prioridades.find((p) => p.id === tarea.prioridadId);
  const alta = prioridad?.alta === true;
  const urgente = alta && prioridad?.nivel === 'inmediata';
  const estaVencida = vencida(tarea, hoy, catalogo);
  const guardando = accion.enVuelo.has(tarea.id);

  return (
    <li
      data-entra={conEntrada ? 'fila' : undefined}
      aria-busy={guardando || undefined}
      className={unir('lista__fila', guardando && 'lista__fila--guardando')}
      style={{ '--tarjeta-tono': tono } as CSSProperties}
      onClick={() => alAbrir(tarea.id)}
    >
      <CasillaTarea tarea={tarea} catalogo={catalogo} accion={accion} />
      <span className={unir('lista__nombre', cerrada && 'lista__nombre--hecha')}>
        <button type="button" className="lista__texto" data-tarea-id={tarea.id} onClick={(evento) => { evento.stopPropagation(); alAbrir(tarea.id); }}>{tarea.titulo}</button>
        {avance && (
          <span className="lista__avance tarjeta__avance">
            <span className="tarjeta__avance-pista">
              <span className="tarjeta__avance-relleno" style={{ width: `${(avance.hechas / avance.total) * 100}%` }} />
            </span>
            <span className="tnum">{`${avance.hechas}/${avance.total}`}</span>
          </span>
        )}
        <HorasTarea tarea={tarea} cerrada={cerrada} />
      </span>
      <Pildora color={tono} className="tarjeta__proyecto">{proyecto?.nombre ?? 'Proyecto sin datos'}</Pildora>
      <span className="lista__fecha">
        {tarea.fin && (
          <span className={unir('tarjeta__fecha', estaVencida && 'tarjeta__fecha--vencida', !cerrada && tarea.fin === hoy && 'tarjeta__fecha--hoy')}>
            <Calendar size={15} aria-hidden="true" />
            {fechaAmigable(tarea.fin, hoy)}
          </span>
        )}
      </span>
      <span className="lista__prioridad">
        {alta && (
          <span className={unir('etiqueta-prioridad', urgente && 'etiqueta-prioridad--urgente')}>
            {urgente && <Flag size={12} aria-hidden="true" />}
            {urgente ? 'Urgente' : 'Alta'}
          </span>
        )}
      </span>
      <span className="lista__horas">{!cerrada && <BotonJugarChico tareaId={tarea.id} titulo={tarea.titulo} />}</span>
      <Avatar persona={responsableDe(tarea, catalogo)} tamano={28} />
    </li>
  );
}
