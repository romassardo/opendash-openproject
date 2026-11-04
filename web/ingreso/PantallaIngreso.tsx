import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, LayoutDashboard, LogIn } from 'lucide-react';
import { pedir } from '../api/cliente.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { Segmentado } from '../ui/Segmentado.js';
import { Vidrio } from '../ui/Vidrio.js';
import { Campo, mensajeDeError } from './Campo.js';
import { useAlEntrar } from './sesion.js';
import './ingreso.css';

type Modo = 'entrar' | 'registro';

const MINIMO_CONTRASENA = 8;
export const PASOS_TOKEN = 'En OpenProject: tu avatar → Mi cuenta → Tokens de acceso → API → Generar';

const MODOS = [
  { valor: 'entrar', etiqueta: 'Entrar' },
  { valor: 'registro', etiqueta: 'Primera vez' },
] as const satisfies { valor: Modo; etiqueta: string }[];

const TEXTOS: Record<Modo, { titulo: string; bajada: string }> = {
  entrar: {
    titulo: 'Hola de nuevo',
    bajada: 'Entrá con tu usuario de OpenProject y tu contraseña de OpenDash.',
  },
  registro: {
    titulo: 'Primera vez en OpenDash',
    bajada: 'Conectá tu cuenta de OpenProject con un token y elegí una contraseña para entrar acá.',
  },
};

export function PantallaIngreso() {
  const [modo, setModo] = useState<Modo>('entrar');
  const ref = useRef<HTMLElement>(null);
  useEntradaEscalonada(ref);

  return (
    <main ref={ref} className="ingreso">
      <div className="ingreso__marca" data-entra="pieza">
        <span className="marca__logo" aria-hidden="true"><LayoutDashboard size={21} /></span>
        <span className="marca__nombre">OpenDash</span>
      </div>
      <Vidrio as="section" className="ingreso__tarjeta" aria-labelledby="ingreso-titulo">
        <div className="ingreso__cabeza">
          <h1 id="ingreso-titulo" className="ingreso__titulo">{TEXTOS[modo].titulo}</h1>
          <p className="tarjeta__sub">{TEXTOS[modo].bajada}</p>
        </div>
        <Segmentado etiqueta="Cómo entrar" opciones={[...MODOS]} valor={modo} onCambio={setModo} className="ingreso__modos" />
        {modo === 'entrar' ? <FormularioEntrar /> : <FormularioRegistro />}
      </Vidrio>
      <p className="ingreso__pie" data-entra="pieza">Tus datos siguen viviendo en OpenProject.</p>
    </main>
  );
}

function FormularioEntrar() {
  const alEntrar = useAlEntrar();
  const [login, setLogin] = useState('');
  const [contrasena, setContrasena] = useState('');
  const entrar = useMutation({
    mutationFn: (datos: { login: string; contrasena: string }) => pedir<unknown>('POST', '/api/auth/ingreso', datos),
    onSuccess: alEntrar,
  });
  const [aviso, setAviso] = useState<string | null>(null);

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (login.trim() === '' || contrasena === '') {
      setAviso('Completá el usuario y la contraseña.');
      return;
    }
    setAviso(null);
    entrar.mutate({ login: login.trim(), contrasena });
  };

  const error = aviso ?? (entrar.isError ? mensajeDeError(entrar.error, 'No se pudo entrar. Probá de nuevo.') : null);
  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      <Campo
        id="ingreso-login"
        etiqueta="Usuario de OpenProject"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={login}
        onChange={(e) => setLogin(e.target.value)}
      />
      <Campo
        id="ingreso-contrasena"
        etiqueta="Contraseña"
        type="password"
        autoComplete="current-password"
        value={contrasena}
        onChange={(e) => setContrasena(e.target.value)}
      />
      {error && <Aviso tipo="error">{error}</Aviso>}
      <Boton variante="primario" type="submit" icono={<LogIn />} disabled={entrar.isPending} className="formulario__enviar">
        Entrar
      </Boton>
    </form>
  );
}

function validarRegistro(token: string, contrasena: string, repetida: string): string | null {
  if (token.trim() === '') return 'Pegá el token que generaste en OpenProject.';
  if (contrasena.length < MINIMO_CONTRASENA) return `La contraseña tiene que tener al menos ${MINIMO_CONTRASENA} caracteres.`;
  if (contrasena !== repetida) return 'Las contraseñas no coinciden.';
  return null;
}

function FormularioRegistro() {
  const alEntrar = useAlEntrar();
  const [token, setToken] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [repetida, setRepetida] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const registrar = useMutation({
    mutationFn: (datos: { token: string; contrasena: string }) => pedir<unknown>('POST', '/api/auth/registro', datos),
    onSuccess: alEntrar,
  });

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const problema = validarRegistro(token, contrasena, repetida);
    setAviso(problema);
    if (problema === null) registrar.mutate({ token: token.trim(), contrasena });
  };

  const error = aviso ?? (registrar.isError ? mensajeDeError(registrar.error, 'No se pudo crear la cuenta. Probá de nuevo.') : null);
  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      <div className="pasos">
        <KeyRound size={18} aria-hidden="true" className="pasos__icono" />
        <div>
          <p className="pasos__titulo">Generá un token de API</p>
          <p className="pasos__texto">{PASOS_TOKEN}</p>
        </div>
      </div>
      <Campo
        id="registro-token"
        etiqueta="Token de OpenProject"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        ayuda="Queda guardado cifrado en el servidor; tu navegador no lo vuelve a ver."
      />
      <Campo
        id="registro-contrasena"
        etiqueta="Contraseña"
        type="password"
        autoComplete="new-password"
        value={contrasena}
        onChange={(e) => setContrasena(e.target.value)}
        ayuda={`Solo para OpenDash, de al menos ${MINIMO_CONTRASENA} caracteres. No es la de OpenProject.`}
      />
      <Campo
        id="registro-repetida"
        etiqueta="Repetir contraseña"
        type="password"
        autoComplete="new-password"
        value={repetida}
        onChange={(e) => setRepetida(e.target.value)}
      />
      {error && <Aviso tipo="error">{error}</Aviso>}
      <Boton variante="primario" type="submit" disabled={registrar.isPending} className="formulario__enviar">
        Crear cuenta y entrar
      </Boton>
    </form>
  );
}
