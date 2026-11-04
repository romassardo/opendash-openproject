import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { columnaDeTarea } from '../tareas/logica.js';
import { BarraTarea } from './BarraTarea.js';
import type { ContextoLinea } from './contextoLinea.js';
import type { Fila } from './filas.js';
import { ALTO_RENGLON, ANCHO_LISTA } from './medidas.js';
import { MarcadorPersona } from './MarcadorPersona.js';
import { Rayas } from './Rayas.js';
import { BotonMas } from './RenglonEncabezado.js';
import { estaVencida, estiloDesplazado, estiloTono, Sangria } from './RenglonTarea.js';
import { Avatar } from '../ui/Avatar.js';
import { unir } from '../ui/clases.js';

type FilaGrupo = Extract<Fila, { tipo: 'grupo' }>;

/** La cara de quien tiene la summary task ajena, o un círculo punteado si no la tiene nadie. */
function DuenoAjeno({ tarea, ctx }: { tarea: FilaGrupo['tarea']; ctx: ContextoLinea }) {
  const dueno = tarea.responsableId === null ? null : (ctx.personas.get(tarea.responsableId) ?? null);
  return dueno ? <Avatar persona={dueno} tamano={20} /> : <span className="renglon__sin-dueno" role="img" aria-label="Sin asignar" />;
}

/** Una madre con hijas: ▾/▸ para plegarla, su avance y, a la derecha, su barra (de resumen si es automática). */
export function RenglonGrupo({ fila, ctx, ancho }: { fila: FilaGrupo; ctx: ContextoLinea; ancho: number }) {
  const { tarea, barra, avance } = fila;
  const cerrada = columnaDeTarea(tarea, ctx.catalogo) === 'cerrado';
  const automatica = !tarea.programacionManual;
  const predecesora = ctx.predecesoraDe.get(tarea.id);
  const enCadena = ctx.enfoque === null ? null : ctx.enfoque.has(tarea.id);
  const espera = !cerrada && predecesora !== undefined ? (ctx.porId.get(predecesora)?.titulo ?? null) : null;
  return (
    <div className={unir('renglon renglon--grupo', fila.ajena && 'renglon--ajeno', ctx.ordenar?.levantada === fila.clave && 'renglon--levantado')} data-renglon={tarea.id} data-renglon-tarea={tarea.id} data-destino={ctx.destinoUnir?.id === tarea.id ? (ctx.destinoUnir.vale ? 'si' : 'no') : undefined} style={{ height: ALTO_RENGLON, gridTemplateColumns: `${ANCHO_LISTA}px ${ancho}px`, ...estiloTono(ctx, tarea.proyectoId), ...estiloDesplazado(ctx, fila.clave) }}>
      <div className="renglon__lista" data-en-cadena={enCadena === null ? undefined : String(enCadena)}>
        {fila.contenedor !== null && ctx.ordenar !== undefined && (
          <button type="button" className="renglon__orden" aria-label={`Ordenar «${tarea.titulo}»`} data-orden={tarea.id} {...ctx.ordenar.manejadores(fila)}>
            <GripVertical size={14} aria-hidden="true" />
          </button>
        )}
        <Sangria nivel={fila.nivel} />
        <button
          type="button"
          className="renglon__plegar"
          aria-expanded={fila.abierto}
          aria-label={`${fila.abierto ? 'Plegar' : 'Desplegar'} «${tarea.titulo}»`}
          onClick={() => ctx.alternarGrupo(tarea.id)}
        >
          {fila.abierto ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </button>
        <MarcadorPersona tarea={tarea} ctx={ctx} />
        <button type="button" className="renglon__nombre renglon__nombre--grupo" aria-label={`Abrir «${tarea.titulo}»`} title={tarea.titulo} onClick={() => ctx.alAbrir(tarea.id)}>
          {cerrada && '✓ '}{tarea.titulo}
        </button>
        {fila.ajena && <DuenoAjeno tarea={tarea} ctx={ctx} />}
        <span className="renglon__avance">{avance.hechas}/{avance.total}</span>
        {!cerrada && !fila.ajena && !ctx.porPersona && ctx.alCrear && (
          <BotonMas etiqueta={`Nueva subtarea en «${tarea.titulo}»`} alTocar={() => ctx.alCrear?.(tarea.proyectoId, tarea.id)} />
        )}
      </div>
      <div className="renglon__pista">
        {!cerrada && !ctx.porPersona && tarea.responsableId !== null && <Rayas tramos={ctx.vacaciones.get(tarea.responsableId)} ventana={ctx.ventana} />}
        {barra !== null && (
          <BarraTarea
            tarea={tarea}
            barra={barra}
            modo={automatica ? 'resumen' : 'barra'}
            horas={null}
            avance={avance.total === 0 ? 0 : avance.hechas / avance.total}
            enCadena={enCadena}
            alEnfocar={ctx.alEnfocar}
            alAbrir={ctx.alAbrir}
            ventana={ctx.ventana}
            edicion={ctx.cambios}
            unir={cerrada ? undefined : ctx.unirManejadores?.(tarea.id)}
            arrastrable={!cerrada && !automatica && predecesora === undefined}
            espera={espera}
            vencida={estaVencida(tarea, ctx.catalogo, ctx.hoy)}
            pausas={automatica ? null : ctx.partesDe(tarea)}
          />
        )}
      </div>
    </div>
  );
}
