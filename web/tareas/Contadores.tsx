import { Contador } from '../ui/Contador.js';
import type { Contadores as Cuentas } from './logica.js';

const SIN_DATO = '–';

/** Abiertas, Vencen esta semana, Vencidas y Cerradas esta semana; guiones mientras carga. */
export function Contadores({ cuentas }: { cuentas: Cuentas | null }) {
  return (
    <div className="contadores" role="group" aria-label="Resumen de tareas">
      <Contador etiqueta="Abiertas" valor={cuentas?.abiertas ?? SIN_DATO} />
      <Contador etiqueta="Vencen esta semana" valor={cuentas?.vencenSemana ?? SIN_DATO} />
      <Contador etiqueta="Vencidas" valor={cuentas?.vencidas ?? SIN_DATO} />
      <Contador etiqueta="Cerradas esta semana" valor={cuentas?.cerradasSemana ?? SIN_DATO} />
    </div>
  );
}
