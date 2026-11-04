import { useEffect, useState } from 'react';
import { NOMBRE_COLUMNA } from '../../compartido/columnas.js';
import type { Columna, Estado, MapeoTablero } from '../../compartido/tipos.js';
import { useGuardarTablero } from '../api/mutaciones.js';
import { NotaEquipo, ResultadoGuardado, useGuardado } from './guardado.js';
import { TarjetaSeccion } from './TarjetaSeccion.js';

const COLUMNAS: readonly Columna[] = ['nuevo', 'curso', 'pausa', 'cerrado'];
const AUTOMATICO = 'Automático (por nombre)';

interface FilaTableroProps {
  columna: Columna;
  elegido: number | null;
  estados: Estado[];
  onElegir(id: number | null): Promise<unknown>;
}

function FilaTablero({ columna, elegido, estados, onElegir }: FilaTableroProps) {
  const [valor, setValor] = useState(elegido === null ? '' : String(elegido));
  const estado = useGuardado();
  useEffect(() => setValor(elegido === null ? '' : String(elegido)), [elegido]);
  const id = `configuracion-tablero-${columna}`;
  const posibles = estados.filter((e) => e.cerrado === (columna === 'cerrado'));

  const cambiar = (nuevo: string) => {
    setValor(nuevo);
    // Si el servidor lo rechaza, el desplegable vuelve a lo que estaba guardado.
    void estado.guardar(() => onElegir(nuevo === '' ? null : Number(nuevo))).then((salioBien) => {
      if (!salioBien) setValor(elegido === null ? '' : String(elegido));
    });
  };

  return (
    <div className="campo guardable">
      <label htmlFor={id} className="campo__etiqueta">{NOMBRE_COLUMNA[columna]}</label>
      <select id={id} className="campo__entrada" value={valor} onChange={(e) => cambiar(e.target.value)}>
        <option value="">{AUTOMATICO}</option>
        {posibles.map((e) => <option key={e.id} value={String(e.id)}>{e.nombre}</option>)}
      </select>
      <ResultadoGuardado estado={estado} />
    </div>
  );
}

export function SeccionTablero({ estados, tablero }: { estados: Estado[]; tablero: MapeoTablero }) {
  const guardar = useGuardarTablero();
  return (
    <TarjetaSeccion clave="tablero" titulo="Tablero" subtitulo="Qué estado de OpenProject escribe cada columna">
      <NotaEquipo>Estos ajustes son del equipo: se ven igual para todos.</NotaEquipo>
      <p className="tarjeta__sub">
        El estado de OpenProject que escribe cada columna al mover una tarjeta. Los estados abiertos que no elijas van a Nuevo; los cerrados, a Cerrado.
      </p>
      {COLUMNAS.map((columna) => (
        <FilaTablero
          key={columna}
          columna={columna}
          elegido={tablero[columna]}
          estados={estados}
          onElegir={(id) => guardar.mutateAsync({ ...tablero, [columna]: id })}
        />
      ))}
    </TarjetaSeccion>
  );
}
