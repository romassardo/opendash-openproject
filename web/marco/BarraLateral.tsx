import { useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { ChevronDown, Download, LayoutDashboard, LogOut, Settings } from 'lucide-react';
import type { Catalogo, Persona, Proyecto, Tarea } from '../../compartido/tipos.js';
import { estiloPorDefecto } from '../../compartido/estilos.js';
import { useAjustes, useCatalogo, useTareas } from '../api/consultas.js';
import type { Yo } from '../../compartido/tipos.js';
import { useCerrarSesion } from '../ingreso/sesion.js';
import { useInstalar } from '../pwa/useInstalar.js';
import { Avatar } from '../ui/Avatar.js';
import { Aviso } from '../ui/Aviso.js';
import { useMenu } from '../ui/useMenu.js';
import { Vidrio } from '../ui/Vidrio.js';
import { rutaDeProyecto } from './busquedaLogica.js';
import { useCuentaParaOrdenar } from '../ordenar/useCuentaParaOrdenar.js';
import { SECCIONES } from './secciones.js';

/** Tareas abiertas asignadas a la persona, sin contar hitos. */
export function misTareasAbiertas(tareas: Tarea[], catalogo: Catalogo, personaId: number): number {
  const cerrados = new Set(catalogo.estados.filter((e) => e.cerrado).map((e) => e.id));
  const hitos = new Set(catalogo.tipos.filter((t) => t.esHito).map((t) => t.id));
  return tareas.filter((t) => t.responsableId === personaId && !cerrados.has(t.estadoId) && !hitos.has(t.tipoId)).length;
}

function proyectosFijados(ids: number[], catalogo: Catalogo | undefined): Proyecto[] {
  if (!catalogo) return [];
  return ids.flatMap((id) => catalogo.proyectos.find((p) => p.id === id) ?? []);
}

export function BarraLateral({ yo }: { yo: Yo }) {
  const tareas = useTareas();
  const catalogo = useCatalogo();
  const ajustes = useAjustes();
  const cuenta = tareas.data && catalogo.data ? misTareasAbiertas(tareas.data.tareas, catalogo.data, yo.id) : null;
  const cuentaOrdenar = useCuentaParaOrdenar();
  const fijados = proyectosFijados(yo.fijados, catalogo.data);
  // La foto llega por el proxy propio (`/api/personas/:id/avatar`); sin catálogo, iniciales.
  const persona: Persona = catalogo.data?.personas.find((p) => p.id === yo.id)
    ?? { id: yo.id, nombre: yo.nombre, login: yo.login, email: null, avatarUrl: null };

  return (
    <Vidrio as="aside" variante="cromo" data-entra="lateral" className="lateral" aria-label="Barra lateral">
      <Link to="/tareas" className="lateral__marca">
        <span className="marca__logo" aria-hidden="true"><LayoutDashboard size={21} /></span>
        <span className="marca__nombre">OpenDash</span>
      </Link>
      <Navegacion cuentas={{ '/tareas': cuenta, '/para-ordenar': cuentaOrdenar }} />
      {fijados.length > 0 && (
        <section className="lateral__fijados" aria-labelledby="lateral-fijados">
          <h2 id="lateral-fijados" className="rotulo lateral__rotulo">Fijados</h2>
          <ul className="lateral__lista">
            {fijados.map((p) => (
              <li key={p.id}>
                <Link to={rutaDeProyecto(p.id)} className="lateral__fijado" data-entra="menu">
                  <i className="lateral__punto" style={{ backgroundColor: `var(--tono-${(ajustes.data?.estilos[p.id] ?? estiloPorDefecto(p.id)).color})` }} aria-hidden="true" />
                  <span className="lateral__texto">{p.nombre}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <TarjetaUsuario yo={yo} persona={persona} />
    </Vidrio>
  );
}

interface Lente { y: number; alto: number }

/** Número al lado de cada sección; `null` mientras lo que lo calcula no terminó de cargar. */
function Navegacion({ cuentas }: { cuentas: Readonly<Record<string, number | null>> }) {
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const [lente, setLente] = useState<Lente | null>(null);

  // La lente de vidrio se desliza (con rebote) hasta el ítem activo.
  useLayoutEffect(() => {
    const activo = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!activo) {
      setLente(null);
      return;
    }
    const nueva = { y: activo.offsetTop, alto: activo.offsetHeight };
    setLente((previa) => (previa && previa.y === nueva.y && previa.alto === nueva.alto ? previa : nueva));
  }, [pathname]);

  return (
    <nav ref={nav} className="lateral__nav" aria-label="Secciones">
      {lente && (
        <span className="lateral__lente" aria-hidden="true" style={{ height: lente.alto, transform: `translateY(${lente.y}px)` }} />
      )}
      {SECCIONES.map(({ ruta, nombre, icono: Icono }) => (
        <NavLink key={ruta} to={ruta} className="lateral__item" data-entra="menu">
          <Icono size={20} aria-hidden="true" />
          <span className="lateral__texto">{nombre}</span>
          {(cuentas[ruta] ?? null) !== null && <span className="lateral__cuenta tnum">{cuentas[ruta]}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

const ID_MENU_CUENTA = 'menu-cuenta';

function TarjetaUsuario({ yo, persona }: { yo: Yo; persona: Persona }) {
  const { abierto: abierta, setAbierto: setAbierta, caja, boton, menu, alTeclearEnMenu } = useMenu();
  const cerrarSesion = useCerrarSesion();
  const instalar = useInstalar();

  return (
    <div ref={caja} className="lateral__cuenta-usuario">
      {abierta && (
        <div ref={menu} id={ID_MENU_CUENTA} className="menu-cuenta" role="menu" aria-label="Cuenta" onKeyDown={alTeclearEnMenu}>
          {instalar.disponible && (
            <button
              type="button"
              role="menuitem"
              className="menu-cuenta__opcion"
              onClick={() => {
                setAbierta(false);
                void instalar.instalar();
              }}
            >
              <Download size={18} aria-hidden="true" />
              Instalar OpenDash
            </button>
          )}
          <Link to="/configuracion" role="menuitem" className="menu-cuenta__opcion" onClick={() => setAbierta(false)}>
            <Settings size={18} aria-hidden="true" />
            Configuración
          </Link>
          <button
            type="button"
            role="menuitem"
            className="menu-cuenta__opcion"
            disabled={cerrarSesion.isPending}
            onClick={() => cerrarSesion.mutate()}
          >
            <LogOut size={18} aria-hidden="true" />
            Cerrar sesión
          </button>
          {cerrarSesion.isError && <Aviso tipo="error">No se pudo cerrar la sesión. Probá de nuevo.</Aviso>}
        </div>
      )}
      <button
        ref={boton}
        type="button"
        className="lateral__yo"
        aria-label={`Cuenta de ${yo.nombre}`}
        aria-haspopup="menu"
        aria-expanded={abierta}
        aria-controls={ID_MENU_CUENTA}
        onClick={() => setAbierta((valor) => !valor)}
      >
        <Avatar persona={persona} tamano={36} />
        <span className="lateral__yo-texto">
          <b>{yo.nombre}</b>
          <small>{yo.login}</small>
        </span>
        <ChevronDown size={18} aria-hidden="true" className="lateral__yo-flecha" />
      </button>
    </div>
  );
}
