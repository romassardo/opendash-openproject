import { Link2 } from 'lucide-react';
import type { Partes } from '../../compartido/pausas.js';
import type { Tarea } from '../../compartido/tipos.js';
import { diaMesCorto, diasEntre } from '../fechas.js';
import { unir } from '../ui/clases.js';
import type { FechasBarra } from './arrastre.js';
import type { EdicionFechas } from './escrituras.js';
import type { BarraFila } from './filas.js';
import type { Horas } from './horas.js';
import { ETIQUETA_ESTADO, rangoDe } from './InfoCadena.js';
import { ANCHO_PARA_ESTIRAR, anchoVisual, entranHoras, SEPARACION_HORAS } from './medidas.js';
import type { Ventana } from './modelo.js';
import { huecosDeBarra, mascaraDeHuecos, textoPausas } from './pausasLinea.js';
import { useGestoBarra } from './useGestoBarra.js';
import type { PointerHandlers } from './useUnir.js';

export interface BarraTareaProps {
  tarea: Tarea;
  barra: BarraFila;
  /** `barra` es la de una tarea; `resumen`, la de una madre automática (solo se ve y se abre). */
  modo?: 'barra' | 'resumen';
  /** Horas («~5 h», «2 h / ~5 h» o «3 h ✓»); `null` si no hay. */
  horas: Horas | null;
  /** Fracción de hijas cerradas (0 a 1), para rellenar la barra de resumen. */
  avance?: number;
  /** `null` sin foco en la línea; si no, si la barra pertenece a la cadena enfocada. */
  enCadena: boolean | null;
  alEnfocar: (id: number | null) => void;
  alAbrir: (id: number) => void;
  /** Para pasar de píxeles a días al arrastrar y dibujar la barra fantasma. */
  ventana: Pick<Ventana, 'desde' | 'pxPorDia'>;
  /** Con ella y con `arrastrable`, la barra se mueve y se estira. */
  edicion?: EdicionFechas;
  arrastrable: boolean;
  /** Título de la primera predecesora, si la tarea abierta va sola detrás de otra. */
  espera: string | null;
  vencida?: boolean;
  /** Manejadores del puntito para unir; sin ellos no se dibuja. */
  unir?: PointerHandlers;
  /** Tramos de trabajo y pausas, si la tarea tiene pausas: la barra se corta en cada una. */
  pausas?: Partes | null;
}

export const textoEspera = (titulo: string): string => `Va sola detrás de «${titulo}»`;

/** Rótulo de la barra fantasma: «20 oct → 3 nov» (o un solo día). */
function rotuloDe({ inicio, fin }: { inicio: string; fin: string }): string {
  return inicio === fin ? diaMesCorto(inicio) : `${diaMesCorto(inicio)} → ${diaMesCorto(fin)}`;
}

/** Fechas de la vista previa como las dibuja la barra: una tarea con una sola fecha ocupa ese día. */
function efectivas(fechas: FechasBarra): { inicio: string; fin: string } {
  return { inicio: (fechas.inicio ?? fechas.fin)!, fin: (fechas.fin ?? fechas.inicio)! };
}

function etiquetaDe(tarea: Tarea, barra: BarraFila, enPausa: string | null): string {
  const inicio = tarea.inicio ?? tarea.fin!;
  const fin = tarea.fin ?? tarea.inicio!;
  return `${tarea.titulo}, ${ETIQUETA_ESTADO[barra.columna]}, del ${diaMesCorto(inicio)} al ${diaMesCorto(fin)}${enPausa ? `, ${enPausa}` : ''}${barra.conflicto ? ', en conflicto' : ''}`;
}

/** La barra (o el rombo del hito) de una tarea sobre su renglón: sin título, que ya está en la lista. */
export function BarraTarea({
  tarea, barra, modo = 'barra', horas, avance = 0, enCadena, alEnfocar, alAbrir, ventana, edicion, arrastrable: sePuedeArrastrar, espera, vencida = false, unir: manejadoresUnir,
  pausas = null,
}: BarraTareaProps) {
  const resumen = modo === 'resumen';
  const hito = barra.esHito && !resumen;
  // Las barras muy cortas solo se mueven: no hay lugar para los bordes de estirar.
  const estirable = !hito && !resumen && anchoVisual(barra.ancho) >= ANCHO_PARA_ESTIRAR;
  const editable = sePuedeArrastrar && !resumen && edicion !== undefined;
  const gesto = useGestoBarra({ tarea, esHito: hito, edicion: editable ? edicion : undefined, estirable, pxPorDia: ventana.pxPorDia, alAbrir });
  const ancho = anchoVisual(barra.ancho);
  const textoDeEspera = espera === null ? null : textoEspera(espera);
  const enPausa = resumen || hito ? null : textoPausas(pausas);
  const comun = {
    type: 'button' as const,
    'data-tarea-id': tarea.id,
    'data-entra-barra': '',
    'data-en-cadena': enCadena === null ? undefined : String(enCadena),
    'aria-label': etiquetaDe(tarea, barra, enPausa),
    ...(textoDeEspera !== null && { 'aria-description': textoDeEspera }),
    ...gesto.manejadores,
    onMouseEnter: () => alEnfocar(tarea.id),
    onMouseLeave: () => alEnfocar(null),
    onFocus: () => alEnfocar(tarea.id),
    onBlur: () => {
      gesto.descartar();
      alEnfocar(null);
    },
  };
  const fantasma = () => {
    if (!gesto.previa) return null;
    const { inicio, fin } = efectivas(gesto.previa);
    const izquierda = diasEntre(ventana.desde, inicio) * ventana.pxPorDia;
    const largo = (diasEntre(inicio, fin) + 1) * ventana.pxPorDia;
    return (
      <span className="barra__fantasma" role="status" style={{ left: izquierda, width: largo }}>
        <span className="barra__fantasma-rotulo" style={{ left: Math.max(0, -izquierda) }}>{rotuloDe({ inicio, fin })}</span>
      </span>
    );
  };

  const puntito = (izquierda: number) => manejadoresUnir && (
    <span className="barra__unir" data-unir={tarea.id} aria-hidden="true" style={{ left: izquierda }} {...manejadoresUnir} />
  );

  if (hito) {
    const centro = barra.x + barra.ancho / 2;
    return (
      <>
        <button {...comun} className={unir('hito', editable && 'arrastrable', vencida && 'hito--vencida')} style={{ left: centro - 8 }} title={textoDeEspera ?? undefined}>
          <b data-rombo className="hito__rombo" />
        </button>
        {fantasma()}
        {puntito(centro + 8)}
      </>
    );
  }

  const adentro = horas !== null && !resumen && entranHoras(ancho, horas.texto);
  // Una pausa corta la barra: la máscara vuelve transparente el hueco y encima va la línea de puntos.
  const huecos = enPausa === null || pausas === null || tarea.fin === null ? [] : huecosDeBarra(pausas, tarea.fin, ventana, { x: barra.x, ancho });
  const mascara = mascaraDeHuecos(huecos);
  const clases = unir(
    'barra', resumen ? 'barra--resumen' : `barra--${barra.columna}`,
    barra.sinInicio && 'barra--sin-inicio', barra.sinFin && 'barra--sin-fin',
    barra.empiezaAntes && 'barra--corta-izq', barra.sigueHasta && 'barra--corta-der',
    editable && 'arrastrable', vencida && 'barra--vencida', huecos.length > 0 && 'barra--pausada',
  );
  const bordes = editable && estirable && (
    <>
      {!barra.empiezaAntes && <i className="barra__borde barra__borde--inicio" data-gesto="inicio" aria-hidden="true" />}
      {!barra.sigueHasta && <i className="barra__borde barra__borde--fin" data-gesto="fin" aria-hidden="true" />}
    </>
  );
  return (
    <>
      <button
        {...comun}
        className={clases}
        style={{ left: barra.x, width: ancho, ...(mascara && { maskImage: mascara, WebkitMaskImage: mascara }) }}
        title={textoDeEspera ?? `${tarea.titulo} · ${rangoDe(tarea)}${enPausa ? ` · ${enPausa}` : ''}`}
      >
        {resumen && <i className="barra__relleno" style={{ width: `${Math.round(avance * 100)}%` }} aria-hidden="true" />}
        {bordes}
        {barra.empiezaAntes && <i className="barra__muesca" aria-hidden="true" />}
        {textoDeEspera !== null && <Link2 className="barra__eslabon" size={13} aria-hidden="true" />}
        {adentro && <span className={unir('barra__horas', horas.pasada && 'barra__horas--pasada')} title={horas.descripcion}>{horas.texto}</span>}
        {barra.sigueHasta && <span className="barra__sigue">sigue hasta {diaMesCorto(barra.sigueHasta)}</span>}
      </button>
      {huecos.map((h) => (
        <i key={h.izquierda} className="barra__hueco" data-hueco-de={tarea.id} aria-hidden="true" style={{ left: barra.x + h.izquierda, width: h.ancho }} />
      ))}
      {fantasma()}
      {puntito(barra.x + ancho - 1)}
      {horas !== null && !resumen && !adentro && (
        <span className={unir('barra__horas barra__horas--afuera', horas.pasada && 'barra__horas--pasada')} style={{ left: barra.x + ancho + SEPARACION_HORAS }}>{horas.texto}</span>
      )}
    </>
  );
}
