import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useLocation } from 'react-router';
import { CalendarOff, Droplet, Gauge, KanbanSquare, MessageSquareWarning, Palette, Timer, UserRound, type LucideIcon } from 'lucide-react';
import type { Persona, Yo } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useAjustes, useCatalogo, useYo } from '../api/consultas.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { Aviso } from '../ui/Aviso.js';
import { Avatar } from '../ui/Avatar.js';
import { unir } from '../ui/clases.js';
import { Vidrio } from '../ui/Vidrio.js';
import { SeccionAvisos } from './SeccionAvisos.js';
import { SeccionApariencia } from './SeccionApariencia.js';
import { SeccionCuenta } from './SeccionCuenta.js';
import { SeccionFeriados } from './SeccionFeriados.js';
import { SeccionHoras } from './SeccionHoras.js';
import { SeccionMetricas } from './SeccionMetricas.js';
import { SeccionProyectos } from './SeccionProyectos.js';
import { SeccionTablero } from './SeccionTablero.js';
// Campos, avisos y formularios son los de la pantalla de ingreso.
import '../ingreso/ingreso.css';
// El cuadrado del ícono de proyecto (IconoProyecto) se estiliza ahí.
import '../proyectos/proyectos.css';
import './configuracion.css';

interface EntradaNavegacion { clave: string; nombre: string; icono: LucideIcon }

const NAVEGACION: readonly EntradaNavegacion[] = [
  { clave: 'cuenta', nombre: 'Mi cuenta', icono: UserRound },
  { clave: 'horas', nombre: 'Horas de trabajo', icono: Timer },
  { clave: 'apariencia', nombre: 'Apariencia', icono: Palette },
  { clave: 'proyectos', nombre: 'Proyectos', icono: Droplet },
  { clave: 'tablero', nombre: 'Tablero', icono: KanbanSquare },
  { clave: 'metricas', nombre: 'Métricas', icono: Gauge },
  { clave: 'feriados', nombre: 'Feriados', icono: CalendarOff },
  { clave: 'avisos', nombre: 'Avisos de problemas', icono: MessageSquareWarning },
];

const PREFIJO = 'configuracion-';
// Franja de la pantalla que cuenta como «a la vista»: cerca de arriba, bajo el encabezado.
const ZONA_VISIBLE = '-15% 0px -70% 0px';

/** La sección a la vista: la que cruza la franja de arriba; al elegir una en la navegación, esa. */
function useSeccionVisible(listo: boolean): [string, (clave: string) => void] {
  const [activa, setActiva] = useState(NAVEGACION[0]!.clave);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observador = new IntersectionObserver(
      (entradas) => {
        const dentro = entradas.filter((e) => e.isIntersecting && e.target.id.startsWith(PREFIJO)).at(-1);
        if (dentro) setActiva(dentro.target.id.slice(PREFIJO.length));
      },
      { rootMargin: ZONA_VISIBLE },
    );
    for (const { clave } of NAVEGACION) {
      const seccion = document.getElementById(PREFIJO + clave);
      if (seccion) observador.observe(seccion);
    }
    return () => observador.disconnect();
    // Las tarjetas del equipo aparecen cuando llegan sus datos: ahí se vuelve a observar.
  }, [listo]);
  return [activa, setActiva];
}

function Navegacion({ yo, persona, listo }: { yo: Yo; persona: Persona; listo: boolean }) {
  const [activa, setActiva] = useSeccionVisible(listo);
  const { hash } = useLocation();
  const yaDesplazado = useRef('');
  // Una dirección con ancla (`/configuracion#configuracion-cuenta`) baja a su sección. La pantalla es lazy y algunas
  // secciones esperan datos: si todavía no está en el DOM, se reintenta cuando llegan (`listo`).
  useEffect(() => {
    const id = hash.slice(1);
    if (!id.startsWith(PREFIJO) || yaDesplazado.current === id) return;
    const seccion = document.getElementById(id);
    const clave = id.slice(PREFIJO.length);
    if (!seccion || !NAVEGACION.some((e) => e.clave === clave)) return;
    yaDesplazado.current = id;
    setActiva(clave);
    seccion.scrollIntoView?.({ block: 'start' });
  }, [hash, listo, setActiva]);
  const ir = (evento: MouseEvent<HTMLAnchorElement>, clave: string) => {
    evento.preventDefault();
    setActiva(clave);
    // Con movimiento reducido el desplazamiento no se anima (el navegador lo respeta por CSS).
    document.getElementById(PREFIJO + clave)?.scrollIntoView?.({ block: 'start' });
  };
  return (
    <Vidrio as="aside" className="configuracion__lateral">
      <div className="configuracion__persona">
        <Avatar persona={persona} tamano={44} />
        <div>
          <p className="configuracion__nombre">{yo.nombre}</p>
          <p className="tarjeta__sub">{yo.rol || yo.login}</p>
        </div>
      </div>
      <nav aria-label="Secciones de configuración" className="configuracion__nav">
        {NAVEGACION.map(({ clave, nombre, icono: Icono }) => (
          <a
            key={clave}
            href={`#${PREFIJO}${clave}`}
            className={unir('configuracion__enlace', activa === clave && 'configuracion__enlace--activo')}
            aria-current={activa === clave ? 'true' : undefined}
            onClick={(e) => ir(e, clave)}
          >
            <span className="configuracion__enlace-icono" aria-hidden="true"><Icono size={16} /></span>
            {nombre}
          </a>
        ))}
      </nav>
    </Vidrio>
  );
}

export function PantallaConfiguracion() {
  const yo = useYo();
  // El marco solo muestra las pantallas con la persona cargada.
  return yo.data ? <Configuracion yo={yo.data} /> : null;
}

/** Errores que ya atiende el marco (diálogo de token, vuelta al ingreso): la pantalla no los repite. */
const loAtiendeElMarco = (error: unknown): boolean =>
  error instanceof ErrorApi && (error.codigo === 'token-vencido' || error.codigo === 'no-sesion');

function Configuracion({ yo }: { yo: Yo }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(ref);
  const catalogo = useCatalogo();
  const ajustes = useAjustes();
  const cat = catalogo.data;
  const equipo = ajustes.data;
  const persona = useMemo<Persona>(
    () => cat?.personas.find((p) => p.id === yo.id) ?? { id: yo.id, nombre: yo.nombre, login: yo.login, email: null, avatarUrl: null },
    [cat, yo],
  );
  const falla = [catalogo, ajustes].find((c) => c.error && !loAtiendeElMarco(c.error));

  return (
    <div ref={ref} className="pantalla pantalla-configuracion">
      <EncabezadoPantalla titulo="Configuración" subtitulo="Tu cuenta, el aspecto de OpenDash y los ajustes del equipo" />
      <div className="configuracion">
        <Navegacion yo={yo} persona={persona} listo={Boolean(cat && equipo)} />
        <div className="configuracion__secciones">
          <SeccionCuenta yo={yo} persona={persona} />
          <SeccionHoras yo={yo} horas={equipo?.horas} />
          <SeccionApariencia />
          {falla && (
            <Aviso tipo="error">
              {falla.error instanceof ErrorApi ? falla.error.mensaje : 'No se pudieron cargar los ajustes del equipo.'}
            </Aviso>
          )}
          {cat && equipo && (
            <>
              <SeccionProyectos proyectos={cat.proyectos} estilos={equipo.estilos} plantillas={cat.plantillas ?? []} />
              <SeccionTablero estados={cat.estados} tablero={cat.tablero} />
              <SeccionMetricas metricas={equipo.metricas} />
            </>
          )}
          <SeccionFeriados />
          {cat && equipo && <SeccionAvisos yo={yo} avisos={equipo.avisos} personas={cat.personas} />}
        </div>
      </div>
    </div>
  );
}
