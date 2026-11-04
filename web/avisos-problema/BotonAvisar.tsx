import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquareWarning } from 'lucide-react';
import { CLAVES, useAjustes, useCatalogo, useTodosLosAvisos, useYo } from '../api/consultas.js';
import { DialogoAviso } from './DialogoAviso.js';

export const RUTA_PROBLEMAS = '/problemas-avisados';

/** El diálogo dentro del marco: sabe a quién le llega el aviso y adónde ir a verlos todos. */
function DialogoDelMarco({ onCerrar }: { onCerrar: () => void }) {
  const { pathname } = useLocation();
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const yo = useYo().data;
  const receptores = useAjustes().data?.avisos.receptores ?? [];
  const personas = useCatalogo().data?.personas ?? [];
  const primero = receptores.length === 1 ? personas.find((p) => p.id === receptores[0]) : undefined;
  const receptor = primero ? (primero.nombre.trim().split(/\s+/)[0] ?? null) : null;
  return (
    <DialogoAviso
      ruta={pathname}
      receptor={receptor}
      alEnviar={() => void cliente.invalidateQueries({ queryKey: CLAVES.avisosTodos })}
      alVerTodos={yo?.recibeAvisos === true ? () => { onCerrar(); void navegar(RUTA_PROBLEMAS); } : undefined}
      onCerrar={onCerrar}
    />
  );
}

/** Botón de la barra superior. Para quienes reciben los avisos, lleva la cantidad de los nuevos. */
export function BotonAvisar() {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const recibe = useYo().data?.recibeAvisos === true;
  const nuevos = (useTodosLosAvisos(recibe).data ?? []).filter((a) => a.estado === 'nuevo').length;
  return (
    <>
      <button
        ref={boton}
        type="button"
        className="herramientas__boton"
        aria-label="Avisar un problema"
        aria-haspopup="dialog"
        onClick={() => setAbierto(true)}
      >
        <MessageSquareWarning size={22} aria-hidden="true" />
        {recibe && nuevos > 0 && (
          <span className="herramientas__punto herramientas__punto--cuenta" title={`${nuevos} ${nuevos === 1 ? 'aviso nuevo' : 'avisos nuevos'}`}>
            {nuevos > 9 ? '9+' : nuevos}
          </span>
        )}
      </button>
      {abierto && <DialogoDelMarco onCerrar={() => setAbierto(false)} />}
    </>
  );
}
