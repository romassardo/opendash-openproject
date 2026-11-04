import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { EVENTO_TOKEN_VENCIDO } from '../api/cliente.js';
import { useGuardarToken } from '../api/mutaciones.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { atraparTab } from '../ui/foco.js';
import { bloquearFondo } from '../ui/inerte.js';
import { Vidrio } from '../ui/Vidrio.js';
import { Campo, mensajeDeError } from './Campo.js';
import { PASOS_TOKEN } from './PantallaIngreso.js';
import { useCerrarSesion } from './sesion.js';
import './ingreso.css';

/** Se abre cuando la API avisa `token-vencido`; con el token nuevo vuelve a pedir todos los datos. */
export function DialogoTokenNuevo() {
  const [abierto, setAbierto] = useState(false);
  const [token, setToken] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  const velo = useRef<HTMLDivElement>(null);
  const cerrarSesion = useCerrarSesion();
  const guardar = useGuardarToken();

  useEffect(() => {
    const abrir = () => setAbierto(true);
    window.addEventListener(EVENTO_TOKEN_VENCIDO, abrir);
    return () => window.removeEventListener(EVENTO_TOKEN_VENCIDO, abrir);
  }, []);

  // Modal de verdad: el resto de la app queda inerte, el foco entra al campo y al cerrar vuelve adonde estaba.
  useLayoutEffect(() => {
    const caja = velo.current;
    if (!abierto || !caja) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const liberar = bloquearFondo(caja);
    campo.current?.focus();
    return () => {
      liberar();
      if (anterior?.isConnected) anterior.focus();
    };
  }, [abierto]);

  if (!abierto) return null;

  // Tab y Shift+Tab dan la vuelta dentro del diálogo.
  const alTeclear = (evento: KeyboardEvent<HTMLDivElement>) => atraparTab(evento, evento.currentTarget);

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const limpio = token.trim();
    if (limpio === '') return;
    guardar.mutate(limpio, {
      onSuccess: () => {
        setAbierto(false);
        setToken('');
      },
    });
  };

  return (
    <div ref={velo} className="velo" onKeyDown={alTeclear}>
      <Vidrio
        variante="denso"
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-titulo"
        aria-describedby="token-texto"
        className="dialogo"
      >
        <span className="dialogo__icono" aria-hidden="true"><KeyRound size={22} /></span>
        <h2 id="token-titulo" className="dialogo__titulo">Tu token de OpenProject venció</h2>
        <p id="token-texto" className="tarjeta__sub">
          OpenProject dejó de aceptar tu token. Generá uno nuevo y pegalo acá para seguir trabajando.
        </p>
        <form className="formulario" onSubmit={enviar} noValidate>
          <div className="pasos">
            <KeyRound size={18} aria-hidden="true" className="pasos__icono" />
            <p className="pasos__texto">{PASOS_TOKEN}</p>
          </div>
          <Campo
            ref={campo}
            id="token-nuevo"
            etiqueta="Token nuevo"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          {guardar.isError && <Aviso tipo="error">{mensajeDeError(guardar.error, 'No se pudo guardar el token. Probá de nuevo.')}</Aviso>}
          {cerrarSesion.isError && <Aviso tipo="error">No se pudo cerrar la sesión. Probá de nuevo.</Aviso>}
          <div className="dialogo__acciones">
            <Boton
              variante="secundario"
              disabled={cerrarSesion.isPending}
              onClick={() => cerrarSesion.mutate(undefined, { onSuccess: () => setAbierto(false) })}
            >
              Cerrar sesión
            </Boton>
            <Boton variante="primario" type="submit" disabled={guardar.isPending || token.trim() === ''}>
              Guardar token
            </Boton>
          </div>
        </form>
      </Vidrio>
    </div>
  );
}
