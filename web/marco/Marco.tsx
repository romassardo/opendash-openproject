import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useOutlet } from 'react-router';
import { CloudOff } from 'lucide-react';
import { ErrorApi } from '../api/cliente.js';
import { useDesactualizado, useYo } from '../api/consultas.js';
import type { Yo } from '../../compartido/tipos.js';
import { salidaVista, useEntradaMarco } from '../animaciones/entradas.js';
import { AvisosHoras } from '../horas/AvisosHoras.js';
import { HorasProvider } from '../horas/HorasProvider.js';
import { IslaHoras } from '../horas/IslaHoras.js';
import { RUTA_INGRESO, type EstadoIngreso } from '../ingreso/sesion.js';
import { VigilanteReuniones } from '../reuniones/VigilanteReuniones.js';
import { Aviso } from '../ui/Aviso.js';
import { ProveedorAvisos } from '../ui/avisos.js';
import { Boton } from '../ui/Boton.js';
import { BarraLateral } from './BarraLateral.js';
import { BarraSuperior } from './BarraSuperior.js';
import { LimiteDeErrores } from './LimiteDeErrores.js';
import { seccionDe } from './secciones.js';
import { adoptarTemaDelServidor } from './tema.js';
import './marco.css';

const esCodigo = (error: unknown, codigo: ErrorApi['codigo']) => error instanceof ErrorApi && error.codigo === codigo;

/** Marco de las pantallas con sesión: barra lateral, barra de herramientas y la vista de la ruta. */
export function Marco() {
  const yo = useYo();
  const { pathname, search } = useLocation();
  const temaDelServidor = yo.data?.tema;

  useLayoutEffect(() => {
    if (temaDelServidor !== undefined) adoptarTemaDelServidor(temaDelServidor);
  }, [temaDelServidor]);

  if (esCodigo(yo.error, 'no-sesion')) {
    const estado: EstadoIngreso = { desde: pathname + search };
    return <Navigate to={RUTA_INGRESO} replace state={estado} />;
  }
  if (yo.data) return <MarcoListo yo={yo.data} />;
  // Cargando, o con el token vencido (el diálogo lo pide): solo el fondo.
  if (yo.isPending || esCodigo(yo.error, 'token-vencido')) return <div className="marco marco--vacio" aria-busy={yo.isPending} />;
  return (
    <div className="marco marco--vacio">
      <div className="marco__falla">
        <Aviso tipo="error">
          {yo.error instanceof ErrorApi ? yo.error.mensaje : 'No se pudo cargar OpenDash.'}
        </Aviso>
        <Boton variante="secundario" onClick={() => void yo.refetch()}>Reintentar</Boton>
      </div>
    </div>
  );
}

function MarcoListo({ yo }: { yo: Yo }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaMarco(ref);
  return (
    <HorasProvider>
      <ProveedorAvisos>
        <div ref={ref} className="marco">
          <BarraLateral yo={yo} />
          <main className="marco__principal">
            <BarraSuperior />
            <VistaAnimada />
          </main>
          <div className="esquina">
            <IslaHoras />
            <VigilanteReuniones yo={yo} />
          </div>
          <AvisosHoras />
          <BandaSinConexion />
        </div>
      </ProveedorAvisos>
    </HorasProvider>
  );
}

/**
 * Muestra la pantalla de la ruta. Al cambiar de sección, la saliente se cierra primero y recién
 * entonces entra la nueva; dentro de una misma sección (`/tareas` → `/tareas/12`) no hay salida.
 */
function VistaAnimada() {
  const { pathname } = useLocation();
  const actual = useOutlet();
  const seccion = seccionDe(pathname);
  const [mostrada, setMostrada] = useState(seccion);
  const anterior = useRef<ReactNode>(actual);
  const contenedor = useRef<HTMLDivElement>(null);
  const saliendo = mostrada !== seccion;

  useLayoutEffect(() => {
    if (!saliendo) anterior.current = actual;
  });

  useLayoutEffect(() => {
    if (!saliendo) return;
    const animacion = contenedor.current ? salidaVista(contenedor.current, () => setMostrada(seccion)) : null;
    if (!animacion) {
      setMostrada(seccion);
      return;
    }
    return () => {
      animacion.revert();
    };
  }, [saliendo, seccion]);

  // Si una pantalla se rompe al dibujarse, el marco sigue y otra sección vuelve a empezar de cero.
  return (
    <div ref={contenedor} className="marco__vista">
      <LimiteDeErrores key={mostrada}>{saliendo ? anterior.current : actual}</LimiteDeErrores>
    </div>
  );
}

function BandaSinConexion() {
  const desactualizado = useDesactualizado();
  return (
    <div role="status" className="banda-conexion">
      {desactualizado && (
        <p className="banda-conexion__texto">
          <CloudOff size={18} aria-hidden="true" />
          Sin conexión con OpenProject: mostrando lo último guardado
        </p>
      )}
    </div>
  );
}
