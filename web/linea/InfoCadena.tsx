import type { Catalogo, Columna, Dependencia, Tarea } from '../../compartido/tipos.js';
import { diaMesCorto } from '../fechas.js';
import { columnaDeTarea } from '../tareas/logica.js';
import { Boton } from '../ui/Boton.js';
import { anteriorEnConflicto, textoCadena } from './cadena.js';

export const ETIQUETA_ESTADO: Record<Columna, string> = { nuevo: 'Nuevo', curso: 'En curso', pausa: 'En pausa', cerrado: 'Cerrado' };

export const MENSAJE_VACIO = 'Pasá el mouse o el foco por una tarea para ver de qué depende y a quién frena.';

export function rangoDe(tarea: Tarea): string {
  const inicio = tarea.inicio ?? tarea.fin;
  const fin = tarea.fin ?? tarea.inicio;
  if (!inicio || !fin) return '';
  return inicio === fin ? diaMesCorto(inicio) : `${diaMesCorto(inicio)} → ${diaMesCorto(fin)}`;
}

export interface InfoCadenaProps { tarea: Tarea | null; tareas: Tarea[]; dependencias: Dependencia[]; catalogo: Catalogo;
  /** Con él, una tarea pisada por su anterior lleva el botón «Correr detrás». */
  correrDetras?: (sucesoraId: number) => Promise<void>;
}

/** Panel bajo la línea: de qué depende y a quién frena la tarea enfocada. */
export function InfoCadena({ tarea, tareas, dependencias, catalogo, correrDetras }: InfoCadenaProps) {
  if (!tarea) return <div className="linea__info linea__info--fijo" data-testid="info-cadena" aria-live="polite">{MENSAJE_VACIO}</div>;
  const responsable = catalogo.personas.find((p) => p.id === tarea.responsableId)?.nombre ?? 'Sin asignar';
  const texto = textoCadena(tarea.id, tareas, dependencias, catalogo);
  const pisada = correrDetras !== undefined && anteriorEnConflicto(tarea.id, tareas, dependencias, catalogo) !== null;
  return (
    <div className="linea__info linea__info--fijo" data-testid="info-cadena" aria-live="polite">
      <b>{tarea.titulo}</b> · {rangoDe(tarea)} · {responsable} · {ETIQUETA_ESTADO[columnaDeTarea(tarea, catalogo)]}
      <br />
      {texto === 'nada' ? 'Espera a: nada · Frena a: nada' : texto}
      {pisada && <Boton variante="secundario" className="linea__info-correr" onClick={() => void correrDetras(tarea.id)}>Correr detrás</Boton>}
    </div>
  );
}
