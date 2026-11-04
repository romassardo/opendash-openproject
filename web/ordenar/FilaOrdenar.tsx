import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, CalendarClock, UserPlus } from 'lucide-react';
import type { Catalogo, Persona, Tarea } from '../../compartido/tipos.js';
import { CasillaTarea, type Completador } from '../tareas/CasillaTarea.js';
import { Avatar } from '../ui/Avatar.js';
import { Boton } from '../ui/Boton.js';
import { unir } from '../ui/clases.js';
import { Pildora } from '../ui/Pildora.js';
import { useTonoProyecto } from '../ui/useTonoProyecto.js';
import type { FilaTarea } from './logica.js';

export type Globo = 'fechas' | 'responsable';

export interface FilaOrdenarProps {
  fila: FilaTarea;
  catalogo: Catalogo;
  accion: Completador;
  /** `true` mientras la fila arreglada sale con su animación. */
  sale: boolean;
  /** Dibuja el globito (fechas o responsable) que cuelga del botón de esta fila, con el id que el botón señala; `null` si está cerrado. */
  globo: ((idGlobo: string) => ReactNode) | null;
  alAbrir(id: number): void;
  alCorrerDetras(sucesoraId: number): void;
  alPedirGlobo(globo: Globo): void;
}

const ETIQUETA: Record<FilaTarea['seccion'], string> = {
  pisan: 'Correr detrás', vencidas: 'Cambiar fechas', sinFechas: 'Poner fechas', sinAsignar: 'Elegir responsable',
};

function responsableDe(tarea: Tarea, catalogo: Catalogo): Persona | null {
  if (tarea.responsableId === null) return null;
  return catalogo.personas.find((p) => p.id === tarea.responsableId)
    ?? { id: tarea.responsableId, nombre: 'Persona sin datos', login: null, email: null, avatarUrl: null };
}

/** Después de un arreglo el foco pasa a la fila siguiente (o a la última que queda, o a «Todo en orden»). */
function enfocarSiguiente(fila: HTMLElement): void {
  const pantalla = fila.closest('.pantalla-ordenar');
  const vivas = [...(pantalla?.querySelectorAll<HTMLElement>('li.ordenar__fila:not(.ordenar__fila--sale) button.ordenar__titulo') ?? [])];
  const siguiente = vivas.find((el) => (fila.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) ?? vivas.at(-1);
  (siguiente ?? pantalla?.querySelector<HTMLElement>('.ordenar__orden'))?.focus();
}

export function FilaOrdenar({ fila, catalogo, accion, sale, globo, alAbrir, alCorrerDetras, alPedirGlobo }: FilaOrdenarProps) {
  const tonoProyecto = useTonoProyecto();
  const { tarea, seccion } = fila;
  const proyecto = catalogo.proyectos.find((p) => p.id === tarea.proyectoId);
  const idGlobo = useId();
  const elemento = useRef<HTMLLIElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const hubo = useRef(false);
  const estabaAbierto = useRef(false);
  const abierto = globo !== null;
  // Solo se mueve el foco si estaba en esta fila (o se perdió en el body al irse el botón o el globito).
  const focoAqui = (): boolean => document.activeElement === document.body || (elemento.current?.contains(document.activeElement) ?? false);
  useEffect(() => {
    if (estabaAbierto.current && !abierto && !sale && hubo.current && focoAqui()) boton.current?.focus();
    estabaAbierto.current = abierto;
  }, [abierto, sale]);
  useEffect(() => {
    if (sale && hubo.current && elemento.current && focoAqui()) enfocarSiguiente(elemento.current);
  }, [sale]);
  const tono = `var(--tono-${tonoProyecto(tarea.proyectoId)})`;
  const icono = seccion === 'pisan' ? <ArrowRight /> : seccion === 'sinAsignar' ? <UserPlus /> : <CalendarClock />;
  const alHacer = () => {
    if (seccion === 'pisan') alCorrerDetras(tarea.id);
    else alPedirGlobo(seccion === 'sinAsignar' ? 'responsable' : 'fechas');
  };

  return (
    <li
      ref={elemento}
      onFocusCapture={() => { hubo.current = true; }}
      onBlurCapture={(e) => { if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) hubo.current = false; }}
      className={unir('ordenar__fila', sale && 'ordenar__fila--sale')}
      style={{ '--tarjeta-tono': tono } as CSSProperties}
      aria-hidden={sale || undefined}
    >
      <CasillaTarea tarea={tarea} catalogo={catalogo} accion={accion} />
      <div className="ordenar__texto">
        <button type="button" className="lista__texto ordenar__titulo" data-tarea-id={tarea.id} onClick={() => alAbrir(tarea.id)}>{tarea.titulo}</button>
        <span className="ordenar__motivo">{fila.motivo}</span>
      </div>
      <Pildora color={tono} className="tarjeta__proyecto">{proyecto?.nombre ?? 'Proyecto sin datos'}</Pildora>
      <Avatar persona={responsableDe(tarea, catalogo)} tamano={28} />
      <div className="ordenar__arreglo">
        <Boton
          ref={boton}
          variante="secundario"
          icono={icono}
          disabled={sale}
          onClick={alHacer}
          aria-expanded={seccion === 'pisan' ? undefined : abierto}
          aria-controls={abierto ? idGlobo : undefined}
        >
          {ETIQUETA[seccion]}
        </Boton>
        {globo?.(idGlobo)}
      </div>
    </li>
  );
}
