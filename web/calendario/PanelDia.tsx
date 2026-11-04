import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { Flag, MapPin } from 'lucide-react';
import { cuentaComoReunion, enCurso } from '../../compartido/calendario.js';
import type { Catalogo, Reunion, Tarea } from '../../compartido/tipos.js';
import { diaMesCorto } from '../fechas.js';
import { CasillaTarea, type Completador } from '../tareas/CasillaTarea.js';
import { esHitoDe } from '../tareas/logica.js';
import { unir } from '../ui/clases.js';
import { Pildora } from '../ui/Pildora.js';
import { Vidrio } from '../ui/Vidrio.js';
import { IconoPlataforma } from './IconoPlataforma.js';
import { colorPlataforma, duracionTexto, enlaceSeguro, horaTexto, tituloDia } from './logica.js';
import { plural } from '../ui/plural.js';

export interface PanelDiaProps {
  fecha: string;
  hoy: string;
  ahora: Date;
  reuniones: Reunion[];
  /** Tareas propias e hitos que vencen ese día. */
  vencen: Tarea[];
  feriado: string | null;
  vacaciones: boolean;
  catalogo: Catalogo | undefined;
  accion: Completador;
}

/** Lugar de la línea roja: después de la última reunión que ya empezó, o antes de la primera con horario. */
function lugarDeLaLinea(reuniones: Reunion[], ahora: number): number {
  let ultima = -1;
  reuniones.forEach((r, i) => {
    if (!r.diaEntero && Date.parse(r.inicio) <= ahora) ultima = i;
  });
  if (ultima >= 0) return ultima + 1;
  const primera = reuniones.findIndex((r) => !r.diaEntero);
  return primera < 0 ? reuniones.length : primera;
}

function FilaReunion({ reunion, ahora }: { reunion: Reunion; ahora: Date | null }) {
  const enlace = enlaceSeguro(reunion.enlace);
  const activa = ahora !== null && enCurso(reunion, ahora);
  return (
    <li className={unir('cal-reunion', reunion.libre && 'cal-reunion--libre')} style={{ '--barra': colorPlataforma(reunion.plataforma) } as CSSProperties}>
      <div className="cal-reunion__hora tnum">
        {reunion.diaEntero ? <span>Todo el día</span> : <><b>{horaTexto(reunion.inicio)}</b><span>{duracionTexto(reunion)}</span></>}
      </div>
      <div className="cal-reunion__cuerpo">
        <h3 className="cal-reunion__titulo">{reunion.titulo}</h3>
        {reunion.lugar && (
          <span className="cal-reunion__lugar"><MapPin size={14} aria-hidden="true" />{reunion.lugar}</span>
        )}
        {(activa || enlace || reunion.libre) && (
          <span className="cal-reunion__acciones">
            {activa && <span className="pildora-ahora">Ahora</span>}
            {reunion.libre && <Pildora>Libre</Pildora>}
            {enlace && (
              <a
                className="boton boton--secundario cal-reunion__unirse"
                data-variante="secundario"
                href={enlace}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Unirse a «${reunion.titulo}»`}
              >
                <IconoPlataforma plataforma={reunion.plataforma} />
                Unirse
              </a>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

function Vencimientos({ fecha, hoy, vencen, catalogo, accion }: Pick<PanelDiaProps, 'fecha' | 'hoy' | 'vencen' | 'catalogo' | 'accion'>) {
  const esHito = catalogo ? esHitoDe(catalogo) : () => false;
  return (
    <div className="cal-vencen">
      <h3 className="cal-vencen__titulo">
        {fecha === hoy ? 'Vencen hoy' : 'Ese día'}
        <span className="cal-vencen__cuenta tnum">{vencen.length}</span>
      </h3>
      <ul className="cal-vencen__lista">
        {vencen.map((t) => (
          <li key={t.id} className="cal-vencen__fila">
            {esHito(t) || !catalogo
              ? <Flag size={16} className="cal-vencen__hito" aria-label="Hito" role="img" />
              : <CasillaTarea tarea={t} catalogo={catalogo} accion={accion} />}
            <Link to={`/tareas/${t.id}`} className="cal-vencen__enlace">{t.titulo}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Panel de un día: sus reuniones (con la línea de la hora actual si es hoy) y lo que vence. */
export function PanelDia({ fecha, hoy, ahora, reuniones, vencen, feriado, vacaciones, catalogo, accion }: PanelDiaProps) {
  const cuentan = reuniones.filter(cuentaComoReunion).length;
  const momento = ahora.getTime();
  const linea = fecha === hoy ? lugarDeLaLinea(reuniones, momento) : -1;
  const horaActual = horaTexto(ahora.toISOString());
  const filas = reuniones.map((r) => <FilaReunion key={`${r.id}-${fecha}`} reunion={r} ahora={fecha === hoy ? ahora : null} />);
  if (linea >= 0) {
    filas.splice(linea, 0, (
      <li key="linea" role="separator" aria-label={`Hora actual ${horaActual}`} className="cal-linea">
        <span className="tnum">{horaActual}</span>
      </li>
    ));
  }
  return (
    <Vidrio as="section" className="cal-panel" aria-labelledby="cal-panel-titulo">
      <header className="cal-panel__cabeza">
        <h2 id="cal-panel-titulo" className="tarjeta__titulo">{tituloDia(fecha, hoy, diaMesCorto)}</h2>
        <p className="tarjeta__sub">{cuentan === 0 ? 'Sin reuniones' : plural(cuentan, 'reunión', 'reuniones')}</p>
        {(feriado || vacaciones) && (
          <span className="cal-panel__marcas">
            {feriado && <Pildora color="var(--tono-rosa)">{feriado}</Pildora>}
            {vacaciones && <Pildora color="var(--presencia-vacaciones)">Vacaciones</Pildora>}
          </span>
        )}
      </header>
      {reuniones.length > 0 && <ul className="cal-panel__lista">{filas}</ul>}
      {vencen.length > 0 && <Vencimientos fecha={fecha} hoy={hoy} vencen={vencen} catalogo={catalogo} accion={accion} />}
    </Vidrio>
  );
}
