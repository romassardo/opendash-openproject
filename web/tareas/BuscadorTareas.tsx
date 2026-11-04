import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import type { Catalogo, Tarea } from '../../compartido/tipos.js';
import { unir } from '../ui/clases.js';
import { buscarTareas } from './edicion.js';
import './buscador.css';

export interface BuscadorTareasProps {
  /** Nombre accesible del campo. */
  etiqueta: string;
  placeholder: string;
  /** Tareas que se pueden elegir (ya sin las que no corresponden). */
  candidatas: Tarea[];
  catalogo: Catalogo;
  deshabilitado?: boolean;
  alElegir(tarea: Tarea): void;
}

/** Campo con lista de sugerencias (combobox): se escribe parte del título o `#id` y se elige con clic o Enter. */
export function BuscadorTareas({ etiqueta, placeholder, candidatas, catalogo, deshabilitado = false, alElegir }: BuscadorTareasProps) {
  const idLista = useId();
  const [texto, setTexto] = useState('');
  const [activa, setActiva] = useState(0);
  const resultados = useMemo(() => buscarTareas(candidatas, texto), [candidatas, texto]);
  const abierto = texto.trim() !== '';
  const proyectos = useMemo(() => new Map(catalogo.proyectos.map((p) => [p.id, p.nombre])), [catalogo.proyectos]);
  const idOpcion = (i: number) => `${idLista}-${i}`;

  const elegir = (tarea: Tarea | undefined) => {
    if (!tarea) return;
    setTexto('');
    setActiva(0);
    alElegir(tarea);
  };

  const alTeclear = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (!abierto) return;
    const n = resultados.length;
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (n > 0) setActiva((i) => (i + (evento.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      elegir(resultados[activa]);
    } else if (evento.key === 'Escape') {
      // Cierra solo las sugerencias; el panel sigue abierto.
      evento.preventDefault();
      setTexto('');
    }
  };

  return (
    <div className="buscador">
      <Search size={16} className="buscador__icono" aria-hidden="true" />
      <input
        role="combobox"
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={abierto && resultados.length > 0 ? idOpcion(activa) : undefined}
        className="buscador__campo"
        placeholder={placeholder}
        autoComplete="off"
        disabled={deshabilitado}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setActiva(0);
        }}
        onKeyDown={alTeclear}
      />
      {abierto && (
        <div className="buscador__sugerencias">
          <ul id={idLista} role="listbox" aria-label={etiqueta}>
            {resultados.map((t, i) => (
              <li
                key={t.id}
                id={idOpcion(i)}
                role="option"
                aria-selected={i === activa}
                className={unir('buscador__opcion', i === activa && 'buscador__opcion--activa')}
                // Sin perder el foco del campo al tocar la opción.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiva(i)}
                onClick={() => elegir(t)}
              >
                <span className="buscador__titulo">{t.titulo}</span>
                <span className="buscador__proyecto">{proyectos.get(t.proyectoId) ?? `#${t.id}`}</span>
              </li>
            ))}
          </ul>
          {resultados.length === 0 && <p className="buscador__vacio">Ninguna tarea coincide</p>}
        </div>
      )}
    </div>
  );
}
