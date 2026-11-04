import { Link } from 'react-router';
import { MessageSquare, SquareCheck } from 'lucide-react';
import type { Presencia, Tarea } from '../../compartido/tipos.js';
import { BarraCarga } from '../graficos/BarraCarga.js';
import { numeroEs } from '../graficos/geometria.js';
import { diaMesCorto } from '../fechas.js';
import { Avatar } from '../ui/Avatar.js';
import { Pildora } from '../ui/Pildora.js';
import { Vidrio } from '../ui/Vidrio.js';
import { finDeVacaciones, type IntegranteEquipo } from './equipo.js';
import { plural } from '../ui/plural.js';

const TEXTO_PRESENCIA: Record<Presencia, string> = {
  conectado: 'Conectado',
  trabajando: 'Trabajando',
  reunion: 'En reunión',
  vacaciones: 'De vacaciones',
  ausente: 'Ausente',
  'sin-opendash': 'Sin OpenDash',
};

export const enlaceTeams = (email: string): string => `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}`;

export interface TarjetaPersonaProps {
  integrante: IntegranteEquipo;
  /** Las tareas en las que está trabajando, entre las visibles. */
  tareasEnMarcha: Tarea[];
  /** Hoy, 'YYYY-MM-DD' en hora argentina. */
  hoy: string;
}

export function TarjetaPersona({ integrante, tareasEnMarcha, hoy }: TarjetaPersonaProps) {
  const { persona, presencia, rol, carga, esYo, vacaciones } = integrante;
  const finVacaciones = finDeVacaciones(vacaciones, hoy);
  const estado =
    presencia === 'trabajando' && tareasEnMarcha.length > 0
      ? `Trabajando en «${tareasEnMarcha[0]!.titulo}»${integrante.trabajandoEn.length > 1 ? ` + ${integrante.trabajandoEn.length - 1}` : ''}`
    : presencia === 'vacaciones' && finVacaciones ? `${TEXTO_PRESENCIA[presencia]} · hasta el ${diaMesCorto(finVacaciones)}`
    : TEXTO_PRESENCIA[presencia];
  const abiertas = plural(carga.abiertas, 'tarea abierta', 'tareas abiertas');

  return (
    <Vidrio as="article" className="tarjeta-persona" data-entra="vidrio" data-yo={esYo || undefined}>
      <header className="tarjeta-persona__cabeza">
        <Avatar persona={persona} tamano={48} presencia={presencia} />
        <div className="tarjeta-persona__titulo">
          <h2 className="tarjeta__titulo">
            {persona.nombre}
            {esYo && <Pildora className="tarjeta-persona__vos">Vos</Pildora>}
          </h2>
          <p className="tarjeta__sub">{rol || persona.login || ''}</p>
        </div>
      </header>
      <p className="tarjeta-persona__estado" data-presencia={presencia}>
        <i className="tarjeta-persona__punto" aria-hidden="true" />
        <span>{estado}</span>
      </p>
      <div className="tarjeta-persona__carga">
        <p className="tarjeta-persona__carga-texto">
          <span>Carga</span>
          <b className="tnum">{`${numeroEs(carga.horas)} h`}</b>
          <small className="tnum">{`/ ${numeroEs(carga.capacidad)} h`}</small>
        </p>
        <BarraCarga horas={carga.horas} capacidad={carga.capacidad} />
      </div>
      <footer className="tarjeta-persona__pie">
        <span className="tarjeta-persona__tareas tnum">
          <SquareCheck size={15} aria-hidden="true" />
          {carga.largas.length > 0 ? `${abiertas} · ${plural(carga.largas.length, 'larga', 'largas')}` : abiertas}
        </span>
        <Link className="boton boton--secundario" data-variante="secundario" to={`/equipo/${persona.id}`}>Perfil</Link>
        {persona.email !== null && persona.email !== '' && (
          <a
            className="boton boton--secundario tarjeta-persona__mensaje"
            data-variante="secundario"
            href={enlaceTeams(persona.email)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Escribirle a ${persona.nombre} en Teams`}
          >
            <MessageSquare size={16} aria-hidden="true" />
          </a>
        )}
      </footer>
    </Vidrio>
  );
}
