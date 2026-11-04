import { unir } from './clases.js';

export interface VariacionProps {
  /** Cambio respecto del período anterior; `null` si no hay con qué comparar. */
  valor: number | null;
  unidad: '%' | 'pts' | 'd' | 'h';
  /** Para métricas donde bajar es lo bueno (días de demora, horas de atraso): invierte los colores. */
  mejorSiBaja?: boolean;
}

type Sentido = 'sube' | 'baja' | 'neutro';

const MENOS = '−';

// Porcentajes enteros; días, horas y puntos con un decimal (spec §12.5).
function decimalesDe(unidad: VariacionProps['unidad']): number {
  return unidad === '%' ? 0 : 1;
}

function formatear(valor: number, unidad: VariacionProps['unidad']): string {
  const absoluto = new Intl.NumberFormat('es-AR', { maximumFractionDigits: decimalesDe(unidad) }).format(Math.abs(valor));
  return `${valor > 0 ? '+' : MENOS}${absoluto} ${unidad}`;
}

function sentidoDe(valor: number, unidad: VariacionProps['unidad'], mejorSiBaja: boolean): Sentido {
  const factor = 10 ** decimalesDe(unidad);
  if (Math.round(Math.abs(valor) * factor) === 0) return 'neutro';
  const bueno = mejorSiBaja ? valor < 0 : valor > 0;
  return bueno ? 'sube' : 'baja';
}

export function Variacion({ valor, unidad, mejorSiBaja = false }: VariacionProps) {
  if (valor === null) {
    return <span className="variacion variacion--neutro" data-sentido="neutro" aria-label="Sin dato para comparar">—</span>;
  }
  const sentido = sentidoDe(valor, unidad, mejorSiBaja);
  // Un cambio que redondea a cero no lleva signo («−0 %» confunde).
  const texto = sentido === 'neutro' ? `0 ${unidad}` : formatear(valor, unidad);
  return (
    <span className={unir('variacion', `variacion--${sentido}`, 'tnum')} data-sentido={sentido}>
      {texto}
    </span>
  );
}
