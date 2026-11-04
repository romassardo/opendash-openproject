import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { File, FileImage, FileText, Paperclip, Trash2 } from 'lucide-react';
import { textoArchivoGrande, textoMaximo, textoMb } from '../../compartido/adjuntos.js';
import type { Adjunto, Catalogo } from '../../compartido/tipos.js';
import { ErrorApi, subirArchivo } from '../api/cliente.js';
import { CLAVES, useAdjuntos } from '../api/consultas.js';
import { useBorrarAdjunto } from '../api/mutaciones.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { CajaConfirmacion } from '../ui/CajaConfirmacion.js';
import { useConfirmacion } from '../ui/confirmacion.js';
import { tiempoRelativo } from '../ui/tiempo.js';
import { Seccion } from './SeccionesDetalle.js';

interface Subida { clave: number; nombre: string; fraccion: number; error: string | null }

function Icono({ tipo }: { tipo: string }) {
  if (tipo.startsWith('image/')) return <FileImage size={18} aria-hidden="true" />;
  if (tipo === 'application/pdf' || tipo.startsWith('text/')) return <FileText size={18} aria-hidden="true" />;
  return <File size={18} aria-hidden="true" />;
}

function FilaAdjunto({ adjunto, catalogo, tareaId }: { adjunto: Adjunto; catalogo: Catalogo; tareaId: number }) {
  const borrar = useBorrarAdjunto(tareaId);
  const { confirmando, boton, abrir, cerrar } = useConfirmacion();
  const autor = catalogo.personas.find((p) => p.id === adjunto.autorId)?.nombre ?? 'Alguien';
  const error = borrar.error instanceof ErrorApi ? borrar.error.mensaje : borrar.error ? 'No se pudo borrar el adjunto.' : null;
  return (
    <li className="adjunto">
      <span className="adjunto__icono"><Icono tipo={adjunto.tipo} /></span>
      <div className="adjunto__datos">
        <a className="adjunto__nombre" href={`/api/adjuntos/${adjunto.id}/contenido`} target="_blank" rel="noopener noreferrer">
          {adjunto.nombre}
        </a>
        <span className="adjunto__sub">
          {textoMb(adjunto.bytes)} · {autor} · {tiempoRelativo(adjunto.creado)}
        </span>
        {error && <Aviso tipo="error">{error}</Aviso>}
      </div>
      {adjunto.puedeBorrar && !confirmando && (
        <button ref={boton} type="button" className="detalle__quitar" aria-label={`Borrar ${adjunto.nombre}`} onClick={abrir}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      )}
      {confirmando && (
        <CajaConfirmacion className="adjunto__confirmar" etiqueta={`Confirmar el borrado de ${adjunto.nombre}`} alCancelar={cerrar} bloqueada={borrar.isPending}>
          <span>¿Borrar “{adjunto.nombre}”? No se puede deshacer</span>
          <Boton
            variante="secundario"
            disabled={borrar.isPending}
            onClick={() => borrar.mutate(adjunto.id, { onSettled: cerrar })}
          >
            Borrar
          </Boton>
          <Boton variante="fantasma" data-accion="cancelar" disabled={borrar.isPending} onClick={cerrar}>Cancelar</Boton>
        </CajaConfirmacion>
      )}
    </li>
  );
}

/** Adjuntos de la tarea: lista, subida con progreso por archivo (botón o arrastre) y borrado con confirmación. */
export function SeccionAdjuntos({ tareaId, catalogo }: { tareaId: number; catalogo: Catalogo }) {
  const consulta = useAdjuntos(tareaId);
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const contador = useRef(0);
  const corte = useRef(new AbortController());
  const [subidas, setSubidas] = useState<Subida[]>([]);
  const [encima, setEncima] = useState(false);

  const cambiar = (clave: number, cambios: Partial<Subida>) =>
    setSubidas((previas) => previas.map((s) => (s.clave === clave ? { ...s, ...cambios } : s)));

  const subir = async (archivos: File[]) => {
    const maximo = consulta.data?.maximoBytes;
    // Sin conocer el máximo no se sube: el control de tamaño se saltearía y el servidor rechazaría el archivo recién al final.
    if (maximo === undefined || maximo <= 0) return;
    for (const archivo of archivos) {
      const clave = ++contador.current;
      if (archivo.size > maximo) {
        setSubidas((previas) => [...previas, { clave, nombre: archivo.name, fraccion: 0, error: textoArchivoGrande(archivo.name, archivo.size, maximo) }]);
        continue;
      }
      setSubidas((previas) => [...previas, { clave, nombre: archivo.name, fraccion: 0, error: null }]);
      void subirArchivo(`/api/tareas/${tareaId}/adjuntos?nombre=${encodeURIComponent(archivo.name)}`, archivo, (fraccion) => cambiar(clave, { fraccion }), corte.current.signal)
        .then(() => {
          setSubidas((previas) => previas.filter((s) => s.clave !== clave));
          return cliente.invalidateQueries({ queryKey: CLAVES.adjuntos(tareaId) });
        })
        .catch((e: unknown) => corte.current.signal.aborted || cambiar(clave, { error: e instanceof ErrorApi ? e.mensaje : 'No se pudo subir el archivo.' }));
    }
  };

  const alElegir = (evento: ChangeEvent<HTMLInputElement>) => {
    void subir([...(evento.target.files ?? [])]);
    evento.target.value = '';
  };
  const alSoltar = (evento: DragEvent<HTMLElement>) => {
    evento.preventDefault();
    setEncima(false);
    if (consulta.data?.puedeAdjuntar) void subir([...evento.dataTransfer.files]);
  };

  // Al cerrar el detalle se cortan las subidas en curso: ninguna fila queda «Subiendo» sin dueño.
  useEffect(() => {
    const actual = new AbortController();
    corte.current = actual;
    return () => actual.abort();
  }, []);

  // Un archivo soltado fuera de la zona (o sin permiso) lo abriría el navegador y sacaría a la persona de OpenDash.
  useEffect(() => {
    const frenar = (evento: globalThis.DragEvent): void => {
      if (Array.from(evento.dataTransfer?.types ?? []).includes('Files')) evento.preventDefault();
    };
    window.addEventListener('dragover', frenar);
    window.addEventListener('drop', frenar);
    return () => {
      window.removeEventListener('dragover', frenar);
      window.removeEventListener('drop', frenar);
    };
  }, []);

  const datos = consulta.data;
  const puede = datos?.puedeAdjuntar === true;
  const extra = puede ? (
    <>
      <input ref={entrada} type="file" multiple hidden aria-label="Elegir archivos" onChange={alElegir} />
      <Boton variante="secundario" icono={<Paperclip size={16} />} onClick={() => entrada.current?.click()}>Adjuntar</Boton>
    </>
  ) : undefined;

  return (
    <Seccion titulo="Adjuntos" extra={extra}>
      <div
        className={encima ? 'adjuntos adjuntos--encima' : 'adjuntos'}
        data-testid="zona-adjuntos"
        onDragOver={(e) => { if (puede) { e.preventDefault(); setEncima(true); } }}
        onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setEncima(false); }}
        onDrop={alSoltar}
      >
        {consulta.error && <Aviso tipo="error">{consulta.error instanceof ErrorApi ? consulta.error.mensaje : 'No se pudieron cargar los adjuntos.'}</Aviso>}
        {datos && datos.adjuntos.length === 0 && subidas.length === 0 && <p className="detalle__vacio">Sin adjuntos</p>}
        {datos && datos.adjuntos.length > 0 && (
          <ul className="detalle-filas" aria-label="Adjuntos">
            {datos.adjuntos.map((a) => <FilaAdjunto key={a.id} adjunto={a} catalogo={catalogo} tareaId={tareaId} />)}
          </ul>
        )}
        {subidas.length > 0 && (
          <ul className="detalle-filas" aria-label="Subiendo">
            {subidas.map((s) => (
              <li key={s.clave} className="adjunto">
                <div className="adjunto__datos">
                  <span className="adjunto__nombre">{s.nombre}</span>
                  {s.error === null ? (
                    <progress className="adjunto__progreso" max={1} value={s.fraccion} aria-label={`Subiendo ${s.nombre}`} />
                  ) : (
                    <Aviso tipo="error">{s.error}</Aviso>
                  )}
                </div>
                {s.error !== null && (
                  <Boton variante="fantasma" onClick={() => setSubidas((previas) => previas.filter((x) => x.clave !== s.clave))}>Descartar</Boton>
                )}
              </li>
            ))}
          </ul>
        )}
        {puede && datos && (
          <p className="adjuntos__pista">Arrastrá archivos acá para adjuntarlos · {textoMaximo(datos.maximoBytes)}</p>
        )}
      </div>
    </Seccion>
  );
}
