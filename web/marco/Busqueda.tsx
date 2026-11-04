import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { CircleCheck, FolderKanban, Search } from 'lucide-react';
import { useCatalogo, useTareas, useYo } from '../api/consultas.js';
import { Avatar } from '../ui/Avatar.js';
import { unir } from '../ui/clases.js';
import { bloquearFondo } from '../ui/inerte.js';
import { Vidrio } from '../ui/Vidrio.js';
import { MSG_TRAYENDO } from '../tareas/logica.js';
import { buscar, rutaDePersona, rutaDeProyecto, rutaDeTarea } from './busquedaLogica.js';

interface Opcion {
  clave: string;
  ruta: string;
  titulo: string;
  detalle: string;
  icono: ReactNode;
}

interface Grupo {
  nombre: string;
  opciones: Opcion[];
}

export interface BusquedaProps {
  onCerrar: () => void;
  /** Adonde vuelve el foco al cerrar. */
  retorno: RefObject<HTMLElement | null>;
}

/** Paleta de búsqueda (Ctrl+K): tareas, proyectos y personas. */
export function Busqueda({ onCerrar, retorno }: BusquedaProps) {
  const navegar = useNavigate();
  const tareas = useTareas();
  const catalogo = useCatalogo();
  const yo = useYo();
  const [consulta, setConsulta] = useState('');
  const [activo, setActivo] = useState(0);
  const velo = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const idLista = useId();

  // Modal de verdad: el resto de la página queda inerte y, al cerrar, el foco vuelve a la barra.
  useLayoutEffect(() => {
    const caja = velo.current;
    if (!caja) return;
    const liberar = bloquearFondo(caja);
    campo.current?.focus();
    return () => {
      liberar();
      retorno.current?.focus();
    };
  }, [retorno]);

  // Esc cierra aunque el foco se haya ido del campo.
  useEffect(() => {
    const alTeclear = (evento: globalThis.KeyboardEvent) => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      onCerrar();
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  const grupos = useMemo<Grupo[]>(() => {
    if (!tareas.data || !catalogo.data) return [];
    const { tareas: lasTareas, proyectos, personas } = buscar(consulta, tareas.data.tareas, catalogo.data);
    const nombreProyecto = new Map(catalogo.data.proyectos.map((p) => [p.id, p.nombre]));
    const todos: Grupo[] = [
      {
        nombre: 'Tareas',
        opciones: lasTareas.map((t) => ({
          clave: `tarea-${t.id}`,
          ruta: rutaDeTarea(t.id),
          titulo: t.titulo,
          detalle: nombreProyecto.get(t.proyectoId) ?? '',
          icono: <CircleCheck size={18} aria-hidden="true" />,
        })),
      },
      {
        nombre: 'Proyectos',
        opciones: proyectos.map((p) => ({
          clave: `proyecto-${p.id}`,
          ruta: rutaDeProyecto(p.id),
          titulo: p.nombre,
          detalle: p.identificador,
          icono: <FolderKanban size={18} aria-hidden="true" />,
        })),
      },
      {
        nombre: 'Personas',
        opciones: personas.map((p) => ({
          clave: `persona-${p.id}`,
          ruta: rutaDePersona(p.id),
          titulo: p.nombre,
          detalle: p.login ?? '',
          icono: <Avatar persona={p} tamano={24} />,
        })),
      },
    ];
    return todos.filter((g) => g.opciones.length > 0);
  }, [consulta, tareas.data, catalogo.data]);

  const planas = grupos.flatMap((g) => g.opciones);
  const indice = Math.min(activo, Math.max(planas.length - 1, 0));
  const idOpcion = (clave: string) => `${idLista}-${clave}`;
  const opcionActiva = planas[indice];

  const abrir = (opcion: Opcion) => {
    onCerrar();
    void navegar(opcion.ruta);
  };

  const alTeclear = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (planas.length === 0) return;
      const paso = evento.key === 'ArrowDown' ? 1 : -1;
      const siguiente = (indice + paso + planas.length) % planas.length;
      setActivo(siguiente);
      const clave = planas[siguiente]?.clave;
      if (clave) document.getElementById(idOpcion(clave))?.scrollIntoView?.({ block: 'nearest' });
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      if (opcionActiva) abrir(opcionActiva);
    } else if (evento.key === 'Tab') {
      // El foco se queda en el campo: la lista se maneja con las flechas.
      evento.preventDefault();
    }
  };

  const cargando = (tareas.isPending || catalogo.isPending) && !(tareas.isError || catalogo.isError);
  const fallo = tareas.isError || catalogo.isError;
  // Mientras el servidor trae las tareas por primera vez, la lista vacía no significa que no haya tareas.
  const trayendo = yo.data?.cargaInicialLista === false;
  const hayConsulta = consulta.trim() !== '';

  return createPortal(
    <div
      ref={velo}
      className="velo velo--busqueda"
      onKeyDown={alTeclear}
      // El foco no sale del campo al tocar relleno, títulos o texto vacío.
      onMouseDown={(evento) => {
        if (evento.target !== campo.current) evento.preventDefault();
      }}
      onPointerDown={(evento) => {
        if (evento.target === evento.currentTarget) onCerrar();
      }}
    >
      <Vidrio variante="denso" role="dialog" aria-modal="true" aria-label="Buscar" className="busqueda">
        <div className="busqueda__campo">
          <Search size={20} aria-hidden="true" />
          <input
            ref={campo}
            type="text"
            role="combobox"
            aria-label="Buscar tareas, proyectos y personas"
            aria-expanded={planas.length > 0}
            aria-controls={idLista}
            aria-activedescendant={opcionActiva ? idOpcion(opcionActiva.clave) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="Buscar tareas, proyectos y personas"
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              setActivo(0);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div id={idLista} role="listbox" aria-label="Resultados" className="busqueda__lista">
          {grupos.map((grupo) => (
            <div key={grupo.nombre} role="group" aria-labelledby={`${idLista}-${grupo.nombre}`} className="busqueda__grupo">
              <div id={`${idLista}-${grupo.nombre}`} className="busqueda__titulo">
                {!hayConsulta && grupo.nombre === 'Tareas' ? 'Tareas recientes' : grupo.nombre}
              </div>
              {grupo.opciones.map((opcion) => {
                const seleccionada = opcion.clave === opcionActiva?.clave;
                return (
                  <div
                    key={opcion.clave}
                    id={idOpcion(opcion.clave)}
                    role="option"
                    aria-selected={seleccionada}
                    className={unir('busqueda__opcion', seleccionada && 'busqueda__opcion--activa')}
                    onPointerMove={() => setActivo(planas.indexOf(opcion))}
                    onClick={() => abrir(opcion)}
                  >
                    <span className="busqueda__icono">{opcion.icono}</span>
                    <span className="busqueda__texto">{opcion.titulo}</span>
                    {opcion.detalle !== '' && <small className="busqueda__detalle">{opcion.detalle}</small>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {planas.length === 0 && (
          <p className="busqueda__vacio" role="status">
            {fallo ? 'No se pudo cargar la búsqueda.' : cargando || trayendo ? MSG_TRAYENDO : hayConsulta ? 'No encontramos nada con eso.' : 'Todavía no hay tareas.'}
          </p>
        )}
      </Vidrio>
    </div>,
    document.body,
  );
}
