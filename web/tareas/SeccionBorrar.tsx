import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Tarea } from '../../compartido/tipos.js';
import { usePermisoBorrado } from '../api/consultas.js';
import { Boton } from '../ui/Boton.js';
import { DialogoBorrarTarea } from './DialogoBorrarTarea.js';

export interface SeccionBorrarProps {
  tarea: Tarea;
  alBorrar(): void;
}

/**
 * Al pie del detalle: «Borrar tarea» siempre a la vista. Si no se puede (la creó otra persona o OpenProject no deja),
 * el botón queda apagado y abajo dice por qué; si se puede, abre la confirmación con todo lo que se pierde.
 */
export function SeccionBorrar({ tarea, alBorrar }: SeccionBorrarProps) {
  // Solo el permiso: el conteo de lo que se pierde lo pide el diálogo al abrirse.
  const permiso = usePermisoBorrado(tarea.id);
  const [borrando, setBorrando] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const datos = permiso.data;
  if (datos === undefined) return null;
  return (
    <div className="detalle-borrar">
      <Boton
        ref={boton}
        variante="secundario"
        className="detalle-borrar__boton"
        disabled={!datos.puede}
        aria-describedby={datos.motivo === null ? undefined : `motivo-borrar-${tarea.id}`}
        data-conserva-borrador=""
        icono={<Trash2 size={16} />}
        onClick={() => setBorrando(true)}
      >
        Borrar tarea
      </Boton>
      {datos.motivo !== null && <p id={`motivo-borrar-${tarea.id}`} className="detalle-borrar__motivo">{datos.motivo}</p>}
      {borrando && (
        <DialogoBorrarTarea
          tarea={tarea}
          alCancelar={() => { setBorrando(false); boton.current?.focus(); }}
          alBorrar={alBorrar}
        />
      )}
    </div>
  );
}
