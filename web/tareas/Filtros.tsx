import { useMemo, type ReactNode } from 'react';
import { ChevronDown, Flag, Folder, Search, Users } from 'lucide-react';
import type { Catalogo, Persona } from '../../compartido/tipos.js';
import type { Yo } from '../../compartido/tipos.js';
import { Avatar } from '../ui/Avatar.js';
import { unir } from '../ui/clases.js';
import { Vidrio } from '../ui/Vidrio.js';
import type { FiltroUrl } from './filtroUrl.js';
import type { FiltroTareas } from './logica.js';

export interface Opcion { valor: string; texto: string }

export interface ChipProps {
  etiqueta: string;
  icono: ReactNode;
  valor: string;
  opciones: Opcion[];
  /** Si el valor no es el de por defecto, el chip se marca. */
  activo: boolean;
  alCambiar(valor: string): void;
}

/** Chip con un `<select>` nativo encima (invisible): se ve como un chip y se usa como un select. */
export function Chip({ etiqueta, icono, valor, opciones: base, activo, alCambiar }: ChipProps) {
  // Un valor de la dirección que (todavía) no está en el catálogo se muestra igual, sin inventar el nombre.
  const opciones = base.some((o) => o.valor === valor) ? base : [...base, { valor, texto: 'Sin datos todavía' }];
  const elegida = opciones.find((o) => o.valor === valor);
  return (
    <div className={unir('chip', activo && 'chip--activo')}>
      <span className="chip__icono" aria-hidden="true">{icono}</span>
      <span className="chip__texto">{elegida?.texto}</span>
      <ChevronDown className="chip__flecha" size={16} aria-hidden="true" />
      <select className="chip__select" aria-label={etiqueta} value={valor} onChange={(e) => alCambiar(e.target.value)}>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>{o.texto}</option>
        ))}
      </select>
    </div>
  );
}

const porNombre = <T extends { nombre: string }>(a: T, b: T) => a.nombre.localeCompare(b.nombre, 'es-AR');

export interface FiltrosProps {
  filtro: FiltroTareas;
  catalogo: Catalogo | undefined;
  yo: Yo;
  alCambiar(filtro: FiltroUrl): void;
  alCambiarTexto(texto: string): void;
  /** El filtro que la pantalla ya fija (proyecto o persona) no se ofrece. */
  ocultar?: 'proyecto' | 'persona';
}

export function Filtros({ filtro, catalogo, yo, alCambiar, alCambiarTexto, ocultar }: FiltrosProps) {
  const { texto, ...enUrl } = filtro;
  const proyectos = useMemo(() => [...(catalogo?.proyectos ?? [])].sort(porNombre), [catalogo]);
  const personas = useMemo(() => (catalogo?.personas ?? []).filter((p) => p.id !== yo.id).sort(porNombre), [catalogo, yo.id]);

  const personaDe = (id: number): Persona =>
    catalogo?.personas.find((p) => p.id === id) ?? { id, nombre: id === yo.id ? yo.nombre : 'Persona', login: null, email: null, avatarUrl: null };
  const iconoPersona = filtro.persona === 'todas'
    ? <Users size={18} />
    : <Avatar persona={personaDe(filtro.persona === 'mias' ? yo.id : filtro.persona)} tamano={22} />;

  return (
    <Vidrio className="filtros" role="search" aria-label="Filtros de tareas">
      <div className="filtros__desplazable">
        {ocultar !== 'proyecto' && <Chip
          etiqueta="Proyecto"
          icono={<Folder size={18} />}
          valor={filtro.proyectoId === null ? '' : String(filtro.proyectoId)}
          opciones={[{ valor: '', texto: 'Todos los proyectos' }, ...proyectos.map((p) => ({ valor: String(p.id), texto: p.nombre }))]}
          activo={filtro.proyectoId !== null}
          alCambiar={(v) => alCambiar({ ...enUrl, proyectoId: v === '' ? null : Number(v) })}
        />}
        {ocultar !== 'persona' && <Chip
          etiqueta="Persona"
          icono={iconoPersona}
          valor={String(filtro.persona)}
          opciones={[
            { valor: 'todas', texto: 'Todas las personas' },
            { valor: 'mias', texto: 'Solo mías' },
            ...personas.map((p) => ({ valor: String(p.id), texto: p.nombre })),
          ]}
          activo={filtro.persona !== 'todas'}
          alCambiar={(v) => alCambiar({ ...enUrl, persona: v === 'todas' || v === 'mias' ? v : Number(v) })}
        />}
        <Chip
          etiqueta="Prioridad"
          icono={<Flag size={18} />}
          valor={filtro.soloAltas ? 'alta' : ''}
          opciones={[{ valor: '', texto: 'Cualquier prioridad' }, { valor: 'alta', texto: 'Alta' }]}
          activo={filtro.soloAltas}
          alCambiar={(v) => alCambiar({ ...enUrl, soloAltas: v === 'alta' })}
        />
        <label className="filtros__texto">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Filtrar por título, proyecto o persona"
            placeholder="Filtrar por título, proyecto o persona"
            autoComplete="off"
            value={texto}
            onChange={(e) => alCambiarTexto(e.target.value)}
          />
        </label>
      </div>
    </Vidrio>
  );
}
