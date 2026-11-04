export interface Punto { x: number; y: number }

const RADIO = 7;
const HUECO_CURVA = 40;
const HUECO_CODO = 18;
const SALIDA_ESCALON = 10;
const ENTRADA_ESCALON = 12;

const num = (n: number): number => Math.round(n * 100) / 100;
const fmt = (p: Punto): string => `${num(p.x)},${num(p.y)}`;

/** Curva cúbica horizontal tipo n8n: sale hacia la derecha y entra por la izquierda. */
export function trazoLibre(sale: Punto, entra: Punto): string {
  const k = Math.max(28, Math.abs(entra.x - sale.x) / 2);
  return `M${fmt(sale)} C${fmt({ x: sale.x + k, y: sale.y })} ${fmt({ x: entra.x - k, y: entra.y })} ${fmt(entra)}`;
}

/** Recorre los puntos con rectas y esquinas redondeadas (`Q`) de hasta `RADIO` píxeles. */
function redondeado(puntos: readonly Punto[]): string {
  let d = `M${fmt(puntos[0]!)}`;
  for (let i = 1; i < puntos.length - 1; i++) {
    const a = puntos[i - 1]!;
    const v = puntos[i]!;
    const b = puntos[i + 1]!;
    const la = Math.hypot(v.x - a.x, v.y - a.y);
    const lb = Math.hypot(b.x - v.x, b.y - v.y);
    const r = Math.min(RADIO, la / 2, lb / 2);
    if (r <= 0) { d += ` L${fmt(v)}`; continue; }
    const antes = { x: v.x + ((a.x - v.x) / la) * r, y: v.y + ((a.y - v.y) / la) * r };
    const despues = { x: v.x + ((b.x - v.x) / lb) * r, y: v.y + ((b.y - v.y) / lb) * r };
    d += ` L${fmt(antes)} Q${fmt(v)} ${fmt(despues)}`;
  }
  return `${d} L${fmt(puntos[puntos.length - 1]!)}`;
}

/** Flecha de una unión: curva si hay lugar, codo redondeado si hay poco y escalón si casi no hay. */
export function trazoUnion(sale: Punto, entra: Punto, altoRenglon: number): string {
  const hueco = entra.x - sale.x;
  if (hueco >= HUECO_CURVA) return trazoLibre(sale, entra);
  if (hueco >= HUECO_CODO) {
    const medio = sale.x + hueco / 2;
    return redondeado([sale, { x: medio, y: sale.y }, { x: medio, y: entra.y }, entra]);
  }
  const borde = entra.y + (entra.y >= sale.y ? -altoRenglon / 2 : altoRenglon / 2);
  const x1 = sale.x + SALIDA_ESCALON;
  const x2 = entra.x - ENTRADA_ESCALON;
  return redondeado([sale, { x: x1, y: sale.y }, { x: x1, y: borde }, { x: x2, y: borde }, { x: x2, y: entra.y }, entra]);
}

export function puntoMedio(sale: Punto, entra: Punto): Punto {
  return { x: (sale.x + entra.x) / 2, y: (sale.y + entra.y) / 2 };
}
