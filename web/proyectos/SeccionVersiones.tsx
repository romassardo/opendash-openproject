import { useId, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { EstadoVersion } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useVersiones, type VersionDeGestion } from '../api/consultas.js';
import { useBorrarVersion, useCambiarVersion, useCrearVersion, type CambiosVersion, type DatosVersion } from '../api/mutaciones.js';
import { diaMesCorto } from '../fechas.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { CajaConfirmacion } from '../ui/CajaConfirmacion.js';
import { useConfirmacion } from '../ui/confirmacion.js';
import { useValorDiferido } from '../ui/valorDiferido.js';
import { plural } from '../ui/plural.js';

const ETIQUETA_ESTADO: Record<EstadoVersion, string> = { abierta: 'Abierta', bloqueada: 'Bloqueada', cerrada: 'Cerrada' };
const ESTADOS: EstadoVersion[] = ['abierta', 'bloqueada', 'cerrada'];

const textoDeError = (error: unknown, porDefecto: string): string => (error instanceof ErrorApi ? error.mensaje : porDefecto);

function fechas(v: VersionDeGestion): string | null {
  if (v.inicio !== null && v.fin !== null) return `${diaMesCorto(v.inicio)} a ${diaMesCorto(v.fin)}`;
  if (v.fin !== null) return `hasta el ${diaMesCorto(v.fin)}`;
  if (v.inicio !== null) return `desde el ${diaMesCorto(v.inicio)}`;
  return null;
}

/** Solo se manda lo que cambió: guardar el nombre no pisa fechas que otra persona acaba de poner. */
function soloLoCambiado(v: VersionDeGestion, d: DatosVersion): CambiosVersion {
  return {
    ...(d.nombre !== v.nombre ? { nombre: d.nombre } : {}),
    ...(d.inicio !== v.inicio ? { inicio: d.inicio } : {}),
    ...(d.fin !== v.fin ? { fin: d.fin } : {}),
  };
}

interface FormularioProps {
  inicial: DatosVersion;
  etiquetaEnviar: string;
  pendiente: boolean;
  alEnviar(datos: DatosVersion): void;
  alCancelar(): void;
}

function FormularioVersion({ inicial, etiquetaEnviar, pendiente, alEnviar, alCancelar }: FormularioProps) {
  const [nombre, setNombre] = useState(inicial.nombre);
  const [inicio, setInicio] = useState(inicial.inicio ?? '');
  const [fin, setFin] = useState(inicial.fin ?? '');
  const idInicio = useId();
  const idFin = useId();
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (nombre.trim() === '') return;
    alEnviar({ nombre: nombre.trim(), inicio: inicio === '' ? null : inicio, fin: fin === '' ? null : fin });
  };
  return (
    <form className="versiones__formulario" onSubmit={enviar}>
      <input
        className="versiones__campo" aria-label="Nombre de la versión" value={nombre} maxLength={60} autoFocus
        onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') alCancelar(); }}
      />
      <label htmlFor={idInicio} className="versiones__rotulo">Inicio</label>
      <input id={idInicio} type="date" className="versiones__campo" value={inicio} onChange={(e) => setInicio(e.target.value)} />
      <label htmlFor={idFin} className="versiones__rotulo">Fin</label>
      <input id={idFin} type="date" className="versiones__campo" value={fin} onChange={(e) => setFin(e.target.value)} />
      <Boton variante="primario" type="submit" disabled={pendiente || nombre.trim() === ''}>{etiquetaEnviar}</Boton>
      <Boton variante="fantasma" disabled={pendiente} onClick={alCancelar}>Cancelar</Boton>
    </form>
  );
}

function FilaVersion({ version, proyectoId }: { version: VersionDeGestion; proyectoId: number }) {
  const cambiar = useCambiarVersion(proyectoId);
  const borrar = useBorrarVersion(proyectoId);
  const [renombrando, setRenombrando] = useState(false);
  const { confirmando, boton, abrir, cerrar } = useConfirmacion();
  const [estadoElegido, elegirEstado, soltarEstado] = useValorDiferido(
    version.estado,
    (valor) => cambiar.mutate({ id: version.id, cambios: { estado: valor as EstadoVersion } }, { onSettled: soltarEstado }),
  );
  const idAyuda = useId();
  const error = cambiar.error ?? borrar.error;
  const rango = fechas(version);
  const conTareas = version.tareas > 0;
  return (
    <li className="version">
      <div className="version__datos">
        {renombrando ? (
          <FormularioVersion
            inicial={{ nombre: version.nombre, inicio: version.inicio, fin: version.fin }}
            etiquetaEnviar="Guardar"
            pendiente={cambiar.isPending}
            alCancelar={() => setRenombrando(false)}
            alEnviar={(datos) => {
              const cambios = soloLoCambiado(version, datos);
              if (Object.keys(cambios).length === 0) return setRenombrando(false);
              cambiar.mutate({ id: version.id, cambios }, { onSuccess: () => setRenombrando(false) });
            }}
          />
        ) : (
          <>
            <span className="version__nombre">{version.nombre}</span>
            <span className="version__sub">
              {rango !== null && <>{rango} · </>}
              <span>{plural(version.tareas, 'tarea', 'tareas')}</span>
            </span>
          </>
        )}
        {version.puedeBorrar && conTareas && (
          <span id={idAyuda} className="version__ayuda">Tiene {plural(version.tareas, 'tarea', 'tareas')}: pasalas a otra versión antes de borrarla</span>
        )}
        {error && <Aviso tipo="error">{textoDeError(error, 'No se pudo guardar el cambio.')}</Aviso>}
      </div>
      {version.puedeCambiar ? (
        <select
          className="version__estado" aria-label={`Estado de ${version.nombre}`} value={estadoElegido}
          aria-busy={cambiar.isPending}
          onChange={(e) => elegirEstado(e.target.value)}
        >
          {ESTADOS.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
        </select>
      ) : (
        <span className="version__estado version__estado--fijo">{ETIQUETA_ESTADO[version.estado]}</span>
      )}
      {version.puedeCambiar && !renombrando && (
        <button type="button" className="detalle__quitar" aria-label={`Renombrar ${version.nombre}`} onClick={() => setRenombrando(true)}>
          <Pencil size={16} aria-hidden="true" />
        </button>
      )}
      {version.puedeBorrar && !confirmando && (
        // Con tareas el botón queda enfocable pero no borra (aria-disabled), y el motivo se ve debajo de la fila.
        <button
          ref={boton} type="button" className="detalle__quitar" aria-label={`Borrar ${version.nombre}`}
          aria-disabled={conTareas || undefined} aria-describedby={conTareas ? idAyuda : undefined}
          onClick={() => { if (!conTareas) abrir(); }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      )}
      {confirmando && (
        <CajaConfirmacion className="version__confirmar" etiqueta={`Confirmar el borrado de ${version.nombre}`} alCancelar={cerrar} bloqueada={borrar.isPending}>
          <span>¿Borrar la versión “{version.nombre}”? No se puede deshacer</span>
          <Boton variante="secundario" disabled={borrar.isPending} onClick={() => borrar.mutate(version.id, { onSettled: cerrar })}>Borrar</Boton>
          <Boton variante="fantasma" data-accion="cancelar" disabled={borrar.isPending} onClick={cerrar}>Cancelar</Boton>
        </CajaConfirmacion>
      )}
    </li>
  );
}

/** Versiones de un proyecto: lista con estado y tareas, y, según el permiso de cada una, crear, renombrar, cerrar y borrar. */
export function SeccionVersiones({ proyectoId }: { proyectoId: number }) {
  const consulta = useVersiones(proyectoId);
  const crear = useCrearVersion(proyectoId);
  const [creando, setCreando] = useState(false);
  const titulo = useId();
  const datos = consulta.data;
  return (
    <section className="versiones" aria-labelledby={titulo}>
      <header className="versiones__cabeza">
        <h2 id={titulo} className="versiones__titulo">Versiones</h2>
        {datos?.puedeCrear && !creando && (
          <Boton variante="secundario" icono={<Plus size={16} />} onClick={() => setCreando(true)}>Nueva versión</Boton>
        )}
      </header>
      {consulta.error && <Aviso tipo="error">{textoDeError(consulta.error, 'No se pudieron cargar las versiones.')}</Aviso>}
      {creando && (
        <>
          <FormularioVersion
            inicial={{ nombre: '', inicio: null, fin: null }}
            etiquetaEnviar="Crear"
            pendiente={crear.isPending}
            alCancelar={() => { crear.reset(); setCreando(false); }}
            alEnviar={(d) => crear.mutate(d, { onSuccess: () => setCreando(false) })}
          />
          {crear.error && <Aviso tipo="error">{textoDeError(crear.error, 'No se pudo crear la versión.')}</Aviso>}
        </>
      )}
      {datos && datos.versiones.length === 0 && <p className="detalle__vacio">Este proyecto no tiene versiones</p>}
      {datos && datos.versiones.length > 0 && (
        <ul className="versiones__lista" aria-label="Versiones del proyecto">
          {datos.versiones.map((v) => <FilaVersion key={v.id} version={v} proyectoId={proyectoId} />)}
        </ul>
      )}
    </section>
  );
}
