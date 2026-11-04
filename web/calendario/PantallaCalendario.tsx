import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import type { EstadoCalendario, Yo } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useCalendario, useCatalogo, useFeriados, useTareas, useVacaciones, useYo } from '../api/consultas.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { esFechaValida, semanaDe } from '../fechas.js';
import { useHoy } from '../ui/hoy.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { useCompletarTarea } from '../tareas/CasillaTarea.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { Segmentado } from '../ui/Segmentado.js';
import { Vidrio } from '../ui/Vidrio.js';

import type { DatosDia } from './CeldaDia.js';
import { GrillaMes } from './GrillaMes.js';
import { desdeCuando, fueraDeVentana, moverFecha, rangoVisible, reunionesDeLaSemana, reunionesPorDia, textoVentana, tituloMes, vencimientosPorDia, type VistaCalendario } from './logica.js';
import { PanelDia } from './PanelDia.js';
import { VistaSemana } from './VistaSemana.js';
import '../tareas/tareas.css';
import './calendario.css';
import { plural } from '../ui/plural.js';

/** Abre la redacción de una reunión en Outlook web. Si no anda con la cuenta de Microsoft 365: `outlook.office365.com`. */
const ENLACE_NUEVA_REUNION = 'https://outlook.office.com/calendar/deeplink/compose';
const OPCIONES_VISTA = [{ valor: 'mes' as const, etiqueta: 'Mes' }, { valor: 'semana' as const, etiqueta: 'Semana' }];
const VACIO: never[] = [];
const REFRESCO_RELOJ_MS = 30_000;

/** Errores que ya atiende el marco (diálogo de token, vuelta al ingreso): la pantalla no los repite. */
const loAtiendeElMarco = (error: unknown): boolean =>
  error instanceof ErrorApi && (error.codigo === 'token-vencido' || error.codigo === 'no-sesion');

export function PantallaCalendario() {
  const yo = useYo();
  // El marco solo muestra las pantallas con la persona cargada.
  return yo.data ? <Calendario yo={yo.data} /> : null;
}

function AvisoEstado({ estado }: { estado: EstadoCalendario | null }) {
  if (estado === null) {
    return (
      <Aviso tipo="info">
        <span>
          Todavía no hay un calendario conectado. Publicá tu calendario desde Outlook en la web (Configuración, Calendario, Calendarios
          compartidos, Publicar un calendario), copiá el enlace ICS y pegalo en Configuración para ver acá tus reuniones.{' '}
        </span>
        <Link to="/configuracion#configuracion-cuenta" className="cal-aviso__enlace">Ir a Configuración</Link>
      </Aviso>
    );
  }
  if (estado.falla === null) return null;
  return (
    <Aviso tipo="info">
      <span>{estado.leido ? `Sin actualizar desde ${desdeCuando(estado.leido, new Date())}` : 'Todavía no se pudo leer el calendario'}</span>
      {estado.falla === 'enlace-caido' && <span>{' '}El enlace ya no funciona: pegá uno nuevo en Configuración.</span>}
    </Aviso>
  );
}

function Calendario({ yo }: { yo: Yo }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(ref);
  const [params, setParams] = useSearchParams();
  const [aviso, setAviso] = useState<string | null>(null);
  const completador = useCompletarTarea(setAviso);

  const [ahora, setAhora] = useState(() => new Date());
  const hoy = useHoy();
  const crudoDia = params.get('dia');
  const dia = crudoDia !== null && esFechaValida(crudoDia) ? crudoDia : hoy;
  const vista: VistaCalendario = params.get('vista') === 'semana' ? 'semana' : 'mes';

  // «Ahora» y la línea roja avanzan solos, pero solo mientras se mira hoy.
  const miraHoy = dia === hoy;
  useEffect(() => {
    if (!miraHoy) return;
    setAhora(new Date());
    const reloj = setInterval(() => setAhora(new Date()), REFRESCO_RELOJ_MS);
    return () => clearInterval(reloj);
  }, [miraHoy]);

  const { desde, hasta } = rangoVisible(vista, dia);
  const semanaActual = semanaDe(hoy);
  // La cuenta «esta semana» sale de lo que ya se pidió; si la semana de hoy no se ve, se pide aparte.
  const cubreLaSemana = desde <= semanaActual.lunes && semanaActual.domingo <= hasta;
  const calendario = useCalendario(desde, hasta, true, true);
  const deEstaSemana = useCalendario(semanaActual.lunes, semanaActual.domingo, !cubreLaSemana);
  const tareas = useTareas();
  const catalogo = useCatalogo();
  const feriados = useFeriados();
  const vacaciones = useVacaciones(desde);

  const reuniones = calendario.data?.reuniones ?? VACIO;
  const porDia = useMemo(() => reunionesPorDia(reuniones), [reuniones]);
  const vencimientos = useMemo(
    () => (tareas.data && catalogo.data ? vencimientosPorDia(tareas.data.tareas, catalogo.data, yo.id) : new Map()),
    [tareas.data, catalogo.data, yo.id],
  );
  const nombresFeriado = useMemo(() => new Map((feriados.data?.feriados ?? []).map((f) => [f.fecha, f.nombre])), [feriados.data]);
  const enVacaciones = useCallback(
    (fecha: string) => (vacaciones.data ?? []).some((v) => v.desde <= fecha && fecha <= v.hasta),
    [vacaciones.data],
  );

  const datosDe = useCallback((fecha: string): DatosDia => ({
    fecha,
    reuniones: porDia.get(fecha) ?? VACIO,
    vencen: vencimientos.get(fecha)?.length ?? 0,
    feriado: nombresFeriado.get(fecha) ?? null,
    vacaciones: enVacaciones(fecha),
  }), [porDia, vencimientos, nombresFeriado, enVacaciones]);

  // Con `keepPreviousData`, `calendario.data` puede ser del rango anterior: en ese caso la cuenta sale de la consulta de esta semana.
  const consultaCuenta = cubreLaSemana && !calendario.isPlaceholderData ? calendario : deEstaSemana;
  const subtitulo = consultaCuenta.data
    ? `${plural(reunionesDeLaSemana(consultaCuenta.data.reuniones, hoy), 'reunión', 'reuniones')} esta semana`
    : consultaCuenta.isError ? 'No se pudo cargar el calendario' : 'Cargando el calendario…';

  const ir = (fecha: string, nuevaVista: VistaCalendario = vista) => {
    const siguiente = new URLSearchParams(params);
    if (fecha === hoy) siguiente.delete('dia');
    else siguiente.set('dia', fecha);
    if (nuevaVista === 'semana') siguiente.set('vista', 'semana');
    else siguiente.delete('vista');
    setParams(siguiente);
  };

  const accion = {
    enVuelo: completador.enVuelo,
    completar: (...args: Parameters<typeof completador.completar>) => {
      setAviso(null);
      return completador.completar(...args);
    },
  };
  const falla = [calendario, tareas, catalogo].find((c) => c.error && !loAtiendeElMarco(c.error));
  const unidad = vista === 'mes' ? 'Mes' : 'Semana';
  const elegido = datosDe(dia);

  return (
    <div ref={ref} className="pantalla pantalla-calendario">
      <EncabezadoPantalla titulo={tituloMes(dia)} subtitulo={subtitulo}>
        <div className="cal-barra">
          <div className="cal-nav" data-entra="pieza">
            <button type="button" className="cal-nav__boton" aria-label={`${unidad} anterior`} onClick={() => ir(moverFecha(vista, dia, -1))}>
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" className="cal-nav__hoy" onClick={() => ir(hoy)}>Hoy</button>
            <button type="button" className="cal-nav__boton" aria-label={`${unidad} siguiente`} onClick={() => ir(moverFecha(vista, dia, 1))}>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
          <Segmentado etiqueta="Vista" opciones={OPCIONES_VISTA} valor={vista} onCambio={(v) => ir(dia, v)} />
          <a
            className="boton boton--primario"
            data-variante="primario"
            data-entra="pieza"
            href={ENLACE_NUEVA_REUNION}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="boton__icono" aria-hidden="true"><CalendarPlus /></span>
            Nueva reunión
          </a>
        </div>
      </EncabezadoPantalla>
      {calendario.data && <AvisoEstado estado={calendario.data.estado} />}
      {calendario.data?.estado && calendario.data.ventana && fueraDeVentana(desde, hasta, calendario.data.ventana) && (
        <Aviso tipo="info">{textoVentana(calendario.data.ventana)}</Aviso>
      )}
      {aviso && <Aviso tipo="error">{aviso}</Aviso>}
      {falla && (
        <div className="cal-falla">
          <Aviso tipo="error">{falla.error instanceof ErrorApi ? falla.error.mensaje : 'No se pudo cargar el calendario.'}</Aviso>
          <Boton variante="secundario" onClick={() => void Promise.all([calendario.refetch(), tareas.refetch(), catalogo.refetch()])}>Reintentar</Boton>
        </div>
      )}
      <div className="cal-cuerpo">
        <Vidrio as="section" className="cal-principal" aria-label={`Calendario de ${tituloMes(dia)}`}>
          {vista === 'mes'
            ? <GrillaMes fecha={dia} hoy={hoy} elegido={dia} datosDe={datosDe} alElegir={ir} />
            : <VistaSemana fecha={dia} hoy={hoy} elegido={dia} datosDe={datosDe} alElegir={ir} />}
        </Vidrio>
        <PanelDia
          fecha={dia}
          hoy={hoy}
          ahora={ahora}
          reuniones={elegido.reuniones}
          vencen={vencimientos.get(dia) ?? VACIO}
          feriado={elegido.feriado}
          vacaciones={elegido.vacaciones}
          catalogo={catalogo.data}
          accion={accion}
        />
      </div>
    </div>
  );
}
