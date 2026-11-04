import { Link } from 'react-router';
import { CalendarOff, PartyPopper } from 'lucide-react';
import { Boton } from '../ui/Boton.js';
import { Vidrio } from '../ui/Vidrio.js';
import { textoAusencia, type Ausencia } from './quienFalta.js';

export interface TarjetaQuienFaltaProps {
  ausencias: Ausencia[];
  /** `lista` solo cuando equipo, catálogo y feriados ya respondieron. */
  carga: 'cargando' | 'error' | 'lista';
  alReintentar(): void;
}

/** «Quién falta»: quién no está de lunes a viernes de esta semana y qué días son feriado. */
export function TarjetaQuienFalta({ ausencias, carga, alReintentar }: TarjetaQuienFaltaProps) {
  return (
    <Vidrio as="section" className="inicio__tarjeta inicio__tarjeta--3" aria-labelledby="inicio-falta">
      <header className="inicio__cabeza">
        <div>
          <h2 id="inicio-falta" className="tarjeta__titulo">Quién falta</h2>
          <p className="tarjeta__sub">Esta semana</p>
        </div>
      </header>
      {carga === 'cargando' ? (
        <p className="inicio__falta-vacio">Cargando…</p>
      ) : carga === 'error' ? (
        <div role="alert">
          <p className="inicio__falta-vacio">No se pudo cargar</p>
          <Boton variante="secundario" onClick={alReintentar}>Reintentar</Boton>
        </div>
      ) : ausencias.length === 0 ? (
        <p className="inicio__falta-vacio">Esta semana están todos</p>
      ) : (
        <ul className="inicio__falta-lista">
          {ausencias.map((a) => {
            const clave = a.tipo === 'feriado' ? `f-${a.fecha}` : `v-${a.personaId}`;
            const texto = textoAusencia(a);
            return (
              <li key={clave} className="inicio__falta-fila">
                {a.tipo === 'feriado' ? (
                  <>
                    <PartyPopper aria-hidden="true" />
                    <span title={a.nombre}>{texto}</span>
                  </>
                ) : (
                  <>
                    <CalendarOff aria-hidden="true" />
                    <Link to={`/equipo/${a.personaId}`}>{texto}</Link>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="inicio__falta-nota">Solo cuenta lo que cada uno carga en OpenDash</p>
    </Vidrio>
  );
}
