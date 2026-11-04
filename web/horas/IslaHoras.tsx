import { Link, useLocation } from 'react-router';
import { relojTexto } from '../../compartido/horas.js';
import { useTareas } from '../api/consultas.js';
import { seccionDe } from '../marco/secciones.js';
import { useReloj } from './HorasProvider.js';
import './horas.css';

export const RUTA_HORAS = '/inicio';

/**
 * Una sola píldora en toda pantalla menos Inicio: la tarea que corre (o la primera, si todas están en pausa) y «+N»
 * con las demás, para que la esquina no tape los números de arriba. Al tocarla vuelve a Inicio, donde están todas.
 */
export function IslaHoras() {
  const { enMarcha } = useReloj();
  const { pathname } = useLocation();
  const tareas = useTareas().data?.tareas;
  const t = enMarcha.find((x) => !x.pausado) ?? enMarcha[0];
  if (t === undefined || seccionDe(pathname) === seccionDe(RUTA_HORAS)) return null;
  const titulo = tareas?.find((x) => x.id === t.tareaId)?.titulo ?? 'Tarea';
  const reloj = relojTexto(t.segundosVivos);
  const resto = enMarcha.length - 1;
  const masTexto = resto > 0 ? ` y ${resto} ${resto === 1 ? 'tarea' : 'tareas'} más` : '';
  return (
    <div className="islas">
      <Link to={RUTA_HORAS} className="isla" data-pausa={t.pausado || undefined}
        aria-label={`Trabajando en ${titulo}${t.pausado ? ' (en pausa)' : ''}${masTexto}: ${reloj}. Ir a Inicio`}>
        <span className="horas-punto" aria-hidden="true" />
        <span className="isla__titulo">{titulo}</span>
        {resto > 0 && <span className="isla__mas tnum" aria-hidden="true">+{resto}</span>}
        <span className="isla__tiempo tnum">{reloj}</span>
      </Link>
    </div>
  );
}
