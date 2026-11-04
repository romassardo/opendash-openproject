import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { Calendar, Flag, MapPin, Video } from 'lucide-react';
import type { Catalogo, EstadoCalendario, Reunion, Tarea } from '../../compartido/tipos.js';
import { enCurso } from '../../compartido/calendario.js';
import { IconoPlataforma } from '../calendario/IconoPlataforma.js';
import { desdeCuando, duracionTexto, enlaceSeguro, horaTexto } from '../calendario/logica.js';
import { Anillos } from '../graficos/Anillos.js';
import { Barras } from '../graficos/Barras.js';
import { fechaAmigable, vencida } from '../tareas/logica.js';
import { CasillaTarea, type Completador } from '../tareas/CasillaTarea.js';
import { Aviso } from '../ui/Aviso.js';
import { unir } from '../ui/clases.js';
import { Pildora } from '../ui/Pildora.js';
import { useTonoProyecto } from '../ui/useTonoProyecto.js';
import { Variacion } from '../ui/Variacion.js';
import { Vidrio } from '../ui/Vidrio.js';
import { horasTexto, type AgendaHoy, type semanaEquipo } from './logica.js';

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function Cabeza({ id, titulo, subtitulo, extra }: { id: string; titulo: string; subtitulo: string; extra?: ReactNode }) {
  return (
    <header className="inicio__cabeza">
      <div>
        <h2 id={id} className="tarjeta__titulo">{titulo}</h2>
        <p className="tarjeta__sub">{subtitulo}</p>
      </div>
      {extra}
    </header>
  );
}

export interface TarjetaHoyProps {
  hechas: number;
  paraHoy: number;
  horas: number;
  metaHoras: number;
  /** Solo con calendario conectado: las que ya terminaron y las del día. */
  reuniones?: { pasadas: number; total: number };
}

/** «Hoy»: anillos de tareas, horas y (con calendario) reuniones, con su leyenda. */
export function TarjetaHoy({ hechas, paraHoy, horas, metaHoras, reuniones }: TarjetaHoyProps) {
  return (
    <Vidrio as="section" className="inicio__tarjeta inicio__tarjeta--4" aria-labelledby="inicio-hoy">
      <Cabeza id="inicio-hoy" titulo="Hoy" subtitulo="Cerrá tus anillos" />
      <div className="inicio__anillos">
        <Anillos
          anillos={[
            { valor: hechas, total: paraHoy, tono: 'hoy-tareas', etiqueta: 'Tareas' },
            { valor: horas, total: metaHoras, tono: 'hoy-horas', etiqueta: 'Horas', unidad: 'h', vivo: true },
            ...(reuniones ? [{ valor: reuniones.pasadas, total: reuniones.total, tono: 'hoy-reunion' as const, etiqueta: 'Reuniones' }] : []),
          ]}
        />
        <dl className="inicio__leyenda">
          <div className="inicio__leyenda-fila" style={{ '--leyenda-color': 'var(--hoy-tareas)' } as CSSProperties}>
            <dt>Tareas</dt>
            <dd className="contador__valor tnum"><b>{hechas}</b><small>{`/ ${paraHoy}`}</small></dd>
          </div>
          <div className="inicio__leyenda-fila" style={{ '--leyenda-color': 'var(--hoy-horas)' } as CSSProperties}>
            <dt>Horas</dt>
            <dd className="contador__valor tnum"><b>{horasTexto(horas)}</b><small>{`/ ${horasTexto(metaHoras)}`}</small></dd>
          </div>
          {reuniones && (
            <div className="inicio__leyenda-fila" style={{ '--leyenda-color': 'var(--hoy-reunion)' } as CSSProperties}>
              <dt>Reuniones</dt>
              <dd className="contador__valor tnum"><b>{reuniones.pasadas}</b><small>{`/ ${reuniones.total}`}</small></dd>
            </div>
          )}
        </dl>
      </div>
    </Vidrio>
  );
}

export interface BotonProximaProps {
  agenda: AgendaHoy;
}

/** «Próxima: 11:00»: abre el enlace de la reunión en curso o la siguiente; sin enlace, lleva al Calendario. */
export function BotonProxima({ agenda }: BotonProximaProps) {
  const reunion = agenda.actual ?? agenda.siguiente;
  if (!reunion) return null;
  const nombre = `Próxima: ${horaTexto(reunion.inicio)}`;
  const contenido = <><span className="boton__icono" aria-hidden="true"><Video /></span>{nombre}</>;
  const enlace = enlaceSeguro(reunion.enlace);
  const nombreAccesible = `${nombre}, «${reunion.titulo}»`;
  return enlace ? (
    <a
      className="boton boton--secundario"
      data-variante="secundario"
      href={enlace}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${nombreAccesible}. Se abre en otra pestaña`}
    >{contenido}</a>
  ) : (
    <Link className="boton boton--secundario" data-variante="secundario" to="/calendario" aria-label={nombreAccesible}>{contenido}</Link>
  );
}

function ReunionPrincipal({ reunion, enCurso }: { reunion: Reunion; enCurso: boolean }) {
  const enlace = enlaceSeguro(reunion.enlace);
  return (
    <div className="inicio__proximo">
      <div className="inicio__proximo-hora tnum">
        <b>{horaTexto(reunion.inicio)}</b>
        <span>{duracionTexto(reunion)}</span>
      </div>
      <div className="inicio__proximo-cuerpo">
        <h3 className="inicio__proximo-titulo">{reunion.titulo}</h3>
        {reunion.lugar && <span className="inicio__proximo-lugar"><MapPin size={14} aria-hidden="true" />{reunion.lugar}</span>}
        {(enCurso || enlace) && (
          <span className="inicio__proximo-acciones">
            {enCurso && <span className="pildora-ahora">Ahora</span>}
            {enlace && (
              <a
                className="boton boton--secundario"
                data-variante="secundario"
                href={enlace}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Unirse a «${reunion.titulo}»`}
              >
                <IconoPlataforma plataforma={reunion.plataforma} />
                Unirse
              </a>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export interface TarjetaProximoProps {
  agenda: AgendaHoy;
  /** Cómo viene la consulta del calendario: lo que se muestra depende de si ya se sabe si hay calendario. */
  carga: 'cargando' | 'error' | 'lista';
  conectado: boolean;
  estado: EstadoCalendario | null;
  ahora: Date;
}

/** «Próximo»: la reunión en curso o la siguiente y, debajo, las demás de hoy que no terminaron. */
export function TarjetaProximo({ agenda, carga, conectado, estado, ahora }: TarjetaProximoProps) {
  const principal = agenda.actual ?? agenda.siguiente;
  const momento = ahora.getTime();
  const demas = agenda.reuniones.filter((r) => r !== principal && Date.parse(r.fin) > momento);
  return (
    <Vidrio as="section" className="inicio__tarjeta inicio__tarjeta--4" aria-labelledby="inicio-proximo">
      <Cabeza
        id="inicio-proximo"
        titulo="Próximo"
        subtitulo="Tu agenda de hoy"
        extra={conectado ? <Link to="/calendario" className="inicio__enlace">Calendario</Link> : undefined}
      />
      {carga === 'cargando' ? (
        <p className="inicio__vacio">Cargando tu agenda…</p>
      ) : carga === 'error' ? (
        <Aviso tipo="error">No se pudo cargar tu calendario.</Aviso>
      ) : !conectado ? (
        <p className="inicio__vacio">
          <Link to="/configuracion#configuracion-cuenta" className="inicio__enlace">Conectá tu calendario de Outlook para ver tus reuniones acá</Link>
        </p>
      ) : (
        <>
          {estado?.falla && (
            <p className="inicio__sin-actualizar">{estado.leido ? `Sin actualizar desde ${desdeCuando(estado.leido, ahora)}` : 'Sin actualizar'}</p>
          )}
          {principal ? <ReunionPrincipal reunion={principal} enCurso={principal === agenda.actual} /> : <p className="inicio__vacio">No te quedan reuniones hoy.</p>}
          {demas.length > 0 && (
            <ul className="inicio__demas">
              {demas.map((r) => (
                <li key={r.id} className="inicio__demas-fila">
                  <b className="tnum">{horaTexto(r.inicio)}</b>
                  <span>{r.titulo}</span>
                  {enCurso(r, ahora) && <span className="pildora-ahora">Ahora</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Vidrio>
  );
}

export interface TarjetaMisTareasProps {
  mias: Tarea[];
  catalogo: Catalogo;
  hoy: string;
  accion: Completador;
  /** Motivo de que no se pudo cerrar o reabrir una tarea. */
  aviso: string | null;
}

function FilaMia({ tarea, catalogo, hoy, accion }: { tarea: Tarea; catalogo: Catalogo; hoy: string; accion: Completador }) {
  const tonoProyecto = useTonoProyecto();
  const proyecto = catalogo.proyectos.find((p) => p.id === tarea.proyectoId);
  const prioridad = catalogo.prioridades.find((p) => p.id === tarea.prioridadId);
  const alta = prioridad?.alta === true;
  const urgente = alta && prioridad?.nivel === 'inmediata';
  const estaVencida = vencida(tarea, hoy, catalogo);
  return (
    <li className={unir('inicio__fila', accion.enVuelo.has(tarea.id) && 'inicio__fila--guardando')}>
      <CasillaTarea tarea={tarea} catalogo={catalogo} accion={accion} />
      <div className="inicio__fila-texto">
        <Link to={`/tareas/${tarea.id}`} className="inicio__fila-titulo">{tarea.titulo}</Link>
        <span className="inicio__fila-meta">
          <Pildora color={`var(--tono-${tonoProyecto(tarea.proyectoId)})`}>{proyecto?.nombre ?? 'Proyecto sin datos'}</Pildora>
          {tarea.fin && (
            <span className={unir('tarjeta__fecha', estaVencida && 'tarjeta__fecha--vencida', tarea.fin === hoy && 'tarjeta__fecha--hoy')}>
              <Calendar size={15} aria-hidden="true" />
              {fechaAmigable(tarea.fin, hoy)}
            </span>
          )}
        </span>
      </div>
      {alta && (
        <span className={unir('etiqueta-prioridad', urgente && 'etiqueta-prioridad--urgente')}>
          {urgente && <Flag size={12} aria-hidden="true" />}
          {urgente ? 'Urgente' : 'Alta'}
        </span>
      )}
    </li>
  );
}

/** «Mis tareas»: lo que vence hoy o está atrasado, con casilla para cerrarlas. */
export function TarjetaMisTareas({ mias, catalogo, hoy, accion, aviso }: TarjetaMisTareasProps) {
  return (
    <Vidrio as="section" className="inicio__tarjeta inicio__tarjeta--5" aria-labelledby="inicio-mias">
      <Cabeza
        id="inicio-mias"
        titulo="Mis tareas"
        subtitulo="Vencen hoy o están atrasadas"
        extra={<Link to="/tareas?persona=mias" className="inicio__enlace">Todas</Link>}
      />
      {aviso && <Aviso tipo="error">{aviso}</Aviso>}
      {mias.length === 0 ? (
        <p className="inicio__vacio">No tenés tareas para hoy.</p>
      ) : (
        <ul className="inicio__filas">
          {mias.map((t) => <FilaMia key={t.id} tarea={t} catalogo={catalogo} hoy={hoy} accion={accion} />)}
        </ul>
      )}
    </Vidrio>
  );
}

export interface TarjetaSemanaProps {
  semana: ReturnType<typeof semanaEquipo>;
  /** Posición de hoy dentro de la semana (0 = lunes). */
  indiceHoy: number;
}

const cantidadTexto = (n: number): string => `${n} ${n === 1 ? 'tarea' : 'tareas'}`;

/** «Esta semana»: lo que cerró el equipo cada día y cómo viene contra la semana pasada. */
export function TarjetaSemana({ semana, indiceHoy }: TarjetaSemanaProps) {
  const barras = semana.dias.map((d, i) => ({ etiqueta: DIAS_SEMANA[i] ?? d.fecha, valor: d.cantidad }));
  return (
    <Vidrio as="section" className="inicio__tarjeta inicio__tarjeta--4 inicio__tarjeta--baja" aria-labelledby="inicio-semana">
      <Cabeza id="inicio-semana" titulo="Esta semana" subtitulo="Tareas que cerró el equipo" />
      <p className="inicio__resumen">
        <span>{`${semana.total} ${semana.total === 1 ? 'cerrada' : 'cerradas'} hasta ahora`}</span>
        <Variacion valor={semana.variacion} unidad="%" />
        <span className="inicio__resumen-contra">vs. la semana pasada</span>
      </p>
      <div className="inicio__barras">
        <Barras barras={barras} formato={cantidadTexto} destacar={indiceHoy} />
      </div>
    </Vidrio>
  );
}
