import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import { Calendar, Check, Flag, MessageSquare } from 'lucide-react';
import type { Catalogo, Persona, Tarea } from '../../compartido/tipos.js';
import { BotonJugarChico } from '../horas/BotonJugarChico.js';
import { horasDe } from '../linea/horas.js';
import { Avatar } from '../ui/Avatar.js';
import { unir } from '../ui/clases.js';
import { Pildora } from '../ui/Pildora.js';
import { useTonoProyecto } from '../ui/useTonoProyecto.js';
import { HorasTarea } from './HorasTarea.js';
import { fechaAmigable, vencida, type Avance } from './logica.js';

export interface TarjetaTareaProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
  tarea: Tarea;
  catalogo: Catalogo;
  hoy: string;
  avance: Avance | null;
  /** La copia que sigue al puntero mientras se arrastra. */
  levantada?: boolean;
}

interface Prioridad { texto: string; urgente: boolean }

/** Etiqueta de prioridad: solo para las altas («Immediate» se muestra como urgente). */
function prioridadDe(tarea: Tarea, catalogo: Catalogo): Prioridad | null {
  const prioridad = catalogo.prioridades.find((p) => p.id === tarea.prioridadId);
  if (!prioridad?.alta) return null;
  const urgente = prioridad.nivel === 'inmediata';
  return { texto: urgente ? 'Urgente' : 'Alta', urgente };
}

function responsableDe(tarea: Tarea, catalogo: Catalogo): Persona | null {
  if (tarea.responsableId === null) return null;
  return catalogo.personas.find((p) => p.id === tarea.responsableId)
    ?? { id: tarea.responsableId, nombre: 'Persona sin datos', login: null, email: null, avatarUrl: null };
}

const estaCerrada = (tarea: Tarea, catalogo: Catalogo): boolean =>
  catalogo.estados.find((e) => e.id === tarea.estadoId)?.cerrado === true;

/** Nombre accesible de la tarjeta: todo lo que se ve, en una frase. */
export function describirTarea(tarea: Tarea, catalogo: Catalogo, hoy: string, avance: Avance | null, trabajo: 'trabajando' | 'pausada' | null = null): string {
  const partes = [`Tarea ${tarea.titulo}`];
  const proyecto = catalogo.proyectos.find((p) => p.id === tarea.proyectoId);
  if (proyecto) partes.push(`proyecto ${proyecto.nombre}`);
  const prioridad = prioridadDe(tarea, catalogo);
  if (prioridad) partes.push(`prioridad ${prioridad.texto.toLocaleLowerCase('es-AR')}`);
  if (avance) partes.push(`${avance.hechas} de ${avance.total} subtareas cerradas`);
  if (tarea.fin) {
    const venció = vencida(tarea, hoy, catalogo);
    partes.push(`${venció ? 'venció' : 'vence'} ${fechaAmigable(tarea.fin, hoy).toLocaleLowerCase('es-AR')}`);
  }
  const horas = horasDe(tarea, estaCerrada(tarea, catalogo));
  if (horas) partes.push(horas.descripcion);
  if ((tarea.comentarios ?? 0) > 0) partes.push(`${tarea.comentarios} ${tarea.comentarios === 1 ? 'comentario' : 'comentarios'}`);
  const responsable = responsableDe(tarea, catalogo);
  partes.push(responsable ? `responsable ${responsable.nombre}` : 'sin asignar');
  if (trabajo === 'trabajando') partes.push('trabajando ahora');
  if (trabajo === 'pausada') partes.push('cronómetro en pausa');
  return partes.join(', ');
}

/** Tarjeta de una tarea en el tablero (solo presentación; el arrastre lo agrega el tablero). */
export function TarjetaTarea({ tarea, catalogo, hoy, avance, levantada = false, className, style, ref, ...resto }: TarjetaTareaProps) {
  const tonoProyecto = useTonoProyecto();
  const proyecto = catalogo.proyectos.find((p) => p.id === tarea.proyectoId);
  const tono = `var(--tono-${tonoProyecto(tarea.proyectoId)})`;
  const prioridad = prioridadDe(tarea, catalogo);
  const cerrada = estaCerrada(tarea, catalogo);
  const estaVencida = vencida(tarea, hoy, catalogo);
  const comentarios = tarea.comentarios ?? 0;
  const estilo = { ...style, '--tarjeta-tono': tono } as CSSProperties;

  return (
    <div
      ref={ref}
      {...resto}
      style={estilo}
      className={unir('tarjeta-tarea', levantada && 'tarjeta-tarea--levantada', className)}
    >
      <div className="tarjeta__etiquetas">
        <Pildora color={tono} className="tarjeta__proyecto">{proyecto?.nombre ?? 'Proyecto sin datos'}</Pildora>
        {prioridad && (
          <span className={unir('etiqueta-prioridad', prioridad.urgente && 'etiqueta-prioridad--urgente')}>
            {prioridad.urgente && <Flag size={12} aria-hidden="true" />}
            {prioridad.texto}
          </span>
        )}
        <HorasTarea tarea={tarea} cerrada={cerrada} />
      </div>
      <p className={unir('tarjeta__titulo-tarea', cerrada && 'tarjeta__titulo-tarea--hecha')}>
        {cerrada && (
          <span className="tarjeta__hecha" aria-hidden="true">
            <Check size={12} />
          </span>
        )}
        <span>{tarea.titulo}</span>
      </p>
      {avance && (
        <div className="tarjeta__avance">
          <span className="tarjeta__avance-pista">
            <span className="tarjeta__avance-relleno" style={{ width: `${(avance.hechas / avance.total) * 100}%` }} />
          </span>
          <span className="tnum">{`${avance.hechas}/${avance.total}`}</span>
        </div>
      )}
      <div className="tarjeta__pie">
        {tarea.fin && (
          <span
            className={unir(
              'tarjeta__fecha',
              estaVencida && 'tarjeta__fecha--vencida',
              !cerrada && tarea.fin === hoy && 'tarjeta__fecha--hoy',
            )}
          >
            {cerrada ? <Check size={15} aria-hidden="true" /> : <Calendar size={15} aria-hidden="true" />}
            {fechaAmigable(tarea.fin, hoy)}
          </span>
        )}
        {comentarios > 0 && (
          <span className="tarjeta__comentarios">
            <MessageSquare size={15} aria-hidden="true" />
            <span className="tnum">{comentarios}</span>
          </span>
        )}
        {!cerrada && !levantada && <BotonJugarChico tareaId={tarea.id} titulo={tarea.titulo} />}
        <Avatar persona={responsableDe(tarea, catalogo)} tamano={22} className="tarjeta__avatar" />
      </div>
    </div>
  );
}
