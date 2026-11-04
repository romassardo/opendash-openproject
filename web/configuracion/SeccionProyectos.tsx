import { estiloPorDefecto, ICONOS_PROYECTO, TONOS, type EstiloProyecto } from '../../compartido/estilos.js';
import type { Proyecto } from '../../compartido/tipos.js';
import { useGuardarEstilo, useMarcarPlantilla } from '../api/mutaciones.js';
import { Interruptor } from '../ui/Interruptor.js';
import { IconoProyecto } from '../proyectos/IconoProyecto.js';
import { GrupoOpciones } from './GrupoOpciones.js';
import { NotaEquipo, ResultadoGuardado, useGuardado } from './guardado.js';
import { TarjetaSeccion } from './TarjetaSeccion.js';

const OPCIONES_TONO = TONOS.map((tono) => ({
  valor: tono,
  etiqueta: tono,
  contenido: <span className="muestra-tono" aria-hidden="true" style={{ background: `var(--tono-${tono})` }} />,
}));

function FilaProyecto({ proyecto, estilo, plantilla }: { proyecto: Proyecto; estilo: EstiloProyecto; plantilla: boolean }) {
  const guardarEstilo = useGuardarEstilo();
  const marcarPlantilla = useMarcarPlantilla();
  const estado = useGuardado();
  const cambiar = (cambio: Partial<EstiloProyecto>) =>
    void estado.guardar(() => guardarEstilo.mutateAsync({ proyectoId: proyecto.id, estilo: { ...estilo, ...cambio } }));
  return (
    <li className="configuracion__proyecto">
      <div className="configuracion__proyecto-cabeza">
        <IconoProyecto estilo={estilo} tamano={40} />
        <span className="configuracion__nombre-proyecto">{proyecto.nombre}</span>
        <ResultadoGuardado estado={estado} />
      </div>
      <GrupoOpciones
        className="configuracion__opciones"
        etiqueta={`Tono de ${proyecto.nombre}`}
        opciones={OPCIONES_TONO}
        valor={estilo.color}
        onElegir={(color) => cambiar({ color })}
      />
      <GrupoOpciones
        className="configuracion__opciones"
        etiqueta={`Ícono de ${proyecto.nombre}`}
        opciones={ICONOS_PROYECTO.map((icono) => ({
          valor: icono,
          etiqueta: icono,
          contenido: <IconoProyecto estilo={{ color: estilo.color, icono }} tamano={30} />,
        }))}
        valor={estilo.icono}
        onElegir={(icono) => cambiar({ icono })}
      />
      <Interruptor
        etiqueta="Es una plantilla"
        ayuda="Las tareas de un proyecto plantilla no cuentan como «Sin fechas» ni «Sin asignar» en «Para ordenar»."
        activo={plantilla}
        deshabilitado={marcarPlantilla.isPending}
        onCambio={(valor) => void estado.guardar(() => marcarPlantilla.mutateAsync({ proyectoId: proyecto.id, plantilla: valor }))}
      />
    </li>
  );
}

export interface SeccionProyectosProps {
  proyectos: Proyecto[];
  estilos: Record<number, EstiloProyecto>;
  /** Ids de los proyectos que son plantilla. */
  plantillas: number[];
}

export function SeccionProyectos({ proyectos, estilos, plantillas }: SeccionProyectosProps) {
  return (
    <TarjetaSeccion clave="proyectos" titulo="Proyectos" subtitulo="El color y el ícono de cada proyecto">
      <NotaEquipo>Estos ajustes son del equipo: se ven igual para todos.</NotaEquipo>
      {proyectos.length === 0 ? (
        <p className="tarjeta__sub">Todavía no hay proyectos visibles.</p>
      ) : (
        <ul className="configuracion__proyectos">
          {proyectos.map((p) => (
            <FilaProyecto key={p.id} proyecto={p} estilo={estilos[p.id] ?? estiloPorDefecto(p.id)} plantilla={plantillas.includes(p.id)} />
          ))}
        </ul>
      )}
    </TarjetaSeccion>
  );
}
