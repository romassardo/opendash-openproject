import type { AjustesMetricas } from '../../compartido/tipos.js';
import { useGuardarAjustesMetricas } from '../api/mutaciones.js';
import { CampoNumeroGuardable } from './CampoGuardable.js';
import { Interruptor } from '../ui/Interruptor.js';
import { NotaEquipo, ResultadoGuardado, useGuardado } from './guardado.js';
import { TarjetaSeccion } from './TarjetaSeccion.js';

interface CampoMetrica {
  clave: Exclude<keyof AjustesMetricas, 'restarReuniones'>;
  etiqueta: string;
  ayuda: string;
}

const CAMPOS: readonly CampoMetrica[] = [
  { clave: 'horasPorDefecto', etiqueta: 'Horas para tareas sin estimación', ayuda: 'Horas que se cuentan por cada tarea sin estimar.' },
  {
    clave: 'horasSemanaLargas',
    etiqueta: 'Horas por semana para tareas largas sin estimación',
    ayuda: 'Horas por semana que se reparten en las tareas largas sin estimar.',
  },
  {
    clave: 'capacidadPorDefecto',
    etiqueta: 'Capacidad semanal de quien no usa OpenDash',
    ayuda: 'Horas por semana que se suponen para quien no tiene cuenta.',
  },
];

export function SeccionMetricas({ metricas }: { metricas: AjustesMetricas }) {
  const guardar = useGuardarAjustesMetricas();
  const estadoReuniones = useGuardado();
  return (
    <TarjetaSeccion clave="metricas" titulo="Métricas" subtitulo="Valores que se usan cuando faltan datos">
      <NotaEquipo>Estos ajustes son del equipo: se ven igual para todos.</NotaEquipo>
      <div className="guardable">
        <Interruptor
          etiqueta="Restar las reuniones de la capacidad"
          ayuda="Descuenta de cada persona las horas de reunión de su calendario. Los feriados y las vacaciones se descuentan siempre."
          activo={metricas.restarReuniones}
          deshabilitado={guardar.isPending}
          onCambio={(restarReuniones) => void estadoReuniones.guardar(() => guardar.mutateAsync({ ...metricas, restarReuniones }))}
        />
        <ResultadoGuardado estado={estadoReuniones} />
      </div>
      {CAMPOS.map(({ clave, etiqueta, ayuda }) => (
        <CampoNumeroGuardable
          key={clave}
          id={`configuracion-metricas-${clave}`}
          etiqueta={etiqueta}
          ayuda={ayuda}
          valor={metricas[clave]}
          minimo={0.25}
          maximo={80}
          paso={0.25}
          onGuardar={(horas) => guardar.mutateAsync({ ...metricas, [clave]: horas })}
        />
      ))}
    </TarjetaSeccion>
  );
}
