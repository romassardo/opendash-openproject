import { useEffect, useRef, useState } from 'react';
import { FolderPlus, ListPlus, Moon, Plus, Search, Sun, Video } from 'lucide-react';
import { EVENTO_TOKEN_VENCIDO } from '../api/cliente.js';
import { useOpcionesNuevoProyecto } from '../api/consultas.js';
import { DialogoNuevoProyecto, puedeCrearProyecto } from '../proyectos/DialogoNuevoProyecto.js';
import { useMenu } from '../ui/useMenu.js';
import { Vidrio } from '../ui/Vidrio.js';
import { BotonAvisar } from '../avisos-problema/BotonAvisar.js';
import { Busqueda } from './Busqueda.js';
import { Notificaciones } from './Notificaciones.js';
import { useTema } from './tema.js';
import { useCambiarTema } from './useCambiarTema.js';

/** Lo emite el «+»: la pantalla que sepa crear tareas abre su formulario rápido. */
export const EVENTO_NUEVA_TAREA = 'od:nueva-tarea';

const pedirNuevaTarea = (): void => {
  window.dispatchEvent(new Event(EVENTO_NUEVA_TAREA));
};

const ID_MENU_CREAR = 'menu-crear';

/**
 * El «+»: con permiso para crear proyectos abre un menú con «Nueva tarea» y «Nuevo proyecto»; sin él, crea la tarea
 * de una.
 */
function BotonCrear() {
  const opciones = useOpcionesNuevoProyecto().data;
  const { abierto, setAbierto, caja, boton, menu, alTeclearEnMenu } = useMenu();
  const [creandoProyecto, setCreandoProyecto] = useState(false);

  if (opciones === undefined || !puedeCrearProyecto(opciones)) {
    return (
      <button type="button" className="herramientas__boton" aria-label="Nueva tarea" onClick={pedirNuevaTarea}>
        <Plus size={22} aria-hidden="true" />
      </button>
    );
  }
  return (
    <div ref={caja} className="herramientas__crear">
      <button
        ref={boton}
        type="button"
        className="herramientas__boton"
        aria-label="Crear tarea o proyecto"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={ID_MENU_CREAR}
        onClick={() => setAbierto((valor) => !valor)}
      >
        <Plus size={22} aria-hidden="true" />
      </button>
      {abierto && (
        <div ref={menu} id={ID_MENU_CREAR} className="menu-crear" role="menu" aria-label="Crear" onKeyDown={alTeclearEnMenu}>
          <button
            type="button"
            role="menuitem"
            className="menu-cuenta__opcion"
            onClick={() => {
              setAbierto(false);
              pedirNuevaTarea();
            }}
          >
            <ListPlus size={18} aria-hidden="true" />
            Nueva tarea
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-cuenta__opcion"
            onClick={() => {
              setAbierto(false);
              setCreandoProyecto(true);
            }}
          >
            <FolderPlus size={18} aria-hidden="true" />
            Nuevo proyecto
          </button>
        </div>
      )}
      {creandoProyecto && (
        <DialogoNuevoProyecto
          opciones={opciones}
          alCerrar={() => {
            setCreandoProyecto(false);
            boton.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** Meet crea la reunión en el acto con la cuenta de Google abierta en el navegador. */
const MEET_NUEVA = 'https://meet.google.com/new';

/** `true` si el foco está donde se escribe: ahí «/» es un carácter más, no un atajo. */
function escribiendo(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Otro diálogo modal (el del token, por ejemplo) ya está abierto: la paleta no se le pone encima. */
const hayOtroModal = (): boolean => document.querySelector('[aria-modal="true"]') !== null;

export function BarraSuperior() {
  const tema = useTema();
  const cambiarTema = useCambiarTema();
  const [buscando, setBuscando] = useState(false);
  const pildora = useRef<HTMLButtonElement>(null);
  const otro = tema === 'oscuro' ? 'claro' : 'oscuro';

  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => {
      const atajo = (evento.ctrlKey || evento.metaKey) && !evento.altKey && evento.key.toLowerCase() === 'k';
      const barra = evento.key === '/' && !evento.ctrlKey && !evento.metaKey && !evento.altKey && !escribiendo();
      if (!atajo && !barra) return;
      evento.preventDefault();
      if (!hayOtroModal()) setBuscando(true);
    };
    // Con el token vencido el diálogo de token es la única salida: la paleta le deja el lugar.
    const cerrar = () => setBuscando(false);
    document.addEventListener('keydown', alTeclear);
    window.addEventListener(EVENTO_TOKEN_VENCIDO, cerrar);
    return () => {
      document.removeEventListener('keydown', alTeclear);
      window.removeEventListener(EVENTO_TOKEN_VENCIDO, cerrar);
    };
  }, []);

  return (
    <Vidrio variante="cromo" data-entra="herramientas" className="herramientas">
      <button
        ref={pildora}
        type="button"
        className="herramientas__busqueda"
        aria-keyshortcuts="Control+K Meta+K"
        aria-haspopup="dialog"
        onClick={() => {
          if (!hayOtroModal()) setBuscando(true);
        }}
      >
        <Search size={20} aria-hidden="true" />
        <span className="herramientas__buscar">Buscar</span>
        <kbd>Ctrl K</kbd>
      </button>
      {buscando && <Busqueda retorno={pildora} onCerrar={() => setBuscando(false)} />}
      <BotonCrear />
      <a className="herramientas__boton" href={MEET_NUEVA} target="_blank" rel="noopener noreferrer" aria-label="Nueva reunión de Meet">
        <Video size={22} aria-hidden="true" />
      </a>
      <button type="button" className="herramientas__boton" aria-label={`Cambiar a tema ${otro}`} onClick={() => {
        // Si el servidor no lo guarda, el tema ya quedó aplicado en este navegador, que es el que manda.
        cambiarTema(otro).catch(() => {});
      }}>
        {tema === 'oscuro' ? <Sun size={22} aria-hidden="true" /> : <Moon size={22} aria-hidden="true" />}
      </button>
      <BotonAvisar />
      <Notificaciones suspendida={buscando} />
    </Vidrio>
  );
}
