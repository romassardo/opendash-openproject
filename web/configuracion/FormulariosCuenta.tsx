import { useState, type FormEvent } from 'react';
import type { EstadoCalendario, FallaCalendario, Yo } from '../../compartido/tipos.js';
import { unir } from '../ui/clases.js';
import { horaArgentina } from '../ui/tiempo.js';
import { useActualizarCuenta, useCambiarContrasena, useGuardarCalendario, useGuardarToken } from '../api/mutaciones.js';
import { Campo } from '../ingreso/Campo.js';
import { Boton } from '../ui/Boton.js';
import { usePermisoAvisos, type PermisoAvisos } from '../reuniones/usePermisoAvisos.js';
import { Segmentado } from '../ui/Segmentado.js';
import { ResultadoGuardado, useGuardado } from './guardado.js';

const LARGO_MINIMO_CONTRASENA = 8;
const AYUDA_ICS =
  'En Outlook web: Configuración → Calendario → Calendarios compartidos → Publicar un calendario, con todos los detalles. Copiá el enlace ICS.';

const MOTIVO_FALLA: Record<FallaCalendario, string> = {
  'enlace-caido': 'el enlace ya no devuelve un calendario (¿se dejó de publicar?)',
  'sin-conexion': 'no se pudo conectar con Outlook',
};

/** «Guardado · actualizado 14:05», o desde cuándo y por qué no se pudo actualizar. */
function textoEstadoCalendario(estado: EstadoCalendario | null): string {
  const hora = estado?.leido ? horaArgentina(estado.leido) : '';
  if (estado?.falla) return `Sin actualizar${hora ? ` desde ${hora}` : ''}: ${MOTIVO_FALLA[estado.falla]}`;
  return hora ? `Guardado · actualizado ${hora}` : 'Guardado';
}

/** Estado del token de OpenProject y formulario para cambiarlo. */
export function FormularioToken() {
  const [abierto, setAbierto] = useState(false);
  const [token, setToken] = useState('');
  const estado = useGuardado();
  const guardarToken = useGuardarToken();

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    const limpio = token.trim();
    if (limpio === '') return estado.rechazar('Pegá el token nuevo de OpenProject.');
    if (await estado.guardar(() => guardarToken.mutateAsync(limpio), 'No se pudo guardar el token. Probá de nuevo.')) {
      setToken('');
      setAbierto(false);
    }
  };

  return (
    <div className="configuracion__bloque">
      <div className="configuracion__fila">
        <div>
          <h3 className="configuracion__rotulo">Token de OpenProject</h3>
          <p className="tarjeta__sub">Con él OpenDash actúa en tu nombre. Nunca llega al navegador.</p>
        </div>
        <span className="configuracion__estado">Vigente</span>
        {!abierto && <Boton variante="secundario" onClick={() => setAbierto(true)}>Cambiar token</Boton>}
      </div>
      {abierto && (
        <form className="formulario" onSubmit={(e) => void enviar(e)} noValidate>
          <Campo
            id="configuracion-token"
            etiqueta="Token nuevo"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="configuracion__acciones">
            <Boton variante="primario" type="submit">Guardar token</Boton>
            <Boton variante="fantasma" onClick={() => { setAbierto(false); setToken(''); estado.limpiar(); }}>Cancelar</Boton>
          </div>
        </form>
      )}
      <ResultadoGuardado estado={estado} />
    </div>
  );
}

/** Cambio de contraseña: se valida acá antes de molestar al servidor. */
export function FormularioContrasena() {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const estado = useGuardado();
  const cambiar = useCambiarContrasena();

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (actual === '') return estado.rechazar('Ingresá tu contraseña actual.');
    if (nueva.length < LARGO_MINIMO_CONTRASENA) {
      return estado.rechazar(`La contraseña nueva tiene que tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`);
    }
    if (nueva !== repetida) return estado.rechazar('Las contraseñas nuevas no coinciden.');
    if (await estado.guardar(() => cambiar.mutateAsync({ actual, nueva }), 'No se pudo cambiar la contraseña. Probá de nuevo.')) {
      setActual('');
      setNueva('');
      setRepetida('');
    }
  };

  return (
    <form className="configuracion__bloque formulario" onSubmit={(e) => void enviar(e)} noValidate>
      <h3 className="configuracion__rotulo">Contraseña</h3>
      <Campo id="configuracion-actual" etiqueta="Contraseña actual" type="password" autoComplete="current-password"
        value={actual} onChange={(e) => setActual(e.target.value)} />
      <Campo id="configuracion-nueva" etiqueta="Contraseña nueva" type="password" autoComplete="new-password"
        ayuda={`Mínimo ${LARGO_MINIMO_CONTRASENA} caracteres. Al cambiarla se cierran tus otras sesiones.`}
        value={nueva} onChange={(e) => setNueva(e.target.value)} />
      <Campo id="configuracion-repetida" etiqueta="Repetir contraseña nueva" type="password" autoComplete="new-password"
        value={repetida} onChange={(e) => setRepetida(e.target.value)} />
      <div className="configuracion__acciones">
        <Boton variante="primario" type="submit" disabled={cambiar.isPending}>Cambiar contraseña</Boton>
      </div>
      <ResultadoGuardado estado={estado} />
    </form>
  );
}

/** Enlace ICS del calendario de Outlook: el guardado nunca vuelve al navegador. */
export function FormularioCalendario({ yo }: { yo: Yo }) {
  const [enlace, setEnlace] = useState('');
  const estado = useGuardado();
  const guardar = useGuardarCalendario();

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    const limpio = enlace.trim();
    if (limpio === '') return estado.rechazar('Pegá el enlace ICS de tu calendario de Outlook.');
    // Qué enlaces sirven lo decide el servidor; su mensaje se muestra tal cual.
    if (await estado.guardar(() => guardar.mutateAsync({ url: limpio }))) setEnlace('');
  };

  const quitar = () => void estado.guardar(() => guardar.mutateAsync({ url: null }));

  return (
    <form className="configuracion__bloque formulario" onSubmit={(e) => void enviar(e)} noValidate>
      <div className="configuracion__fila">
        <h3 className="configuracion__rotulo">Calendario de Outlook</h3>
        {yo.tieneCalendario && (
          <span className={unir('configuracion__estado', yo.calendario?.falla && 'configuracion__estado--falla')}>
            {textoEstadoCalendario(yo.calendario)}
          </span>
        )}
      </div>
      <Campo
        id="configuracion-ics"
        etiqueta="Enlace ICS"
        ayuda={AYUDA_ICS}
        type="url"
        autoComplete="off"
        spellCheck={false}
        placeholder={yo.tieneCalendario ? 'Pegá un enlace nuevo para reemplazar el guardado' : 'https://'}
        value={enlace}
        onChange={(e) => setEnlace(e.target.value)}
      />
      <div className="configuracion__acciones">
        <Boton variante="primario" type="submit" disabled={guardar.isPending}>Guardar enlace</Boton>
        {yo.tieneCalendario && <Boton variante="secundario" disabled={guardar.isPending} onClick={quitar}>Quitar enlace</Boton>}
      </div>
      <ResultadoGuardado estado={estado} />
    </form>
  );
}

const OPCIONES_AVISO = [
  { valor: 'no', etiqueta: 'No' },
  { valor: '1', etiqueta: '1 min' },
  { valor: '5', etiqueta: '5 min' },
  { valor: '10', etiqueta: '10 min' },
  { valor: '15', etiqueta: '15 min' },
] as const;

const NOTA_SIN_HTTPS = 'Sin HTTPS el navegador no deja avisar desde otra pestaña: solo vas a ver el aviso dentro de OpenDash.';
const NOTA_BLOQUEADO = 'El navegador tiene bloqueados los avisos de OpenDash; se habilitan desde el candado de la barra de direcciones.';
const NOTA_AHORA_NO = 'Elegiste no recibir avisos del navegador: solo vas a ver el aviso dentro de OpenDash.';

/** Por qué el navegador no va a avisar desde otra pestaña; `null` si puede (o si todavía no se decidió: ahí pregunta el vigilante). */
export function notaAvisoNavegador(permiso: Pick<PermisoAvisos, 'estado' | 'rechazado'>): string | null {
  if (permiso.estado === 'no-disponible') return NOTA_SIN_HTTPS;
  if (permiso.estado === 'denied') return NOTA_BLOQUEADO;
  if (permiso.estado === 'default' && permiso.rechazado) return NOTA_AHORA_NO;
  return null;
}

/** Cuántos minutos antes de cada reunión avisa OpenDash (o «No»). Va junto al enlace de Outlook. */
export function OpcionAvisoReunion({ yo }: { yo: Yo }) {
  const actualizar = useActualizarCuenta();
  const estado = useGuardado();
  const permiso = usePermisoAvisos();
  const nota = notaAvisoNavegador(permiso);
  const valor = yo.avisoReunionMin === null ? 'no' : String(yo.avisoReunionMin);
  const elegir = (v: (typeof OPCIONES_AVISO)[number]['valor']) => {
    if (v === valor) return;
    void estado.guardar(() => actualizar.mutateAsync({ avisoReunionMin: v === 'no' ? null : Number(v) }));
  };
  return (
    <div className="configuracion__bloque">
      <h3 className="configuracion__rotulo">Avisarme antes de cada reunión</h3>
      <Segmentado className="configuracion__segmentado" etiqueta="Avisarme antes de cada reunión" opciones={[...OPCIONES_AVISO]} valor={valor as (typeof OPCIONES_AVISO)[number]['valor']} onCambio={elegir} />
      {nota && <p className="tarjeta__sub">{nota}</p>}
      {permiso.estado === 'default' && permiso.rechazado && (
        <div className="configuracion__acciones">
          <Boton variante="secundario" onClick={() => void permiso.pedir()}>Permitir avisos</Boton>
        </div>
      )}
      <ResultadoGuardado estado={estado} />
    </div>
  );
}
