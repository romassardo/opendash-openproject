import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { CalendarDays } from 'lucide-react';
import type { Persona } from '../../compartido/tipos.js';
import type { EstiloProyecto } from '../../compartido/estilos.js';
import { AnilloAvance } from '../graficos/AnilloAvance.js';
import { rutaDeProyecto } from '../marco/busquedaLogica.js';
import { Avatar } from '../ui/Avatar.js';
import { Estrella } from '../ui/Estrella.js';
import { Pildora } from '../ui/Pildora.js';
import { Vidrio } from '../ui/Vidrio.js';
import { IconoProyecto } from './IconoProyecto.js';
import type { ResumenProyecto } from './logica.js';
import { fechaCorta, textoHito, textoPlano, tonoDeEstadoOp } from './presentacion.js';

const MAX_AVATARES = 4;

export interface TarjetaProyectoProps {
  resumen: ResumenProyecto;
  estilo: EstiloProyecto;
  /** Personas del catálogo, para mostrar las de `resumen.personas`. */
  personas: Persona[];
  hoy: string;
  fijado: boolean;
  onFijar(fijado: boolean): void;
}

/** Color y texto de la píldora: el estado de OpenProject si lo hay; si no, el derivado de las tareas. */
function estadoVisible({ proyecto, estado }: ResumenProyecto): { color: string | undefined; texto: string } {
  if (proyecto.estadoOp) {
    const tono = tonoDeEstadoOp(proyecto.estadoOpClave);
    return { color: tono && `var(--tono-${tono})`, texto: proyecto.estadoOp };
  }
  return estado === 'terminado'
    ? { color: 'var(--tono-verde)', texto: 'Terminado' }
    : { color: 'var(--tono-azul)', texto: 'Activo' };
}

export function TarjetaProyecto({ resumen, estilo, personas, hoy, fijado, onFijar }: TarjetaProyectoProps) {
  const { proyecto, hechas, total, porcentaje, proximoHito, fin } = resumen;
  const navegar = useNavigate();
  const ruta = rutaDeProyecto(proyecto.id);
  const pildora = estadoVisible(resumen);
  const gente = resumen.personas.flatMap((id) => personas.find((p) => p.id === id) ?? []);
  const descripcion = textoPlano(proyecto.descripcion);

  // Toda la tarjeta abre el proyecto; el enlace del nombre y la estrella hacen lo suyo.
  const abrir = (evento: MouseEvent<HTMLElement>) => {
    if ((evento.target as Element).closest('a, button')) return;
    void navegar(ruta);
  };

  return (
    <Vidrio as="article" className="tarjeta-proyecto" onClick={abrir}>
      <header className="tarjeta-proyecto__cabeza">
        <IconoProyecto estilo={estilo} />
        <div className="tarjeta-proyecto__titulo">
          <h2 className="tarjeta__titulo">
            <Link to={ruta} className="tarjeta-proyecto__enlace">{proyecto.nombre}</Link>
          </h2>
          <Pildora color={pildora.color}>{pildora.texto}</Pildora>
        </div>
        <Estrella activa={fijado} nombre={proyecto.nombre} onCambio={onFijar} />
      </header>
      <p className="tarjeta-proyecto__descripcion">{descripcion}</p>
      <div className="tarjeta-proyecto__hito">
        <AnilloAvance porcentaje={porcentaje} tono={estilo.color} />
        <div className="tarjeta-proyecto__hito-texto">
          {proximoHito ? (
            <>
              <small>{proximoHito.esVersion ? 'Próxima versión' : 'Próximo hito'}</small>
              <b>{proximoHito.titulo}</b>
              <span>{textoHito(proximoHito.fecha, hoy)}</span>
            </>
          ) : (
            <b>Sin hitos próximos</b>
          )}
        </div>
      </div>
      <footer className="tarjeta-proyecto__pie">
        <div className="tarjeta-proyecto__personas">
          {gente.slice(0, MAX_AVATARES).map((p) => <Avatar key={p.id} persona={p} tamano={28} />)}
          {gente.length > MAX_AVATARES && <span className="tarjeta-proyecto__mas tnum">{`+${gente.length - MAX_AVATARES}`}</span>}
        </div>
        <span className="tarjeta-proyecto__tareas tnum">{`${hechas}/${total} tareas`}</span>
        {fin !== null && (
          <span className="tarjeta-proyecto__fin tnum">
            <CalendarDays size={15} aria-hidden="true" />
            {fechaCorta(fin, hoy)}
          </span>
        )}
      </footer>
    </Vidrio>
  );
}
