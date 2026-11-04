import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { hoyArgentina } from '../../compartido/fechas.js';
import type { Catalogo, Tarea } from '../../compartido/tipos.js';
import { cuandoFue } from '../horas/AvisosHoras.js';
import { useHorasEnCurso } from '../horas/HorasProvider.js';
import { mensajeDeError } from '../tareas/acciones.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';

export interface RetomarUltimoDiaProps {
  tareas: Tarea[];
  catalogo: Catalogo;
}

/** «Retomar lo de ayer», «Retomar lo del viernes» o «Retomar lo del 24/10». */
export function etiquetaRetomar(dia: string, hoy: string): string {
  const cuando = cuandoFue(dia, hoy);
  return `Retomar lo ${cuando === 'Ayer' ? 'de ayer' : cuando.replace(/^El /, 'del ')}`;
}

/**
 * Prende de una las tareas del último día trabajado que siguen abiertas y no corren. Antes muestra la lista para
 * destildar; sin «varias a la vez» se elige una sola.
 */
export function RetomarUltimoDia({ tareas, catalogo }: RetomarUltimoDiaProps) {
  const { estado, enMarcha, trabajar, acciones } = useHorasEnCurso();
  const [abierto, setAbierto] = useState(false);
  const [elegidas, setElegidas] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retomando, setRetomando] = useState(false);
  const ultimo = estado?.ultimoDia ?? null;
  const cerrados = new Set(catalogo.estados.filter((e) => e.cerrado).map((e) => e.id));
  const candidatas = (ultimo?.tareaIds ?? [])
    .map((id) => tareas.find((t) => t.id === id))
    .filter((t): t is Tarea => t !== undefined && !cerrados.has(t.estadoId) && !enMarcha.some((m) => m.tareaId === t.id));
  if (ultimo === null || candidatas.length === 0) return null;
  const varias = estado?.variasALaVez ?? false;
  const etiqueta = etiquetaRetomar(ultimo.dia, hoyArgentina());

  const abrir = (): void => {
    setError(null);
    setElegidas(varias ? candidatas.map((t) => t.id) : [candidatas[0]!.id]);
    setAbierto(true);
  };
  const alternar = (id: number): void => {
    if (!varias) return setElegidas([id]);
    setElegidas((lista) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]));
  };
  const retomar = async (): Promise<void> => {
    setError(null);
    setRetomando(true);
    try {
      // De a una, en el orden en que se trabajaron: cada arranque ve lo que dejó el anterior.
      for (const id of candidatas.map((t) => t.id).filter((x) => elegidas.includes(x))) await trabajar(id);
      setAbierto(false);
    } catch (fallo) {
      setError(mensajeDeError(fallo));
    } finally {
      setRetomando(false);
    }
  };

  if (!abierto) {
    return <Boton variante="secundario" icono={<RotateCcw />} className="inicio__retomar" onClick={abrir}>{etiqueta}</Boton>;
  }
  return (
    <form className="inicio__retomar-lista" aria-label={etiqueta} onSubmit={(e) => { e.preventDefault(); void retomar(); }}>
      <fieldset className="inicio__retomar-opciones">
        <legend className="inicio__subtitulo">{varias ? '¿Qué retomás?' : '¿Cuál retomás?'}</legend>
        {candidatas.map((t) => (
          <label key={t.id} className="inicio__retomar-opcion">
            <input type={varias ? 'checkbox' : 'radio'} name="retomar" checked={elegidas.includes(t.id)} onChange={() => alternar(t.id)} />
            <span>{t.titulo}</span>
          </label>
        ))}
      </fieldset>
      <div className="inicio__retomar-botones">
        <Boton variante="primario" type="submit" disabled={elegidas.length === 0 || retomando || acciones.pendiente}>
          {varias && elegidas.length > 1 ? `Retomar ${elegidas.length}` : 'Retomar'}
        </Boton>
        <Boton variante="fantasma" disabled={retomando} onClick={() => setAbierto(false)}>Cancelar</Boton>
      </div>
      {error !== null && <Aviso tipo="error">{error}</Aviso>}
    </form>
  );
}
