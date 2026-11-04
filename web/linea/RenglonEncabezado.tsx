import type { CSSProperties } from 'react';
import { Plus } from 'lucide-react';
import type { Fila } from './filas.js';
import type { ContextoLinea } from './contextoLinea.js';
import { Avatar } from '../ui/Avatar.js';
import { unir } from '../ui/clases.js';
import { ALTO_ENCABEZADO, ANCHO_LISTA } from './medidas.js';
import { Rayas } from './Rayas.js';

type FilaEncabezado = Extract<Fila, { tipo: 'encabezado' }>;

/** El «+» de un renglón: abre el alta de una tarea ahí. Se ve al pasar el mouse o al llegar con el teclado. */
export function BotonMas({ etiqueta, alTocar }: { etiqueta: string; alTocar: () => void }) {
  return (
    <button type="button" className="renglon__mas" aria-label={etiqueta} title={etiqueta} onClick={alTocar}>
      <Plus size={15} aria-hidden="true" />
    </button>
  );
}

/** Franja de una persona o un proyecto. En Por persona lleva las rayas de sus vacaciones; en Por proyecto, el tinte del proyecto. */
export function RenglonEncabezado({ fila, ctx, ancho }: { fila: FilaEncabezado; ctx: ContextoLinea; ancho: number }) {
  const persona = fila.personaId === null ? null : (ctx.personas.get(fila.personaId) ?? null);
  const conTinte = fila.proyectoId !== null && fila.tono !== null;
  const estilo = { height: ALTO_ENCABEZADO, gridTemplateColumns: `${ANCHO_LISTA}px ${ancho}px`, ...(conTinte ? { '--tono-fila': `var(--tono-${fila.tono})` } : {}) } as CSSProperties;
  return (
    <div className={unir('renglon renglon--encabezado', conTinte && 'renglon--tinte')} style={estilo}>
      <div className="renglon__lista">
        {persona
          ? <Avatar persona={persona} tamano={26} />
          : conTinte
            ? <i className="renglon__cuadro" aria-hidden="true" />
            : <i className={unir('carril__punto', !fila.tono && 'carril__punto--neutro')} style={fila.tono ? { background: `var(--tono-${fila.tono})` } : undefined} aria-hidden="true" />}
        <b className="renglon__titulo">{fila.titulo}</b>
        {fila.esYo && <span className="renglon__vos">vos</span>}
        <small className="renglon__resumen">{fila.resumen}</small>
        {fila.proyectoId !== null && ctx.alCrear && <BotonMas etiqueta={`Nueva tarea en «${fila.titulo}»`} alTocar={() => ctx.alCrear?.(fila.proyectoId!, null)} />}
      </div>
      <div className="renglon__pista">
        {fila.personaId !== null && <Rayas tramos={ctx.vacaciones.get(fila.personaId)} ventana={ctx.ventana} />}
      </div>
    </div>
  );
}
