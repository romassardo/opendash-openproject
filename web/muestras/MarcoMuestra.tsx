import { Bell, CalendarDays, ChartNoAxesColumn, ChevronDown, FolderClosed, GanttChart, House, Plus, Search, Settings, SquareCheck, Sun, Users } from 'lucide-react';
import type { Persona } from '../../compartido/tipos.js';
import { Avatar } from '../ui/Avatar.js';
import { Vidrio } from '../ui/Vidrio.js';

// Marco de ejemplo (barra lateral y barra superior) solo para comparar el vidrio con la referencia.
// El marco real de la app se construye aparte.
const NAVEGACION = [
  { icono: House, texto: 'Inicio', activo: true },
  { icono: SquareCheck, texto: 'Tareas', cuenta: 7 },
  { icono: CalendarDays, texto: 'Calendario' },
  { icono: GanttChart, texto: 'Línea de tiempo' },
  { icono: FolderClosed, texto: 'Proyectos' },
  { icono: ChartNoAxesColumn, texto: 'Métricas' },
  { icono: Users, texto: 'Equipo' },
  { icono: Settings, texto: 'Configuración' },
];

export function BarraLateralMuestra({ persona }: { persona: Persona }) {
  return (
    <Vidrio as="aside" variante="cromo" className="muestra-lateral">
      <div className="muestra-marca">
        <span className="muestra-marca__logo" aria-hidden="true">OD</span>
        <span className="muestra-marca__nombre">OpenDash</span>
      </div>
      <nav className="muestra-nav" aria-label="Secciones">
        {NAVEGACION.map(({ icono: Icono, texto, activo, cuenta }) => (
          <a key={texto} href="#" className="muestra-nav__item" aria-current={activo ? 'page' : undefined}>
            <Icono size={20} aria-hidden="true" />
            <span>{texto}</span>
            {cuenta !== undefined && <b className="muestra-nav__cuenta">{cuenta}</b>}
          </a>
        ))}
      </nav>
      <p className="rotulo muestra-lateral__rotulo">Fijados</p>
      <a href="#" className="muestra-fijado"><i style={{ background: 'var(--tono-azul)' }} />Portal de clientes</a>
      <a href="#" className="muestra-fijado"><i style={{ background: 'var(--tono-violeta)' }} />Migración del ERP</a>
      <button type="button" className="muestra-yo">
        <Avatar persona={persona} tamano={36} />
        <span className="muestra-yo__texto"><b>{persona.nombre}</b><small>Líder de proyecto</small></span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
    </Vidrio>
  );
}

export function BarraSuperiorMuestra() {
  return (
    <Vidrio variante="cromo" className="muestra-herramientas">
      <button type="button" className="muestra-busqueda">
        <Search size={20} aria-hidden="true" />
        <span>Buscar</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button type="button" className="muestra-icono" aria-label="Crear"><Plus size={22} aria-hidden="true" /></button>
      <button type="button" className="muestra-icono" aria-label="Tema claro"><Sun size={22} aria-hidden="true" /></button>
      <button type="button" className="muestra-icono" aria-label="Notificaciones">
        <Bell size={22} aria-hidden="true" />
        <i className="muestra-icono__punto" />
      </button>
    </Vidrio>
  );
}
