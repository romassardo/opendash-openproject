import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Catalogo, Tarea } from '../../compartido/tipos.js';
import { diaMesCorto } from '../fechas.js';
import { useDialogo } from '../horas/useDialogo.js';
import { ultimoProyecto } from '../tareas/FormularioRapido.js';
import { Boton } from '../ui/Boton.js';
import { bloquearFondo } from '../ui/inerte.js';
import { Vidrio } from '../ui/Vidrio.js';
import '../ingreso/ingreso.css';

export interface DialogoNuevaTareaProps {
  catalogo: Catalogo;
  tareas: Tarea[];
  /** Proyecto propuesto (el del «+» o el del filtro); sin él, el último usado. */
  proyectoId: number | null;
  /** Madre de la subtarea, si se abrió desde el «+» de una madre: fija el proyecto. */
  madreId: number | null;
  fechas: { inicio: string; fin: string };
  /** Hay otro cambio de la línea aplicándose: se espera a que termine. */
  ocupado: boolean;
  /** Crea la tarea; `true` si quedó creada (el diálogo se cierra desde afuera). */
  alCrear(titulo: string, proyectoId: number): Promise<boolean>;
  alCerrar(): void;
}

/** Alta de una tarea desde la línea de tiempo: el título (y el proyecto si no viene dado). Nace con una semana hábil. */
export function DialogoNuevaTarea({ catalogo, tareas, proyectoId, madreId, fechas, ocupado, alCrear, alCerrar }: DialogoNuevaTareaProps) {
  const id = useId();
  const velo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const madre = madreId === null ? null : (tareas.find((t) => t.id === madreId) ?? null);
  const proyectos = useMemo(
    () => catalogo.proyectos.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR')),
    [catalogo.proyectos],
  );
  const [titulo, setTitulo] = useState('');
  const [proyecto, setProyecto] = useState(() => {
    const propuesto = madre?.proyectoId ?? proyectoId ?? ultimoProyecto();
    return propuesto !== null && proyectos.some((p) => p.id === propuesto) ? String(propuesto) : '';
  });
  const [creando, setCreando] = useState(false);

  const cerrar = (): void => { if (!creando) alCerrar(); };
  useDialogo(caja, cerrar, campo);
  useLayoutEffect(() => (velo.current ? bloquearFondo(velo.current) : undefined), []);

  const listo = titulo.trim() !== '' && proyecto !== '' && !creando && !ocupado;
  const enviar = async (): Promise<void> => {
    if (!listo) return;
    setCreando(true);
    // Si no se pudo, el aviso flotante dice por qué y el diálogo queda abierto para reintentar.
    if (!(await alCrear(titulo.trim(), Number(proyecto)))) setCreando(false);
  };

  const idTitulo = `${id}-titulo`;
  const nombreProyecto = catalogo.proyectos.find((p) => String(p.id) === proyecto)?.nombre;
  return createPortal(
    <div ref={velo} className="velo" onPointerDown={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <Vidrio ref={caja} variante="denso" role="dialog" aria-modal="true" aria-labelledby={idTitulo} className="nueva-tarea">
        <header className="nueva-tarea__cabeza">
          <h2 id={idTitulo} className="nueva-tarea__titulo">{madre ? 'Nueva subtarea' : 'Nueva tarea'}</h2>
          <button type="button" className="avisar__cerrar" aria-label="Cerrar" disabled={creando} onClick={cerrar}><X size={18} aria-hidden="true" /></button>
        </header>
        <form className="nueva-tarea__form" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
          {madre ? (
            <p className="nueva-tarea__donde">Dentro de «{madre.titulo}»{nombreProyecto ? `, en ${nombreProyecto}` : ''}</p>
          ) : (
            <>
              <label htmlFor={`${id}-proyecto`} className="campo__etiqueta">Proyecto</label>
              <select id={`${id}-proyecto`} className="nueva-tarea__campo" value={proyecto} disabled={creando} onChange={(e) => setProyecto(e.target.value)}>
                <option value="" disabled>Elegí un proyecto</option>
                {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </>
          )}
          <label htmlFor={`${id}-nombre`} className="campo__etiqueta">Título</label>
          <input
            ref={campo}
            id={`${id}-nombre`}
            className="nueva-tarea__campo"
            value={titulo}
            maxLength={255}
            autoComplete="off"
            readOnly={creando}
            onChange={(e) => setTitulo(e.target.value)}
          />
          <p className="nueva-tarea__ayuda">
            {fechas.inicio === fechas.fin
              ? `Vence el ${diaMesCorto(fechas.fin)}`
              : `Va del ${diaMesCorto(fechas.inicio)} al ${diaMesCorto(fechas.fin)}`}, a tu nombre. Después la movés, la unís o la completás en la línea.
          </p>
          <div className="nueva-tarea__botones">
            <Boton variante="primario" type="submit" disabled={!listo}>{creando ? 'Creando…' : 'Crear'}</Boton>
            <Boton variante="fantasma" disabled={creando} onClick={cerrar}>Cancelar</Boton>
          </div>
        </form>
      </Vidrio>
    </div>,
    document.body,
  );
}
