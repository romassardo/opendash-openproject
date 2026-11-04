import { useId, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { calendarioDe } from '../../compartido/calendarioOp.js';
import { motivoSinPausa, partesDe, pausaDesdeFechas, type Pausa } from '../../compartido/pausas.js';
import type { Catalogo, Tarea } from '../../compartido/tipos.js';
import { usePausas } from '../api/consultas.js';
import { diaMesCorto } from '../fechas.js';
import { useCambiosLinea } from '../linea/useCambiosLinea.js';
import { useVacacionesDe } from '../linea/useVacacionesDe.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { plural } from '../ui/plural.js';
import { rutaDetalle, useBaseTareas } from './baseTareas.js';
import { esHitoDe } from './logica.js';
import { Seccion } from './SeccionesDetalle.js';

const SIN_PAUSAS: readonly Pausa[] = [];

const rangoDe = (desde: string, hasta: string): string => (desde === hasta ? `El ${diaMesCorto(desde)}` : `Del ${diaMesCorto(desde)} al ${diaMesCorto(hasta)}`);

/**
 * Pausas de la tarea, como «Dividir tarea» de Project: el trabajo se interrumpe y se retoma más adelante.
 * Viven en OpenDash; en OpenProject la tarea se ve entera y termina más tarde.
 */
export function SeccionPausas({ tarea, todas, catalogo }: { tarea: Tarea; todas: Tarea[]; catalogo: Catalogo }) {
  const id = useId();
  const pausas = usePausas().data?.[tarea.id] ?? SIN_PAUSAS;
  const { search } = useLocation();
  const base = useBaseTareas();
  const navegar = useNavigate();
  const cambios = useCambiosLinea(useVacacionesDe(), (otra) => navegar({ pathname: rutaDetalle(base, otra), search }));
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const cal = useMemo(() => calendarioDe(catalogo), [catalogo]);
  const motivo = motivoSinPausa(tarea, esHitoDe(catalogo)(tarea), todas.some((t) => t.madreId === tarea.id));
  const cerrada = catalogo.estados.find((e) => e.id === tarea.estadoId)?.cerrado === true;
  const partes = useMemo(
    () => (tarea.inicio !== null && tarea.fin !== null ? partesDe(tarea.inicio, tarea.fin, pausas, cal) : null),
    [tarea.inicio, tarea.fin, pausas, cal],
  );
  if (motivo !== null && pausas.length === 0) return null;

  const pedida = motivo === null && desde !== '' && hasta !== '' && tarea.inicio !== null && tarea.fin !== null
    ? pausaDesdeFechas(tarea.inicio, tarea.fin, pausas, desde, hasta, cal)
    : null;
  const error = typeof pedida === 'string' ? pedida : null;
  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (pedida === null || typeof pedida === 'string' || cambios.ocupado) return;
    if (await cambios.pausar(tarea, pedida, { desde, hasta })) {
      setDesde('');
      setHasta('');
    }
  };

  return (
    <Seccion titulo="Pausas">
      {pausas.length > 0 && (
        <ul className="detalle-filas" aria-label="Pausas">
          {pausas.map((p) => {
            const ubicada = partes?.pausas.find((x) => x.id === p.id);
            const texto = ubicada ? rangoDe(ubicada.desde, ubicada.hasta) : 'Fuera de las fechas de la tarea';
            return (
              <li key={p.id} className="detalle-fila">
                <span className="detalle-fila__titulo">{texto} · {plural(p.dias, 'día hábil', 'días hábiles')}</span>
                <button
                  type="button"
                  className="detalle__quitar"
                  aria-label={`Quitar la pausa: ${texto.toLowerCase()}`}
                  disabled={cambios.ocupado}
                  onClick={() => void cambios.quitarPausa(p, tarea.titulo)}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {motivo === null && !cerrada && (
        <form className="detalle-pausar" aria-label="Pausar la tarea" onSubmit={(e) => void enviar(e)}>
          <label className="detalle-pausar__campo">
            <span className="detalle-campo__etiqueta">Sin trabajo desde</span>
            <input type="date" value={desde} min={tarea.inicio ?? undefined} max={tarea.fin ?? undefined} onChange={(e) => setDesde(e.target.value)} aria-describedby={error ? `${id}-error` : undefined} />
          </label>
          <label className="detalle-pausar__campo">
            <span className="detalle-campo__etiqueta">Hasta</span>
            <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} aria-describedby={error ? `${id}-error` : undefined} />
          </label>
          <Boton variante="secundario" type="submit" disabled={pedida === null || error !== null || cambios.ocupado}>Pausar</Boton>
          {error && <div id={`${id}-error`} className="detalle-pausar__error"><Aviso tipo="error">{error}</Aviso></div>}
          <p className="detalle__vacio detalle-pausar__ayuda">
            El trabajo no cambia: la tarea termina más tarde y lo que la espera se corre. En OpenProject se ve entera, hasta el fin nuevo.
          </p>
        </form>
      )}
    </Seccion>
  );
}
