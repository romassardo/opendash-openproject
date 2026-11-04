import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader, X } from 'lucide-react';
import { ErrorApi } from '../api/cliente.js';
import { useTrabajoNuevoProyecto, type OpcionesNuevoProyecto } from '../api/consultas.js';
import { recargarTrasProyectoNuevo, useArrancarProyectoNuevo } from '../api/mutaciones.js';
import { useDialogo } from '../horas/useDialogo.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { bloquearFondo } from '../ui/inerte.js';
import { Vidrio } from '../ui/Vidrio.js';

const VACIO = 'vacio';

interface Props { opciones: OpcionesNuevoProyecto; alCerrar(): void }

/** Hay de dónde empezar un proyecto: vacío o desde alguna plantilla. */
export function puedeCrearProyecto(opciones: OpcionesNuevoProyecto): boolean {
  return opciones.vacio || opciones.plantillas.length > 0;
}

/** «Nuevo proyecto»: nombre y de dónde empezar; después muestra los pasos hasta abrir el proyecto. */
export function DialogoNuevoProyecto({ opciones, alCerrar }: Props) {
  const id = useId();
  const velo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLElement>(null);
  const campoNombre = useRef<HTMLInputElement>(null);
  const zonaPasos = useRef<HTMLDivElement>(null);
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const arrancar = useArrancarProyectoNuevo();
  const [nombre, setNombre] = useState('');
  const [origen, setOrigen] = useState(opciones.vacio ? VACIO : String(opciones.plantillas[0]?.id ?? ''));
  const [trabajo, setTrabajo] = useState<string | null>(null);
  const [copiaPlantilla, setCopiaPlantilla] = useState(false);
  const consulta = useTrabajoNuevoProyecto(trabajo);
  const estado = consulta.data;
  const paso = estado?.paso ?? (trabajo === null ? null : 'creando');
  const enCurso = trabajo !== null && paso !== 'listo' && paso !== 'fallo' && !consulta.isError;

  const cerrar = (): void => { if (!enCurso && !arrancar.isPending) alCerrar(); };
  useDialogo(caja, cerrar, campoNombre);
  // Al pasar a los pasos el formulario se desmonta: el foco se queda en el contenedor de los pasos, que se anuncia solo.
  const siguiendo = trabajo !== null;
  useEffect(() => {
    if (siguiendo) zonaPasos.current?.focus();
  }, [siguiendo]);
  useLayoutEffect(() => (velo.current ? bloquearFondo(velo.current) : undefined), []);

  const abrir = (proyectoId: number): void => {
    recargarTrasProyectoNuevo(cliente);
    alCerrar();
    navegar(`/proyectos/${proyectoId}`);
  };
  const sinAvisos = estado?.paso === 'listo' && estado.noCopiado.length === 0;
  const proyectoListo = estado?.proyectoId ?? null;
  useEffect(() => {
    if (sinAvisos && proyectoListo !== null) abrir(proyectoListo);
    // Solo al llegar a «listo»: `abrir` y `alCerrar` cambian en cada render y repetirían la navegación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinAvisos, proyectoListo]);

  const enviar = (): void => {
    arrancar.mutate(
      { nombre: nombre.trim(), plantillaId: origen === VACIO ? null : Number(origen) },
      { onSuccess: (r) => { setCopiaPlantilla(origen !== VACIO); setTrabajo(r.trabajo); } },
    );
  };
  const errorEnvio = arrancar.error instanceof ErrorApi ? arrancar.error.mensaje : arrancar.error ? 'No se pudo crear el proyecto.' : null;
  const errorConsulta = consulta.error instanceof ErrorApi ? consulta.error.mensaje : consulta.error ? 'Se perdió el seguimiento del trabajo.' : null;
  const sinTrabajo = consulta.error instanceof ErrorApi && consulta.error.estado === 404;
  const listo = nombre.trim() !== '' && origen !== '';
  const idTitulo = `${id}-titulo`;

  const pasos: { texto: string; hecho: boolean; activo: boolean }[] = [
    { texto: 'Creando el proyecto…', hecho: paso === 'copiando' || paso === 'listo' || (paso === 'fallo' && estado?.proyectoId != null), activo: paso === 'creando' },
    ...(copiaPlantilla ? [{ texto: 'Copiando la plantilla…', hecho: paso === 'listo', activo: paso === 'copiando' }] : []),
  ];

  return createPortal(
    <div ref={velo} className="velo" onPointerDown={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <Vidrio ref={caja} variante="denso" role="dialog" aria-modal="true" aria-labelledby={idTitulo} className="nuevo-proyecto">
        <header className="nuevo-proyecto__cabeza">
          <h2 id={idTitulo} className="nuevo-proyecto__titulo">Nuevo proyecto</h2>
          <button type="button" className="avisar__cerrar" aria-label="Cerrar" disabled={enCurso} onClick={cerrar}><X size={18} aria-hidden="true" /></button>
        </header>

        {trabajo === null ? (
          <form className="nuevo-proyecto__form" onSubmit={(e) => { e.preventDefault(); if (listo && !arrancar.isPending) enviar(); }}>
            <label htmlFor={`${id}-nombre`} className="campo__etiqueta">Nombre</label>
            <input ref={campoNombre} id={`${id}-nombre`} className="versiones__campo" value={nombre} maxLength={255} onChange={(e) => setNombre(e.target.value)} />
            <label htmlFor={`${id}-origen`} className="campo__etiqueta">Empezar de</label>
            <select id={`${id}-origen`} className="versiones__campo" value={origen} onChange={(e) => setOrigen(e.target.value)}>
              {opciones.vacio && <option value={VACIO}>Proyecto vacío</option>}
              {opciones.plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            {errorEnvio && <Aviso tipo="error">{errorEnvio}</Aviso>}
            <div className="nuevo-proyecto__botones">
              <Boton variante="primario" type="submit" disabled={!listo || arrancar.isPending}>Crear</Boton>
              <Boton variante="fantasma" disabled={arrancar.isPending} onClick={cerrar}>Cancelar</Boton>
            </div>
          </form>
        ) : (
          <div ref={zonaPasos} tabIndex={-1} className="nuevo-proyecto__pasos">
            <div role="status">
            <ul className="nuevo-proyecto__lista" aria-label="Pasos">
              {pasos.map((p) => (
                <li key={p.texto} className={p.hecho ? 'nuevo-proyecto__paso nuevo-proyecto__paso--hecho' : 'nuevo-proyecto__paso'}>
                  {p.hecho ? <Check size={16} aria-hidden="true" /> : p.activo ? <Loader size={16} aria-hidden="true" className="nuevo-proyecto__giro" /> : <span className="nuevo-proyecto__punto" aria-hidden="true" />}
                  <span>{p.texto}</span>
                </li>
              ))}
            </ul>
            </div>
            {errorConsulta && (
              <>
                <Aviso tipo="error">{`${errorConsulta} Fijate en Proyectos si quedó creado.`}</Aviso>
                <div className="nuevo-proyecto__botones">
                  {!sinTrabajo && <Boton variante="secundario" onClick={() => void consulta.refetch()}>Seguir esperando</Boton>}
                  <Boton variante="fantasma" onClick={alCerrar}>Cerrar</Boton>
                </div>
              </>
            )}
            {estado?.paso === 'listo' && estado.noCopiado.length > 0 && (
              <>
                <Aviso tipo="info">
                  <span>No se copió:</span>
                  <ul>{estado.noCopiado.map((n) => <li key={n}>{n}</li>)}</ul>
                </Aviso>
                {proyectoListo !== null && <Boton variante="primario" onClick={() => abrir(proyectoListo)}>Abrir el proyecto</Boton>}
              </>
            )}
            {estado?.paso === 'fallo' && (
              <>
                <Aviso tipo="error">{estado.mensaje ?? 'Algo salió mal'}</Aviso>
                <div className="nuevo-proyecto__botones">
                  {estado.proyectoId !== null && <Boton variante="secundario" onClick={() => abrir(estado.proyectoId!)}>Abrir el proyecto</Boton>}
                  <Boton variante="fantasma" onClick={alCerrar}>Cerrar</Boton>
                </div>
              </>
            )}
          </div>
        )}
      </Vidrio>
    </div>,
    document.body,
  );
}
