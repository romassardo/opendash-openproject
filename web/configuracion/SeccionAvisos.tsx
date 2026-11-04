import { useMemo } from 'react';
import type { AjustesAvisos, Persona, Yo } from '../../compartido/tipos.js';
import { useEquipo } from '../api/consultas.js';
import { useGuardarReceptores } from '../api/mutaciones.js';
import { Interruptor } from '../ui/Interruptor.js';
import { ResultadoGuardado, useGuardado } from './guardado.js';
import { TarjetaSeccion } from './TarjetaSeccion.js';

export interface SeccionAvisosProps {
  yo: Yo;
  avisos: AjustesAvisos;
  personas: Persona[];
}

/** «Avisos de problemas»: quiénes reciben los avisos. Con la lista ya armada, solo la cambian los que están en ella. */
export function SeccionAvisos({ yo, avisos, personas }: SeccionAvisosProps) {
  const equipo = useEquipo();
  const guardar = useGuardarReceptores();
  const estado = useGuardado();
  const { receptores } = avisos;
  const bloqueada = receptores.length > 0 && !receptores.includes(yo.id);

  // Solo se puede elegir a quien ya entró a OpenDash (el equipo trae a esas personas) y a quien ya recibe.
  const candidatas = useMemo(() => {
    const ids = new Set([...(equipo.data?.map((m) => m.personaId) ?? []), ...receptores]);
    return personas.filter((p) => ids.has(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR'));
  }, [equipo.data, personas, receptores]);

  const cambiar = (id: number, recibe: boolean): void => {
    const nuevos = recibe ? [...receptores, id] : receptores.filter((r) => r !== id);
    void estado.guardar(() => guardar.mutateAsync({ receptores: nuevos }));
  };

  return (
    <TarjetaSeccion clave="avisos" titulo="Avisos de problemas" subtitulo="Quiénes ven los avisos que manda el equipo desde «Avisar un problema»">
      {bloqueada && <p className="campo__ayuda">Solo la cambian quienes ya reciben los avisos.</p>}
      {receptores.length === 0 && <p className="campo__ayuda">Todavía no eligió nadie: mientras la lista esté vacía, cualquiera puede completarla.</p>}
      {candidatas.map((p) => (
        <Interruptor
          key={p.id}
          etiqueta={p.nombre}
          activo={receptores.includes(p.id)}
          deshabilitado={bloqueada || guardar.isPending}
          onCambio={(recibe) => cambiar(p.id, recibe)}
        />
      ))}
      <ResultadoGuardado estado={estado} />
    </TarjetaSeccion>
  );
}
