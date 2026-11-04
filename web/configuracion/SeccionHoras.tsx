import type { AjustesHoras, Yo } from '../../compartido/tipos.js';
import { useGuardarAjustesHoras, useActualizarCuenta } from '../api/mutaciones.js';
import { Interruptor } from '../ui/Interruptor.js';
import { CampoNumeroGuardable } from './CampoGuardable.js';
import { ResultadoGuardado, useGuardado } from './guardado.js';
import { TarjetaSeccion } from './TarjetaSeccion.js';

/** «Horas de trabajo»: la jornada del equipo, la opción personal de varias tareas y la capacidad semanal. */
export function SeccionHoras({ yo, horas }: { yo: Yo; horas: AjustesHoras | undefined }) {
  const actualizar = useActualizarCuenta();
  const guardarJornada = useGuardarAjustesHoras();
  const estadoVarias = useGuardado();
  return (
    <TarjetaSeccion clave="horas" titulo="Horas de trabajo" subtitulo="Con esto se miden tus horas y tu carga">
      {horas && (
        <CampoNumeroGuardable
          id="configuracion-jornada"
          etiqueta="Horas por día"
          ayuda="Jornada de lunes a viernes, de 1 a 12 horas: es el tope del cronómetro y la meta de Inicio. Vale para todo el equipo."
          valor={horas.jornadaHoras}
          minimo={1}
          maximo={12}
          paso={0.5}
          onGuardar={(jornadaHoras) => guardarJornada.mutateAsync({ jornadaHoras })}
        />
      )}
      <div className="guardable">
        <Interruptor
          etiqueta="Varias tareas a la vez"
          ayuda="Podés tener más de una tarea corriendo. Cada una suma todo el tiempo que estuvo en marcha; el día y el tope cuentan las horas de reloj."
          activo={yo.variasALaVez}
          deshabilitado={actualizar.isPending}
          onCambio={(variasALaVez) => void estadoVarias.guardar(() => actualizar.mutateAsync({ variasALaVez }))}
        />
        <ResultadoGuardado estado={estadoVarias} />
      </div>
      <CampoNumeroGuardable
        id="configuracion-capacidad"
        etiqueta="Capacidad semanal"
        ayuda="Horas por semana, de 1 a 80, de a media hora."
        valor={yo.capacidadHoras}
        minimo={1}
        maximo={80}
        paso={0.5}
        onGuardar={(capacidadHoras) => actualizar.mutateAsync({ capacidadHoras })}
      />
    </TarjetaSeccion>
  );
}
