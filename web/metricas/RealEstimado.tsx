import { useState } from 'react';
import { duracionTexto } from '../../compartido/horas.js';
import { Segmentado } from '../ui/Segmentado.js';
import { Vidrio } from '../ui/Vidrio.js';
import type { FilaRealEstimado, Metricas } from './logica.js';

type Agrupar = 'persona' | 'proyecto';

const OPCIONES: { valor: Agrupar; etiqueta: string }[] = [
  { valor: 'persona', etiqueta: 'Por persona' },
  { valor: 'proyecto', etiqueta: 'Por proyecto' },
];

const SEG_HORA = 3600;

/** «×1,17»: el cociente con hasta dos decimales y coma. */
export const cocienteTexto = (cociente: number): string => `×${cociente.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

const horasTexto = (horas: number): string => duracionTexto(horas * SEG_HORA);

export interface RealEstimadoProps {
  datos: Metricas['realEstimado'];
  nombrePersona(id: number): string;
  nombreProyecto(id: number): string;
}

/** Barras horizontales (sin estirar un SVG, así las puntas quedan redondas): arriba lo estimado, abajo lo trabajado (ámbar si se pasó). */
export function RealEstimado({ datos, nombrePersona, nombreProyecto }: RealEstimadoProps) {
  const [agrupar, setAgrupar] = useState<Agrupar>('persona');
  const filas: FilaRealEstimado[] = agrupar === 'persona' ? datos.porPersona : datos.porProyecto;
  const nombre = agrupar === 'persona' ? nombrePersona : nombreProyecto;
  const mayor = Math.max(0, ...filas.flatMap((f) => [f.real, f.estimado]));
  // Porcentaje del ancho disponible; una barra con horas nunca desaparece del todo.
  const ancho = (horas: number): string => (mayor > 0 && horas > 0 ? `max(${(horas / mayor) * 100}%, 2px)` : '0');

  return (
    <Vidrio as="section" className="metricas__tarjeta metricas__real" aria-labelledby="metricas-real">
      <header className="metricas__cabeza">
        <div>
          <h2 id="metricas-real" className="tarjeta__titulo">Trabajado contra estimado</h2>
          <p className="tarjeta__sub">Tareas cerradas del período, con horas estimadas y trabajadas</p>
        </div>
        <Segmentado etiqueta="Agrupar" tamano="chico" opciones={OPCIONES} valor={agrupar} onCambio={setAgrupar} />
      </header>
      {filas.length === 0 ? (
        <p className="metricas__vacio">Ninguna tarea cerrada del período tiene horas estimadas y trabajadas.</p>
      ) : (
        <>
          <p className="metricas__leyenda real-estimado__leyenda">
            <span><i className="real-estimado__muestra real-estimado__estimado" aria-hidden="true" />Estimado</span>
            <span><i className="real-estimado__muestra real-estimado__real" aria-hidden="true" />Trabajado</span>
            <span><i className="real-estimado__muestra real-estimado__real" data-pasado="true" aria-hidden="true" />Se pasó</span>
            <span>× = trabajado ÷ estimado</span>
          </p>
          <ul className="real-estimado">
            {filas.map((f) => {
              const descripcion = `${nombre(f.id)}: ${horasTexto(f.real)} trabajadas de ${horasTexto(f.estimado)} estimadas, ${cocienteTexto(f.cociente)}`;
              return (
                <li key={f.id} className="real-estimado__fila">
                  <span className="real-estimado__nombre">{nombre(f.id)}</span>
                  <span className="real-estimado__grafico" role="img" aria-label={descripcion}>
                    <span className="real-estimado__barra real-estimado__estimado" style={{ width: ancho(f.estimado) }} />
                    <span
                      className="real-estimado__barra real-estimado__real" style={{ width: ancho(f.real) }}
                      data-pasado={f.real > f.estimado ? 'true' : undefined}
                    />
                  </span>
                  <b className="real-estimado__cociente tnum" data-pasado={f.real > f.estimado ? 'true' : undefined}>{cocienteTexto(f.cociente)}</b>
                  <small className="real-estimado__detalle tnum">{`${horasTexto(f.real)} de ${horasTexto(f.estimado)}`}</small>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Vidrio>
  );
}
