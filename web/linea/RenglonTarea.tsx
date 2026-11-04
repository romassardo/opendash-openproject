import { GripVertical } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Catalogo, Tarea } from '../../compartido/tipos.js';
import { diaMesCorto } from '../fechas.js';
import { vencida } from '../tareas/logica.js';
import { unir } from '../ui/clases.js';
import { tramoQuePisa, textoVacaciones } from './ausencias.js';
import { BarraTarea } from './BarraTarea.js';
import type { ContextoLinea } from './contextoLinea.js';
import type { Fila } from './filas.js';
import { horasDeBarra } from './horas.js';
import { ALTO_RENGLON, ANCHO_LISTA, SANGRIA } from './medidas.js';
import { MarcadorPersona } from './MarcadorPersona.js';
import { Rayas } from './Rayas.js';

type FilaTarea = Extract<Fila, { tipo: 'tarea' }>;

/** Terminada que cae entera fuera de la ventana: una marca en ese borde con su fecha, que lleva la ventana hasta ella. */
function MarcaFuera({ fuera, ctx }: { fuera: NonNullable<FilaTarea['barra']['fuera']>; ctx: ContextoLinea }) {
  const dia = diaMesCorto(fuera.fecha);
  const texto = fuera.lado === 'antes' ? `◂ terminó el ${dia}` : `empieza el ${dia} ▸`;
  const clase = unir('renglon__fuera', `renglon__fuera--${fuera.lado}`);
  const { irAFecha } = ctx;
  if (!irAFecha) return <span className={clase}>{texto}</span>;
  return <button type="button" className={clase} title="Llevar la línea hasta esta tarea" onClick={() => irAFecha(fuera.fecha)}>{texto}</button>;
}

/** ¿Está vencida? Es la regla única de `vencida`. */
export const estaVencida = (tarea: Tarea, catalogo: Catalogo, hoy: string): boolean => vencida(tarea, hoy, catalogo);

/** Aviso del renglón cuando la persona se va de vacaciones en medio de la tarea abierta. */
export function avisoVacaciones(tarea: Tarea, cerrada: boolean, ctx: ContextoLinea): string | null {
  if (cerrada || tarea.responsableId === null) return null;
  const tramo = tramoQuePisa(tarea, ctx.vacaciones.get(tarea.responsableId));
  const persona = ctx.personas.get(tarea.responsableId);
  return tramo === null ? null : textoVacaciones(persona?.nombre ?? `Persona ${tarea.responsableId}`, tramo);
}

/** Corrimiento del renglón mientras se ordena la lista (vacío si no se mueve). */
export function estiloDesplazado(ctx: ContextoLinea, clave: string): CSSProperties {
  const dy = ctx.ordenar?.desplazamientos.get(clave);
  return dy === undefined ? {} : { transform: `translateY(${dy}px)` };
}

/** Tono del proyecto para la línea guía de los niveles. */
export const estiloTono = (ctx: ContextoLinea, proyectoId: number): CSSProperties => (
  { '--tono-fila': `var(--tono-${ctx.tonoDeProyecto(proyectoId)})` } as CSSProperties
);

/** Sangría del renglón; con nivel 1 o más dibuja la línea guía de 2 px, 12 px antes del contenido. */
export function Sangria({ nivel }: { nivel: number }) {
  return (
    <span className="renglon__sangria" style={{ width: nivel * SANGRIA }} aria-hidden="true">
      {nivel >= 1 && <i className="renglon__guia" />}
    </span>
  );
}

/** El «!» de una tarea que se pisa con su anterior: con edición es un botón que la corre detrás. */
function AlertaPisada({ tarea, ctx }: { tarea: Tarea; ctx: ContextoLinea }) {
  const anterior = ctx.anteriorEnConflicto.get(tarea.id);
  const cambios = ctx.cambios;
  if (cambios === undefined) {
    return <span className="renglon__alerta" title="Sus fechas se pisan con las de la tarea que espera">!</span>;
  }
  const texto = anterior === undefined
    ? 'Sus fechas se pisan con las de la tarea que espera. Clic para correrla detrás.'
    : `Empieza antes de que termine «${anterior}». Clic para correrla detrás.`;
  return (
    <button type="button" className="renglon__alerta renglon__alerta--boton" title={texto} aria-label={texto} disabled={cambios.ocupado} onClick={() => void cambios.correrDetras(tarea.id)}>!</button>
  );
}

/** Una tarea: su nombre a la izquierda (fijo) y su barra a la derecha. */
export function RenglonTarea({ fila, ctx, ancho }: { fila: FilaTarea; ctx: ContextoLinea; ancho: number }) {
  const { tarea, barra } = fila;
  const cerrada = barra.columna === 'cerrado';
  const predecesora = ctx.predecesoraDe.get(tarea.id);
  const espera = !cerrada && predecesora !== undefined ? (ctx.porId.get(predecesora)?.titulo ?? null) : null;
  const vacaciones = avisoVacaciones(tarea, cerrada, ctx);
  const enCadena = ctx.enfoque === null ? null : ctx.enfoque.has(tarea.id);
  // Se arrastra solo si está abierta, no espera a otra y no es una madre automática (sus fechas las calcula OpenProject).
  const madreAutomatica = !tarea.programacionManual && ctx.conHijas.has(tarea.id);
  const arrastrable = !cerrada && predecesora === undefined && !madreAutomatica;
  return (
    <div className={unir('renglon', ctx.ordenar?.levantada === fila.clave && 'renglon--levantado')} data-renglon={tarea.id} data-renglon-tarea={tarea.id} data-recien={ctx.recien === tarea.id ? '' : undefined} data-destino={ctx.destinoUnir?.id === tarea.id ? (ctx.destinoUnir.vale ? 'si' : 'no') : undefined} style={{ height: ALTO_RENGLON, gridTemplateColumns: `${ANCHO_LISTA}px ${ancho}px`, ...estiloTono(ctx, tarea.proyectoId), ...estiloDesplazado(ctx, fila.clave) }}>
      <div className="renglon__lista" data-en-cadena={enCadena === null ? undefined : String(enCadena)}>
        {fila.contenedor !== null && ctx.ordenar !== undefined && (
          <button type="button" className="renglon__orden" aria-label={`Ordenar «${tarea.titulo}»`} data-orden={tarea.id} {...ctx.ordenar?.manejadores(fila)}>
            <GripVertical size={14} aria-hidden="true" />
          </button>
        )}
        <Sangria nivel={fila.nivel} />
        {/* El lugar de la flechita de plegar: así una tarea suelta queda alineada con una madre del mismo nivel. */}
        <span className="renglon__plegar-lugar" aria-hidden="true" />
        <MarcadorPersona tarea={tarea} ctx={ctx} />
        <button type="button" className={unir('renglon__nombre', cerrada && 'renglon__nombre--cerrada')} aria-label={`Abrir «${tarea.titulo}»`} title={tarea.titulo} onClick={() => ctx.alAbrir(tarea.id)}>
          {cerrada && '✓ '}{tarea.titulo}
        </button>
        {barra.conflicto && <AlertaPisada tarea={tarea} ctx={ctx} />}
        {vacaciones !== null && <span className="renglon__vacaciones-aviso" title={vacaciones}>⚠</span>}
      </div>
      <div className="renglon__pista">
        {!cerrada && !ctx.porPersona && tarea.responsableId !== null && <Rayas tramos={ctx.vacaciones.get(tarea.responsableId)} ventana={ctx.ventana} />}
        {barra.fuera !== null ? <MarcaFuera fuera={barra.fuera} ctx={ctx} /> : <BarraTarea
          tarea={tarea}
          barra={barra}
          horas={horasDeBarra(tarea, cerrada)}
          enCadena={enCadena}
          alEnfocar={ctx.alEnfocar}
          alAbrir={ctx.alAbrir}
          ventana={ctx.ventana}
          edicion={ctx.cambios}
          unir={cerrada ? undefined : ctx.unirManejadores?.(tarea.id)}
          arrastrable={arrastrable}
          espera={espera}
          vencida={estaVencida(tarea, ctx.catalogo, ctx.hoy)}
          pausas={ctx.partesDe(tarea)}
        />}
      </div>
    </div>
  );
}
