import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronDown, Folder, UserPlus } from 'lucide-react';
import type { Yo } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useAjustes, useCatalogo, useEquipo, useFeriados, usePausas, useTareas, useYo } from '../api/consultas.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { hoyArgentina } from '../fechas.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { Contador } from '../ui/Contador.js';
import { atraparTab } from '../ui/foco.js';
import { bloquearFondo } from '../ui/inerte.js';
import { Vidrio } from '../ui/Vidrio.js';
import { armarEquipo, contadoresEquipo } from './equipo.js';
import { TarjetaPersona } from './TarjetaPersona.js';
// Los contadores del encabezado y el desplegable usan lo de Tareas, y el diálogo lo del ingreso.
import '../tareas/tareas.css';
import '../ingreso/ingreso.css';
import './equipo.css';
import { plural } from '../ui/plural.js';

const SIN_DATO = '–';
const TEXTO_ALTAS =
  'Cada persona genera un token en OpenProject (Mi cuenta → Tokens de acceso → API) y entra a OpenDash con ese token. Las altas de personas se hacen en OpenProject.';

/** Errores que ya atiende el marco (diálogo de token, vuelta al ingreso): la pantalla no los repite. */
const loAtiendeElMarco = (error: unknown): boolean =>
  error instanceof ErrorApi && (error.codigo === 'token-vencido' || error.codigo === 'no-sesion');

export function PantallaEquipo() {
  const yo = useYo();
  // El marco solo muestra las pantallas con la persona cargada.
  return yo.data ? <Equipo yo={yo.data} /> : null;
}

function Equipo({ yo }: { yo: Yo }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(ref);
  const catalogo = useCatalogo();
  const tareas = useTareas();
  const ajustes = useAjustes();
  const equipo = useEquipo();
  const pausas = usePausas();
  const feriados = useFeriados();
  const [params, setParams] = useSearchParams();
  const [sumando, setSumando] = useState(false);

  const hoy = hoyArgentina();
  const cat = catalogo.data;
  const lista = tareas.data?.tareas;
  const crudo = params.get('proyecto');
  const proyectoId = crudo !== null && /^[1-9]\d*$/.test(crudo) ? Number(crudo) : null;
  const proyectos = useMemo(() => [...(cat?.proyectos ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR')), [cat]);

  // Los feriados no frenan el dibujo: mientras llegan, la capacidad va sin descontarlos.
  const diasFeriados = useMemo(() => new Set(feriados.data?.feriados.map((f) => f.fecha) ?? []), [feriados.data]);
  const integrantes = useMemo(
    () => (cat && lista && ajustes.data && equipo.data
      ? armarEquipo(cat, lista, equipo.data, ajustes.data.metricas, yo.id, hoy, proyectoId, 'semana', diasFeriados, pausas.data)
      : null),
    [cat, lista, ajustes.data, equipo.data, yo.id, hoy, proyectoId, diasFeriados, pausas.data],
  );
  const cuentas = integrantes ? contadoresEquipo(integrantes) : null;
  const registrados = integrantes ? integrantes.filter((i) => i.presencia !== 'sin-opendash').length : 0;
  const falla = [tareas, catalogo, ajustes, equipo].find((c) => c.error && !loAtiendeElMarco(c.error));

  const elegirProyecto = (valor: string) => {
    const siguiente = new URLSearchParams(params);
    if (valor === '') siguiente.delete('proyecto');
    else siguiente.set('proyecto', valor);
    setParams(siguiente);
  };

  return (
    <div ref={ref} className="pantalla pantalla-equipo">
      <EncabezadoPantalla
        titulo="Equipo"
        subtitulo={cuentas ? `${plural(cuentas.personas, 'persona', 'personas')} · ${cuentas.conOpenDash} con OpenDash` : 'Cargando el equipo…'}
      >
        <div className="equipo__barra">
          <div className="contadores" role="group" aria-label="Resumen del equipo">
            <Contador etiqueta="Conectados ahora" valor={cuentas?.conectados ?? SIN_DATO} total={cuentas ? registrados : undefined} />
            <Contador etiqueta="Trabajando" valor={cuentas?.trabajando ?? SIN_DATO} />
            <Contador etiqueta="Carga promedio" valor={cuentas ? `${cuentas.cargaPromedio}%` : SIN_DATO} />
          </div>
          <div className="equipo__acciones" data-entra="pieza">
            <div className="chip">
              <span className="chip__icono" aria-hidden="true"><Folder size={18} /></span>
              <span className="chip__texto">{proyectos.find((p) => p.id === proyectoId)?.nombre ?? 'Todos los proyectos'}</span>
              <ChevronDown className="chip__flecha" size={16} aria-hidden="true" />
              <select className="chip__select" aria-label="Proyecto" value={proyectoId === null ? '' : String(proyectoId)} onChange={(e) => elegirProyecto(e.target.value)}>
                <option value="">Todos los proyectos</option>
                {proyectos.map((p) => <option key={p.id} value={String(p.id)}>{p.nombre}</option>)}
              </select>
            </div>
            <Boton variante="secundario" icono={<UserPlus />} onClick={() => setSumando(true)}>Cómo sumar a alguien</Boton>
          </div>
        </div>
      </EncabezadoPantalla>
      {falla ? (
        <div className="equipo__falla">
          <Aviso tipo="error">{falla.error instanceof ErrorApi ? falla.error.mensaje : 'No se pudo cargar el equipo.'}</Aviso>
          <Boton variante="secundario" onClick={() => void Promise.all([tareas.refetch(), catalogo.refetch(), ajustes.refetch(), equipo.refetch()])}>Reintentar</Boton>
        </div>
      ) : (
        <div className="equipo__grilla">
          {integrantes?.map((i) => (
            <TarjetaPersona
              key={i.persona.id}
              integrante={i}
              hoy={hoy}
              tareasEnMarcha={i.trabajandoEn.flatMap((id) => lista?.find((t) => t.id === id) ?? [])}
            />
          ))}
          {integrantes && integrantes.length === 0 && <p className="equipo__vacio">No hay personas para mostrar.</p>}
        </div>
      )}
      {sumando && <DialogoSumar alCerrar={() => setSumando(false)} />}
    </div>
  );
}

/** Explica cómo sumar gente: las altas se hacen en OpenProject. Modal; Escape lo cierra y el foco vuelve al botón. */
function DialogoSumar({ alCerrar }: { alCerrar: () => void }) {
  const velo = useRef<HTMLDivElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const caja = velo.current;
    if (!caja) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const liberar = bloquearFondo(caja);
    cerrar.current?.focus();
    return () => {
      liberar();
      if (anterior?.isConnected) anterior.focus();
    };
  }, []);

  const alTeclear = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      alCerrar();
      return;
    }
    atraparTab(evento, evento.currentTarget);
  };

  return (
    <div ref={velo} className="velo" onKeyDown={alTeclear}>
      <Vidrio variante="denso" role="dialog" aria-modal="true" aria-labelledby="sumar-titulo" aria-describedby="sumar-texto" className="dialogo">
        <h2 id="sumar-titulo" className="dialogo__titulo">Cómo sumar a alguien</h2>
        <p id="sumar-texto" className="tarjeta__sub">{TEXTO_ALTAS}</p>
        <div className="dialogo__acciones">
          <Boton ref={cerrar} variante="primario" onClick={alCerrar}>Entendido</Boton>
        </div>
      </Vidrio>
    </div>
  );
}
