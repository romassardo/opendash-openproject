import { useRef } from 'react';
import type { AvisoProblema, EstadoAviso, Persona } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useCatalogo, useTodosLosAvisos, useYo } from '../api/consultas.js';
import { useMarcarAviso } from '../api/mutaciones.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { Aviso } from '../ui/Aviso.js';
import { Avatar } from '../ui/Avatar.js';
import { Boton } from '../ui/Boton.js';
import { tiempoRelativo } from '../ui/tiempo.js';
import { Vidrio } from '../ui/Vidrio.js';
import { ETIQUETA_ESTADO } from './DialogoAviso.js';
import './avisos-problema.css';

const ESTADOS: EstadoAviso[] = ['visto', 'arreglado'];

function FilaAviso({ aviso, personas, alMarcar, ocupado }: {
  aviso: AvisoProblema;
  personas: Persona[];
  alMarcar: (estado: EstadoAviso) => void;
  ocupado: boolean;
}) {
  const quien = personas.find((p) => p.id === aviso.usuarioId) ?? null;
  const marco = aviso.marcadoPor === null ? null : personas.find((p) => p.id === aviso.marcadoPor);
  const { contexto } = aviso;
  return (
    <li className="problemas__fila">
      <Avatar persona={quien} tamano={36} />
      <div className="problemas__cuerpo">
        <p className="problemas__quien">
          <b>{quien?.nombre ?? 'Alguien'}</b>
          <span>{` · ${tiempoRelativo(aviso.creado)} · ${contexto.titulo === '' ? contexto.ruta : `${contexto.titulo} (${contexto.ruta})`}`}</span>
        </p>
        <p className="problemas__texto">{aviso.texto}</p>
        {aviso.tieneImagen && (
          <a href={`/api/avisos-problema/${aviso.id}/imagen`} target="_blank" rel="noopener noreferrer">
            <img className="problemas__imagen" src={`/api/avisos-problema/${aviso.id}/imagen`} alt="Captura adjunta al aviso" loading="lazy" />
          </a>
        )}
        <details className="problemas__detalle">
          <summary>Datos adjuntos</summary>
          <p>{`${contexto.navegador} · ventana ${contexto.ventana} · tema ${contexto.tema} · versión ${contexto.version}`}</p>
          {contexto.error !== null && <p>{`Error de la app: ${contexto.error}`}</p>}
        </details>
      </div>
      <div className="problemas__estado">
        <span className={`avisar__estado avisar__estado--${aviso.estado}`}>{ETIQUETA_ESTADO[aviso.estado]}</span>
        {marco && <span className="problemas__marco">{`Marcó ${marco.nombre}`}</span>}
        <div className="problemas__botones">
          {ESTADOS.map((estado) => (
            <Boton key={estado} variante="secundario" disabled={ocupado || aviso.estado === estado} onClick={() => alMarcar(estado)}>
              {ETIQUETA_ESTADO[estado]}
            </Boton>
          ))}
        </div>
      </div>
    </li>
  );
}

function Lista() {
  const avisos = useTodosLosAvisos(true);
  const personas = useCatalogo().data?.personas ?? [];
  const marcar = useMarcarAviso();
  const falla = avisos.error ?? marcar.error;
  if (avisos.data === undefined) return falla ? <Aviso tipo="error">{falla instanceof ErrorApi ? falla.mensaje : 'No se pudieron cargar los avisos.'}</Aviso> : null;
  return (
    <>
      {falla && <Aviso tipo="error">{falla instanceof ErrorApi ? falla.mensaje : 'No se pudo completar la acción.'}</Aviso>}
      {avisos.data.length === 0 ? (
        <p className="avisar__vacio">Nadie avisó ningún problema todavía.</p>
      ) : (
        <ul className="problemas__lista">
          {avisos.data.map((a) => (
            <FilaAviso key={a.id} aviso={a} personas={personas} ocupado={marcar.isPending} alMarcar={(estado) => marcar.mutate({ id: a.id, estado })} />
          ))}
        </ul>
      )}
    </>
  );
}

export function PantallaProblemas() {
  const yo = useYo();
  const raiz = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(raiz);
  // El marco solo muestra las pantallas con la persona cargada.
  if (!yo.data) return null;
  return (
    <div ref={raiz} className="pantalla pantalla-problemas">
      <EncabezadoPantalla titulo="Problemas avisados" subtitulo="Lo que el equipo avisó desde el botón de la barra" />
      {yo.data.recibeAvisos ? (
        <Vidrio as="section" className="problemas"><Lista /></Vidrio>
      ) : (
        <Aviso tipo="info">No recibís los avisos de problemas.</Aviso>
      )}
    </div>
  );
}
