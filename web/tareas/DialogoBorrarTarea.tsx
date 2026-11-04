import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { Tarea } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useResumenBorrado } from '../api/consultas.js';
import { useBorrarTarea } from '../api/mutaciones.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { atraparTab } from '../ui/foco.js';
import { plural } from '../ui/plural.js';

export interface DialogoBorrarTareaProps {
  tarea: Tarea;
  /** Cierra el diálogo sin borrar. */
  alCancelar(): void;
  /** La tarea ya se borró: cierra el detalle y avisa. */
  alBorrar(): void;
}

const horasTexto = (h: number): string => `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} h`;

/** «Se borran también 3 subtareas, 12 h cargadas y 2 adjuntos.», nombrando solo lo que hay. */
function textoQueSeBorra({ subtareas, horas, adjuntos }: { subtareas: number; horas: number; adjuntos: number }): string {
  const partes = [
    subtareas > 0 ? plural(subtareas, 'subtarea', 'subtareas') : null,
    horas > 0 ? `${horasTexto(horas)} cargadas` : null,
    adjuntos > 0 ? plural(adjuntos, 'adjunto', 'adjuntos') : null,
  ].filter((p): p is string => p !== null);
  if (partes.length === 0) return 'No se puede deshacer.';
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`;
  return `Se borran también ${lista}. No se puede deshacer.`;
}

/** «Deja de esperarla «Pruebas».» o «Dejan de esperarla «A», «B» y «C».» */
function textoSucesoras(titulos: string[]): string {
  const nombres = titulos.map((t) => `«${t}»`);
  const lista = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`;
  return `${nombres.length === 1 ? 'La espera' : 'La esperan'} ${lista}: ${nombres.length === 1 ? 'deja' : 'dejan'} de esperarla.`;
}

/** Confirmación con todo lo que se pierde y a quién afecta, porque OpenProject borra en cascada y no hay papelera. */
export function DialogoBorrarTarea({ tarea, alCancelar, alBorrar }: DialogoBorrarTareaProps) {
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);
  const resumen = useResumenBorrado(tarea.id);
  const borrar = useBorrarTarea();
  const { refetch } = resumen;

  // Se relee al abrir: lo que se muestra tiene que ser lo de ahora, no lo de cuando se abrió el detalle.
  useEffect(() => {
    void refetch();
  }, [refetch]);
  useLayoutEffect(() => {
    caja.current?.querySelector<HTMLButtonElement>('[data-accion="cancelar"]')?.focus();
  }, []);

  // El diálogo vive dentro del panel del detalle, que cerraría todo con Escape y dejaría salir el foco con Tab:
  // las dos teclas se resuelven acá y no suben. Mientras se borra, Escape no hace nada (cerrar perdería el aviso).
  const alTeclear = (evento: KeyboardEvent<HTMLDivElement>): void => {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      evento.stopPropagation();
      if (!borrar.isPending) alCancelar();
    } else if (evento.key === 'Tab') {
      evento.stopPropagation();
      if (caja.current) atraparTab(evento.nativeEvent, caja.current);
    }
  };

  const datos = resumen.data;
  const conAjenas = (datos?.ajenas ?? 0) > 0;
  const bloqueado = datos?.trabajando != null || conAjenas || datos?.puede === false;
  const error = borrar.error instanceof ErrorApi ? borrar.error.mensaje : borrar.error ? 'No se pudo borrar la tarea.' : null;

  return (
    <div ref={caja} className="detalle-salida detalle-salida--borrar" role="alertdialog" aria-labelledby={id} data-conserva-borrador="" onKeyDown={alTeclear}>
      <p id={id} className="detalle-salida__titulo">{`¿Seguro que querés borrar «${tarea.titulo}»?`}</p>
      {datos === undefined && !resumen.isError && <p className="detalle-salida__texto">Calculando lo que se borra…</p>}
      {resumen.isError && <Aviso tipo="error">No se pudo calcular lo que se borra. Probá de nuevo.</Aviso>}
      {datos && (
        <>
          <p className="detalle-salida__texto">
            {textoQueSeBorra(datos)}
          </p>
          {datos.sucesoras.length > 0 && <p className="detalle-salida__texto">{textoSucesoras(datos.sucesoras)}</p>}
          {datos.horas > 0 && (
            <p className="detalle-salida__texto">
              {`Las ${horasTexto(datos.horas)} cargadas se borran de OpenProject; quienes las trabajaron las pueden pasar a otra tarea`}
            </p>
          )}
          {datos.motivo !== null && <Aviso tipo="error">{datos.motivo}</Aviso>}
          {conAjenas && (
            <Aviso tipo="error">
              {`No se puede borrar: ${datos.ajenas === 1 ? 'tiene 1 subtarea que creó' : `tiene ${datos.ajenas} subtareas que creó`} otra persona.`}
            </Aviso>
          )}
          {datos.trabajando !== null && <Aviso tipo="error">{`${datos.trabajando} está trabajando en esta tarea ahora`}</Aviso>}
        </>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="detalle__botones">
        <Boton variante="fantasma" data-accion="cancelar" disabled={borrar.isPending} onClick={alCancelar}>Cancelar</Boton>
        <Boton
          variante="secundario"
          className="boton--peligro"
          disabled={datos === undefined || bloqueado || borrar.isPending}
          onClick={() => borrar.mutate(tarea.id, { onSuccess: alBorrar })}
        >
          {borrar.isPending ? 'Borrando…' : 'Borrar'}
        </Boton>
      </div>
    </div>
  );
}
