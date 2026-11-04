// Geometría de los gráficos SVG: funciones puras, sin DOM.

/** Una vuelta completa se topa un pelo antes: un arco con el mismo inicio y fin no se dibuja. */
const VUELTA_MAXIMA = 359.99;

const redondear = (n: number): number => Math.round(n * 100) / 100;

function punto(cx: number, cy: number, r: number, grados: number): [number, number] {
  const rad = (grados * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

/**
 * Camino de un arco de circunferencia. Los ángulos van en grados: 0 son las 12 en punto y
 * crecen en sentido horario.
 */
export function arco(cx: number, cy: number, r: number, desde: number, hasta: number): string {
  const tramo = Math.min(Math.max(hasta - desde, 0), VUELTA_MAXIMA);
  const [x0, y0] = punto(cx, cy, r, desde);
  const [x1, y1] = punto(cx, cy, r, desde + tramo);
  const largo = tramo > 180 ? 1 : 0;
  return `M ${redondear(x0)} ${redondear(y0)} A ${r} ${r} 0 ${largo} 1 ${redondear(x1)} ${redondear(y1)}`;
}

/**
 * Curva suave por los puntos: cúbica monótona de Fritsch–Carlson. Entre dos puntos la curva nunca
 * sale del rango de sus ordenadas, así que con datos positivos no se hunde bajo cero ni pasa los máximos.
 */
export function caminoSuave(puntos: readonly [number, number][]): string {
  const n = puntos.length;
  if (n === 0) return '';
  const [x0, y0] = puntos[0]!;
  const inicio = `M ${redondear(x0)} ${redondear(y0)}`;
  if (n === 1) return inicio;

  const h = puntos.slice(1).map(([x], i) => x - puntos[i]![0]);
  const d = puntos.slice(1).map(([, y], i) => (y - puntos[i]![1]) / (h[i] || 1));
  const m: number[] = puntos.map((_, i) => {
    if (i === 0) return d[0]!;
    if (i === n - 1) return d[n - 2]!;
    return d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  });
  // Tangentes acotadas: ni un tramo plano ni una pendiente fuerte provocan rebases.
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const norma = a * a + b * b;
    if (norma > 9) {
      const tau = 3 / Math.sqrt(norma);
      m[i] = tau * a * d[i]!;
      m[i + 1] = tau * b * d[i]!;
    }
  }

  const tramos = puntos.slice(1).map(([x, y], i) => {
    const [xa, ya] = puntos[i]!;
    const t = h[i]! / 3;
    return `C ${redondear(xa + t)} ${redondear(ya + m[i]! * t)} ${redondear(x - t)} ${redondear(y - m[i + 1]! * t)} ${redondear(x)} ${redondear(y)}`;
  });
  return `${inicio} ${tramos.join(' ')}`;
}

const PASOS_LINDOS = [1, 2, 5, 10] as const;

/**
 * Escala de eje «linda»: el máximo se redondea a 1, 2 o 5 por una potencia de diez y se reparte en
 * `marcas` tramos iguales. Con máximo 0 (o negativo) devuelve 0 y 1.
 */
export function escalaLinda(maximo: number, marcas = 2): { maximo: number; marcas: number[] } {
  if (!(maximo > 0)) return { maximo: 1, marcas: [0, 1] };
  const exponente = Math.floor(Math.log10(maximo) + 1e-9);
  const potencia = 10 ** exponente;
  const base = PASOS_LINDOS.find((paso) => paso * potencia >= maximo - 1e-9) ?? 10;
  const tope = Number((base * potencia).toPrecision(12));
  const tramos = Math.max(1, Math.floor(marcas));
  return { maximo: tope, marcas: Array.from({ length: tramos + 1 }, (_, i) => Number(((tope * i) / tramos).toPrecision(12))) };
}

/**
 * Índices de los rótulos que se muestran cuando no entran todos: se anclan en el último y se salta
 * de a tantos como haga falta para no superar `maximo` rótulos.
 */
export function indicesRotulos(cantidad: number, maximo: number): number[] {
  if (cantidad <= 0) return [];
  const paso = Math.max(1, Math.ceil(cantidad / Math.max(1, maximo)));
  return Array.from({ length: cantidad }, (_, i) => i).filter((i) => (cantidad - 1 - i) % paso === 0);
}

const RADIO_BARRA_ARRIBA = 8;
const RADIO_BARRA_ABAJO = 3;

/** Barra vertical con esquinas de arriba más redondas que las de abajo (8 y 3 px, medido). */
export function barraRedondeada(x: number, y: number, ancho: number, alto: number): string {
  if (!(ancho > 0) || !(alto > 0)) return '';
  const abajo = Math.min(RADIO_BARRA_ABAJO, ancho / 2, alto / 2);
  const arriba = Math.min(RADIO_BARRA_ARRIBA, ancho / 2, alto - abajo);
  const [x1, y1] = [x + ancho, y + alto];
  const r = redondear;
  return [
    `M ${r(x)} ${r(y + arriba)}`,
    `A ${r(arriba)} ${r(arriba)} 0 0 1 ${r(x + arriba)} ${r(y)}`,
    `H ${r(x1 - arriba)}`,
    `A ${r(arriba)} ${r(arriba)} 0 0 1 ${r(x1)} ${r(y + arriba)}`,
    `V ${r(y1 - abajo)}`,
    `A ${r(abajo)} ${r(abajo)} 0 0 1 ${r(x1 - abajo)} ${r(y1)}`,
    `H ${r(x + abajo)}`,
    `A ${r(abajo)} ${r(abajo)} 0 0 1 ${r(x)} ${r(y1 - abajo)}`,
    'Z',
  ].join(' ');
}

const FORMATO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

/** Número en es-AR para los nombres accesibles y los globos: coma decimal, un decimal como mucho. */
export function numeroEs(valor: number): string {
  return FORMATO.format(valor);
}
