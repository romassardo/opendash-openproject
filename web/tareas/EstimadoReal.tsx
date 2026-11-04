import type { Tarea } from '../../compartido/tipos.js';
import { conHoras, horasTexto } from '../linea/horas.js';
import { unir } from '../ui/clases.js';

/**
 * Las horas de la tarea en el detalle, con los mismos nombres en toda la app: «Estimado» (el «Trabajo» de OpenProject)
 * y «Trabajado» (su «Tiempo empleado», lo que carga el cronómetro). Con las dos, una barra de cuánto de lo estimado ya
 * se trabajó, en rojo si se pasó.
 */
export function EstimadoReal({ tarea }: { tarea: Tarea }) {
  const estimado = conHoras(tarea.estimacionHoras);
  const trabajado = conHoras(tarea.horasReales);
  const porcentaje = estimado !== null && trabajado !== null ? Math.round((trabajado / estimado) * 100) : null;
  const pasado = estimado !== null && trabajado !== null && trabajado > estimado;

  return (
    <div className="estimado-real" role="group" aria-label="Horas de la tarea">
      <dl className="estimado-real__datos">
        <div className="estimado-real__dato">
          <dt>Estimado</dt>
          <dd className="tnum">{estimado === null ? 'Sin estimar' : horasTexto(estimado)}</dd>
        </div>
        <div className="estimado-real__dato">
          <dt>Trabajado</dt>
          <dd className={unir('tnum', pasado && 'estimado-real__pasado')}>
            {trabajado === null ? 'Nada todavía' : horasTexto(trabajado)}
            {porcentaje !== null && <span className="estimado-real__porcentaje">{` · ${porcentaje} %`}</span>}
          </dd>
        </div>
      </dl>
      {estimado !== null && (
        <span className="estimado-real__barra" aria-hidden="true">
          <span
            className={unir('estimado-real__relleno', pasado && 'estimado-real__relleno--pasado')}
            style={{ width: `${Math.min(100, porcentaje ?? 0)}%` }}
          />
        </span>
      )}
    </div>
  );
}
