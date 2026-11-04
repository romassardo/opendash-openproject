import { useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { estadoDeColumna, mensajeFaltaEstado, NOMBRE_COLUMNA } from '../../compartido/columnas.js';
import type { Catalogo, Columna, NuevaTarea, Tarea } from '../../compartido/tipos.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { mensajeDeError, useCrearTarea } from './acciones.js';

const CLAVE_ULTIMO_PROYECTO = 'od:ultimo-proyecto';
const MSG_CARGANDO = 'Todavía se están cargando los datos de OpenProject; probá en un momento.';
const MSG_CARGANDO_PROYECTOS = 'Todavía se están cargando tus proyectos de OpenProject.';

/** El proyecto de la última tarea creada en este navegador (lo comparte el alta de la línea de tiempo). */
export function ultimoProyecto(): number | null {
  try {
    const valor = Number(localStorage.getItem(CLAVE_ULTIMO_PROYECTO));
    return Number.isInteger(valor) && valor > 0 ? valor : null;
  } catch {
    return null;
  }
}

export function recordarProyecto(id: number): void {
  try {
    localStorage.setItem(CLAVE_ULTIMO_PROYECTO, String(id));
  } catch {
    // Sin almacenamiento: la próxima vez no se propone ninguno.
  }
}

export interface FormularioRapidoProps {
  columna: Columna;
  catalogo: Catalogo;
  /** Proyecto del filtro activo, si hay. */
  proyectoId: number | null;
  /** Responsable que se asigna (con «Solo mías» o una persona filtrada). */
  responsableId: number | null;
  /** `true` mientras el servidor trae por primera vez los proyectos de OpenProject. */
  cargandoProyectos?: boolean;
  alCrear(tarea: Tarea): void;
  alCerrar(): void;
}

/** Alta rápida: título y proyecto; Enter crea la tarea en el estado de la columna, Escape cierra. */
export function FormularioRapido(props: FormularioRapidoProps) {
  const { columna, catalogo, proyectoId, responsableId, cargandoProyectos = false, alCrear, alCerrar } = props;
  const crear = useCrearTarea();
  const campo = useRef<HTMLInputElement>(null);
  const proyectos = useMemo(
    () => catalogo.proyectos.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR')),
    [catalogo.proyectos],
  );
  const [titulo, setTitulo] = useState('');
  const [proyecto, setProyecto] = useState(() => {
    const propuesto = proyectoId ?? ultimoProyecto();
    return propuesto !== null && proyectos.some((p) => p.id === propuesto) ? String(propuesto) : '';
  });
  const [problema, setProblema] = useState<string | null>(null);

  useLayoutEffect(() => {
    campo.current?.focus();
  }, []);

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (crear.isPending) return;
    const limpio = titulo.trim();
    if (limpio === '') return setProblema('Escribí un título.');
    if (catalogo.estados.length === 0) return setProblema(MSG_CARGANDO);
    if (proyecto === '') return setProblema(cargandoProyectos && proyectos.length === 0 ? MSG_CARGANDO_PROYECTOS : 'Elegí un proyecto.');
    const estado = estadoDeColumna(columna, catalogo.estados, catalogo.tablero);
    if (estado === null) return setProblema(mensajeFaltaEstado(columna));
    const estadoId = estado.id;
    const nueva: NuevaTarea = {
      titulo: limpio,
      proyectoId: Number(proyecto),
      estadoId,
      ...(responsableId !== null && { responsableId }),
    };
    setProblema(null);
    crear.mutate(nueva, {
      onSuccess: (tarea) => {
        recordarProyecto(tarea.proyectoId);
        alCrear(tarea);
      },
      onError: (error) => setProblema(mensajeDeError(error)),
    });
  };

  const alTeclear = (evento: KeyboardEvent<HTMLFormElement>) => {
    if (evento.key !== 'Escape') return;
    evento.stopPropagation();
    alCerrar();
  };

  return (
    <form className="formulario-rapido" aria-label="Nueva tarea" noValidate onSubmit={enviar} onKeyDown={alTeclear}>
      <input
        ref={campo}
        className="formulario-rapido__titulo"
        aria-label="Título"
        placeholder={`Nueva tarea en ${NOMBRE_COLUMNA[columna]}`}
        maxLength={255}
        autoComplete="off"
        value={titulo}
        readOnly={crear.isPending}
        onChange={(e) => setTitulo(e.target.value)}
      />
      <div className="formulario-rapido__proyecto">
        <select aria-label="Proyecto" value={proyecto} onChange={(e) => setProyecto(e.target.value)}>
          <option value="" disabled>Elegí un proyecto</option>
          {proyectos.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
      {cargandoProyectos && problema === null && <Aviso tipo="info">{MSG_CARGANDO_PROYECTOS}</Aviso>}
      {problema && <Aviso tipo="error">{problema}</Aviso>}
      <div className="formulario-rapido__acciones">
        <Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="primario" type="submit" disabled={crear.isPending}>
          {crear.isPending ? 'Creando…' : 'Crear'}
        </Boton>
      </div>
    </form>
  );
}
