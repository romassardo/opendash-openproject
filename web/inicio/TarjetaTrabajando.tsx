import { useState } from 'react';
import { duracionTexto } from '../../compartido/horas.js';
import type { Catalogo, Tarea, Tramo } from '../../compartido/tipos.js';
import { BotonTrabajar } from '../horas/BotonTrabajar.js';
import { CorreccionTramo } from '../horas/CorreccionTramo.js';
import { useHorasEnCurso } from '../horas/HorasProvider.js';
import { BuscadorTareas } from '../tareas/BuscadorTareas.js';
import { mensajeDeError } from '../tareas/acciones.js';
import { Aviso } from '../ui/Aviso.js';
import { Vidrio } from '../ui/Vidrio.js';
import { abiertasPropias } from './logica.js';
import { RetomarUltimoDia } from './RetomarUltimoDia.js';

export interface TarjetaTrabajandoProps {
  tareas: Tarea[];
  catalogo: Catalogo;
  usuarioId: number;
}

const ESTADOS_VISIBLES: Partial<Record<Tramo['estado'], string>> = {
  cargado: 'cargado',
  pendiente: 'pendiente de cargar',
  rechazado: 'no se pudo cargar',
};

function FilaCargada({ tramo, titulo }: { tramo: Tramo; titulo: string }) {
  const [corrigiendo, setCorrigiendo] = useState(false);
  const estado = ESTADOS_VISIBLES[tramo.estado];
  return (
    <li className="inicio__fila inicio__fila--horas">
      <div className="inicio__fila-texto">
        <span className="inicio__fila-titulo">{titulo}</span>
        <span className="inicio__fila-meta">
          <b className="tnum">{duracionTexto(tramo.segundos ?? 0)}</b>
          {estado && <span className="horas-estado" data-estado={tramo.estado}>{estado}</span>}
        </span>
        {corrigiendo && <CorreccionTramo tramo={tramo} alGuardar={() => setCorrigiendo(false)} />}
      </div>
      {!corrigiendo && (
        <button type="button" className="horas-corregir" aria-label={`Corregir ${titulo}`} onClick={() => setCorrigiendo(true)}>Corregir</button>
      )}
    </li>
  );
}

/** «Trabajando ahora»: lo que corre, un selector para arrancar otra tarea y lo cargado hoy, tramo por tramo. */
export function TarjetaTrabajando({ tareas, catalogo, usuarioId }: TarjetaTrabajandoProps) {
  const { enMarcha, estado, trabajar } = useHorasEnCurso();
  const [error, setError] = useState<string | null>(null);
  const tituloDe = (id: number): string => tareas.find((t) => t.id === id)?.titulo ?? `Tarea #${id}`;
  const cargados = (estado?.hoy ?? []).filter((t) => t.estado !== 'descartado');

  const arrancar = async (tarea: Tarea): Promise<void> => {
    setError(null);
    try {
      await trabajar(tarea.id);
    } catch (fallo) {
      setError(mensajeDeError(fallo));
    }
  };

  return (
    <Vidrio as="section" id="inicio-trabajando-tarjeta" className="inicio__tarjeta inicio__tarjeta--4" aria-labelledby="inicio-trabajando">
      <header className="inicio__cabeza">
        <div>
          <h2 id="inicio-trabajando" className="tarjeta__titulo">Trabajando ahora</h2>
          <p className="tarjeta__sub">{estado?.horasExtra ? 'Tu cronómetro de hoy, con horas extra' : 'Tu cronómetro de hoy'}</p>
        </div>
      </header>
      {enMarcha.length === 0 ? (
        <p className="inicio__vacio">No estás trabajando en nada</p>
      ) : (
        <ul className="inicio__filas">
          {enMarcha.map((t) => (
            <li key={t.id} className="inicio__fila inicio__fila--horas">
              <div className="inicio__fila-texto">
                <span className="inicio__fila-titulo">{tituloDe(t.tareaId)}</span>
                <BotonTrabajar tareaId={t.tareaId} titulo={tituloDe(t.tareaId)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <RetomarUltimoDia tareas={tareas} catalogo={catalogo} />
      <BuscadorTareas etiqueta="Tarea para trabajar" placeholder="Elegí una tarea para trabajar" catalogo={catalogo}
        candidatas={abiertasPropias(tareas, catalogo, usuarioId).filter((t) => !enMarcha.some((m) => m.tareaId === t.id))}
        alElegir={(tarea) => void arrancar(tarea)} />
      {error !== null && <Aviso tipo="error">{error}</Aviso>}
      {cargados.length > 0 && (
        <>
          <h3 className="inicio__subtitulo">Cargado hoy</h3>
          <ul className="inicio__filas">
            {cargados.map((t) => <FilaCargada key={t.id} tramo={t} titulo={tituloDe(t.tareaId)} />)}
          </ul>
        </>
      )}
    </Vidrio>
  );
}
