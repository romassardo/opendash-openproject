import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, X } from 'lucide-react';
import type { AvisoProblema, ContextoAviso, EstadoAviso } from '../../compartido/tipos.js';
import { ErrorApi, pedir } from '../api/cliente.js';
import { useDialogo } from '../horas/useDialogo.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { bloquearFondo } from '../ui/inerte.js';
import { tiempoRelativo } from '../ui/tiempo.js';
import { Vidrio } from '../ui/Vidrio.js';
import { armarContexto } from './contexto.js';
import './avisos-problema.css';

const MAX_TEXTO = 4000;
const MAX_BYTES_IMAGEN = 3 * 1024 * 1024;
const TIPOS_IMAGEN = ['image/png', 'image/jpeg', 'image/webp'];
export const ETIQUETA_ESTADO: Record<EstadoAviso, string> = { nuevo: 'Nuevo', visto: 'Visto', arreglado: 'Arreglado' };

interface Adjunta { nombre: string; tipo: string; datos: string; vista: string }

export interface DialogoAvisoProps {
  onCerrar(): void;
  /** Pantalla desde donde se avisa; por defecto la de la dirección actual. */
  ruta?: string;
  /** A quién le llega: su nombre de pila, o `null` si son varios o ninguno. */
  receptor?: string | null;
  /** Mostrar «Ver todos» (solo quienes reciben los avisos). */
  alVerTodos?: () => void;
  /** Se llama cuando el aviso quedó guardado. */
  alEnviar?: () => void;
  /** El error que ya tiene quien abre el diálogo (tiene prioridad sobre el último anotado). */
  error?: string;
}

const mensajeDe = (error: unknown, otro: string): string => (error instanceof ErrorApi ? error.mensaje : otro);

function leerImagen(archivo: File): Promise<Adjunta> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onerror = () => rechazar(new Error('No se pudo leer la imagen.'));
    lector.onload = () => {
      const vista = String(lector.result);
      resolver({ nombre: archivo.name || 'imagen', tipo: archivo.type, datos: vista.slice(vista.indexOf(',') + 1), vista });
    };
    lector.readAsDataURL(archivo);
  });
}

/** Diálogo de «Avisar un problema». Solo usa `pedir`: sirve también cuando el marco está roto. */
export function DialogoAviso({ onCerrar, ruta, receptor = null, alVerTodos, alEnviar, error: errorDeApp }: DialogoAvisoProps) {
  const id = useId();
  const velo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState('');
  const [imagen, setImagen] = useState<Adjunta | null>(null);
  const [errorImagen, setErrorImagen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [propios, setPropios] = useState<AvisoProblema[] | null>(null);
  const [errorPropios, setErrorPropios] = useState(false);
  const [contexto] = useState<ContextoAviso>(() => armarContexto({ pathname: ruta ?? window.location.pathname }, new Date(), errorDeApp));

  // Mientras se envía no se cierra: el envío sigue y la persona no sabría si llegó.
  const cerrar = (): void => { if (!enviando) onCerrar(); };
  useDialogo(caja, cerrar);
  // Respuestas de «Tus avisos»: solo vale la última pedida y nunca después de desmontar.
  const pedidoPropios = useRef(0);
  useEffect(() => () => { pedidoPropios.current = -1; }, []);
  useLayoutEffect(() => {
    return velo.current ? bloquearFondo(velo.current) : undefined;
  }, []);
  // Después de `useDialogo` (que lleva el foco al primer botón): al texto se llega escribiendo.
  useEffect(() => campo.current?.focus(), []);

  const cargarPropios = (): void => {
    if (pedidoPropios.current < 0) return;
    pedidoPropios.current += 1;
    const numero = pedidoPropios.current;
    const vigente = (): boolean => pedidoPropios.current === numero;
    pedir<AvisoProblema[]>('GET', '/api/avisos-problema/mios')
      .then((lista) => { if (vigente()) { setPropios(lista); setErrorPropios(false); } })
      .catch(() => { if (vigente()) setErrorPropios(true); });
  };
  useEffect(() => {
    pedidoPropios.current = 0;
    cargarPropios();
  }, []);

  const adjuntar = async (archivo: File): Promise<void> => {
    if (!TIPOS_IMAGEN.includes(archivo.type)) return setErrorImagen('La imagen tiene que ser png, jpg o webp.');
    if (archivo.size > MAX_BYTES_IMAGEN) return setErrorImagen('La imagen pesa más de 3 MB.');
    try {
      setImagen(await leerImagen(archivo));
      setErrorImagen(null);
    } catch (fallo) {
      setErrorImagen(mensajeDe(fallo, 'No se pudo leer la imagen.'));
    }
  };

  const alPegar = (evento: ClipboardEvent): void => {
    const datos = evento.clipboardData;
    const archivos = [...(datos.files ?? [])];
    const deItems = [...(datos.items ?? [])].map((i) => (i.kind === 'file' ? i.getAsFile() : null)).filter((f): f is File => f !== null);
    const imagenPegada = [...archivos, ...deItems].find((f) => f.type.startsWith('image/'));
    if (imagenPegada === undefined) return;
    evento.preventDefault();
    void adjuntar(imagenPegada);
  };

  const enviar = async (): Promise<void> => {
    setEnviando(true);
    setError(null);
    try {
      await pedir<{ id: number }>('POST', '/api/avisos-problema', {
        texto: texto.trim(),
        contexto,
        ...(imagen === null ? {} : { imagen: { tipo: imagen.tipo, datos: imagen.datos } }),
      });
      setEnviado(true);
      setTexto('');
      setImagen(null);
      cargarPropios();
      alEnviar?.();
    } catch (fallo) {
      setError(mensajeDe(fallo, 'No se pudo enviar el aviso. Probá de nuevo.'));
    } finally {
      setEnviando(false);
    }
  };

  const idTitulo = `${id}-titulo`;
  const idTexto = `${id}-texto`;
  return createPortal(
    <div
      ref={velo}
      className="velo"
      onPointerDown={(evento) => { if (evento.target === evento.currentTarget) cerrar(); }}
    >
      <Vidrio ref={caja} variante="denso" role="dialog" aria-modal="true" aria-labelledby={idTitulo} className="avisar" onPaste={alPegar}>
        <header className="avisar__cabeza">
          <h2 id={idTitulo} className="avisar__titulo">Avisar un problema</h2>
          <button type="button" className="avisar__cerrar" aria-label="Cerrar" onClick={cerrar}><X size={18} aria-hidden="true" /></button>
        </header>

        {enviado ? (
          <p role="status" className="avisar__gracias">
            {`Gracias, le llegó a ${receptor ?? 'quien recibe los avisos'}.`}
          </p>
        ) : (
          <>
            <label htmlFor={idTexto} className="campo__etiqueta">¿Qué pasó o qué te falta?</label>
            <textarea
              ref={campo}
              id={idTexto}
              className="avisar__texto"
              rows={5}
              maxLength={MAX_TEXTO}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            <p className="avisar__contador">{`${texto.length} / ${MAX_TEXTO}`}</p>

            <div className="avisar__imagen">
              {imagen === null ? (
                <label className="avisar__elegir">
                  <ImagePlus size={16} aria-hidden="true" />
                  <span>Agregar una imagen (o pegala con Ctrl+V)</span>
                  <input
                    type="file"
                    accept={TIPOS_IMAGEN.join(',')}
                    className="avisar__archivo"
                    onChange={(e) => {
                      const archivo = e.target.files?.[0];
                      e.target.value = '';
                      if (archivo) void adjuntar(archivo);
                    }}
                  />
                </label>
              ) : (
                <div className="avisar__adjunta">
                  <img src={imagen.vista} alt="Vista previa de la imagen adjunta" />
                  <span>{imagen.nombre}</span>
                  <button type="button" className="avisar__cerrar" aria-label="Quitar la imagen" onClick={() => setImagen(null)}><X size={16} aria-hidden="true" /></button>
                </div>
              )}
            </div>
            {errorImagen !== null && <Aviso tipo="error">{errorImagen}</Aviso>}

            <div className="avisar__contexto">
              <p>Se adjunta solo:</p>
              <ul>
                <li>{`Pantalla: ${contexto.titulo === '' ? '' : `${contexto.titulo} · `}${contexto.ruta}`}</li>
                <li>{`Navegador: ${contexto.navegador} · ventana ${contexto.ventana} · tema ${contexto.tema}`}</li>
                <li>{`Versión de OpenDash: ${contexto.version}`}</li>
                {contexto.error !== null && <li>{`Error de la app: ${contexto.error}`}</li>}
              </ul>
            </div>
            {error !== null && <Aviso tipo="error">{error}</Aviso>}
            <div className="avisar__botones">
              <Boton variante="primario" disabled={enviando || texto.trim() === ''} onClick={() => void enviar()}>Enviar</Boton>
              <Boton variante="fantasma" disabled={enviando} onClick={cerrar}>Cancelar</Boton>
            </div>
          </>
        )}

        <section className="avisar__propios">
          <h3 id={`${id}-propios`} className="avisar__subtitulo">Tus avisos</h3>
          {errorPropios && <Aviso tipo="error">No se pudieron cargar tus avisos.</Aviso>}
          {propios !== null && propios.length === 0 && <p className="avisar__vacio">Todavía no avisaste nada.</p>}
          {propios !== null && propios.length > 0 && (
            <ul aria-labelledby={`${id}-propios`} className="avisar__lista">
              {propios.map((a) => (
                <li key={a.id} className="avisar__item">
                  <span className="avisar__item-texto">{a.texto}</span>
                  <span className="avisar__item-meta">{tiempoRelativo(a.creado)}</span>
                  <span className={`avisar__estado avisar__estado--${a.estado}`}>{ETIQUETA_ESTADO[a.estado]}</span>
                </li>
              ))}
            </ul>
          )}
          {alVerTodos !== undefined && (
            <button type="button" className="avisar__ver-todos" onClick={alVerTodos}>Ver todos</button>
          )}
        </section>
      </Vidrio>
    </div>,
    document.body,
  );
}
