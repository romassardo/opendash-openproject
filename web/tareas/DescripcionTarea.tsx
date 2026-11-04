import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import type { Tarea } from '../../compartido/tipos.js';
import { Boton } from '../ui/Boton.js';
import type { EdicionTarea, Resultado } from './accionesDetalle.js';
import { useBorrador, useEstadoVivo, usePreguntarPorBorrador } from './borradores.js';
import { enviarConControl, Seccion } from './SeccionesDetalle.js';
import { TextoMarkdown } from './texto.js';
import { TuVersion } from './TuVersion.js';

/**
 * Descripción en markdown. Lo escrito no se pierde nunca:
 * - si guardar falla se sigue editando con el borrador (Ruling 28);
 * - si el servidor ya tiene otra descripción (un conflicto, o un cambio ajeno que llegó mientras se
 *   editaba, Ruling 29) no se manda: se ve la nueva y lo escrito queda en «Tu versión»;
 * - Escape con cambios pregunta antes de descartar.
 */
export function DescripcionTarea({ tarea, edicion }: { tarea: Tarea; edicion: EdicionTarea }) {
  // null: se está viendo; texto: se está editando.
  const [borrador, setBorrador, borradorVivo] = useEstadoVivo<string | null>(null);
  const [suya, setSuya, suyaViva] = useEstadoVivo<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const servidor = useRef(tarea.descripcion);
  servidor.current = tarea.descripcion;
  // Descripción del servidor cuando se empezó a editar.
  const base = useRef('');
  const botonEditar = useRef<HTMLButtonElement>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  const preguntar = usePreguntarPorBorrador();
  const editando = borrador !== null;
  const yaEdito = useRef(false);

  // Al salir de la edición el foco vuelve al lápiz (si no, quedaría en el aire y Escape no cerraría el panel).
  useEffect(() => {
    if (!editando && yaEdito.current) botonEditar.current?.focus();
    if (editando) yaEdito.current = true;
  }, [editando]);

  const empezar = (texto: string, desde: string) => {
    base.current = desde;
    setBorrador(texto);
  };

  const enviar = async (texto: string, esperado: string): Promise<Resultado> => {
    setGuardando(true);
    const resultado = await edicion.guardar({ descripcion: texto }, { descripcion: esperado });
    setGuardando(false);
    if (resultado === 'conflicto') setSuya(texto);
    // Otro error: se sigue (o se vuelve a) editando con lo escrito, junto al aviso.
    if (resultado === 'fallo') empezar(texto, esperado);
    else setBorrador(null);
    return resultado;
  };

  const cambiado = () => borradorVivo.current !== null && borradorVivo.current !== base.current;

  const guardar = (evento: FormEvent) => {
    evento.preventDefault();
    const texto = borradorVivo.current;
    if (texto === null || guardando) return;
    if (!cambiado()) return setBorrador(null);
    void enviar(texto, base.current);
  };

  // Se compara contra la descripción que se ve al reaplicar.
  const reaplicar = async (): Promise<Resultado> => {
    const texto = suyaViva.current;
    if (texto === null) return 'guardado';
    setSuya(null);
    return enviar(texto, servidor.current);
  };

  useBorrador('descripcion', {
    sucio: () => suyaViva.current !== null || cambiado(),
    async guardar() {
      if (suyaViva.current !== null) return (await reaplicar()) === 'guardado';
      const texto = borradorVivo.current;
      if (texto === null || !cambiado()) {
        setBorrador(null);
        return true;
      }
      return (await enviar(texto, base.current)) === 'guardado';
    },
    descartar() {
      setSuya(null);
      setBorrador(null);
    },
    enfocar: () => (caja.current ?? botonEditar.current)?.focus(),
  });

  const version = suya !== null && (
    <TuVersion
      etiqueta="Tu versión de la descripción"
      ocupada={guardando || edicion.releyendo}
      alReaplicar={() => void reaplicar()}
      alDescartar={() => setSuya(null)}
    >
      {suya.trim() === '' ? <p className="detalle__vacio">Sin descripción</p> : <TextoMarkdown texto={suya} />}
    </TuVersion>
  );

  if (!editando) {
    const vacia = tarea.descripcion.trim() === '';
    return (
      <Seccion
        titulo="Descripción"
        extra={(
          <button
            ref={botonEditar}
            type="button"
            className="detalle__icono"
            aria-label="Editar descripción"
            onClick={() => empezar(tarea.descripcion, tarea.descripcion)}
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
        )}
      >
        {vacia ? <p className="detalle__vacio">Sin descripción</p> : <TextoMarkdown texto={tarea.descripcion} className="detalle__descripcion" />}
        {version}
      </Seccion>
    );
  }

  return (
    <Seccion titulo="Descripción">
      <form
        className="detalle-descripcion"
        onSubmit={guardar}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          // Con cambios se pregunta; sin cambios, Escape solo sale de la edición.
          if (cambiado()) preguntar(['descripcion']);
          else setBorrador(null);
        }}
      >
        <textarea
          ref={caja}
          className="detalle__caja detalle-descripcion__texto"
          aria-label="Descripción"
          autoFocus
          rows={6}
          value={borrador}
          readOnly={guardando}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={enviarConControl}
        />
        <section className="detalle-descripcion__previa" aria-label="Vista previa">
          {borrador.trim() === '' ? <p className="detalle__vacio">Sin descripción</p> : <TextoMarkdown texto={borrador} />}
        </section>
        <div className="detalle__botones">
          <Boton variante="fantasma" onClick={() => setBorrador(null)}>Cancelar</Boton>
          <Boton variante="primario" type="submit" aria-label="Guardar descripción" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </form>
      {version}
    </Seccion>
  );
}
