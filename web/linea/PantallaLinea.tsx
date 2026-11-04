import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Folder, Plus, Users } from 'lucide-react';
import { estadoDeColumna, mensajeFaltaEstado } from '../../compartido/columnas.js';
import type { Catalogo, Persona, Tarea, Yo } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useAjustes, useCatalogo, useEquipo, useFeriados, useOrdenLinea, usePausas, useTareas, useYo } from '../api/consultas.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { diaMesCorto, hoyArgentina } from '../fechas.js';
import { EVENTO_NUEVA_TAREA } from '../marco/BarraSuperior.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { idDeRuta, ProveedorBaseTareas } from '../tareas/baseTareas.js';
import { DetalleTarea } from '../tareas/DetalleTarea.js';
import { Chip } from '../tareas/Filtros.js';
import { recordarProyecto } from '../tareas/FormularioRapido.js';
import { MSG_TRAYENDO } from '../tareas/logica.js';
import { Avatar } from '../ui/Avatar.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { unir } from '../ui/clases.js';
import { Segmentado, type OpcionSegmentado } from '../ui/Segmentado.js';
import { Vidrio } from '../ui/Vidrio.js';
import { feriadosEnVentana, vacacionesPorPersona } from './ausencias.js';
import { DialogoNuevaTarea } from './DialogoNuevaTarea.js';
import { armarFilas } from './filas.js';
import { LineaDeTiempo } from './LineaDeTiempo.js';
import { ANCHO_LISTA } from './medidas.js';
import { desdeParaVer, moverVentana, ventanaDesde, ventanaInicial, type Vista, type Zoom } from './modelo.js';
import { fechasDeNueva } from './nuevaTarea.js';
import { usePlegados } from './plegados.js';
import { useTerminadasVisibles } from './terminadas.js';
import { conControles, leerControles } from './urlLinea.js';
import { useCambiosLinea } from './useCambiosLinea.js';
import { useVacacionesDe } from './useVacacionesDe.js';
import '../tareas/tareas.css';
import './linea.css';
import { plural } from '../ui/plural.js';

const RUTA = '/linea-de-tiempo';
/** Relleno horizontal del vidrio de la línea (24 px por lado): la pista es lo que queda de ancho. */
const RELLENO_LINEA = 48;
/** Ancho de respaldo cuando el navegador no mide (sin ResizeObserver). */
const ANCHO_SIN_MEDIDA = 1200;

const VISTAS: OpcionSegmentado<Vista>[] = [
  { valor: 'proyecto', etiqueta: 'Por proyecto' },
  { valor: 'persona', etiqueta: 'Por persona' },
  { valor: 'todas', etiqueta: 'Todas' },
];
const ZOOMS: OpcionSegmentado<Zoom>[] = [
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
  { valor: 'trimestre', etiqueta: 'Trimestre' },
];

/** Errores que ya atiende el marco (diálogo de token, vuelta al ingreso): la pantalla no los repite. */
const loAtiendeElMarco = (error: unknown): boolean =>
  error instanceof ErrorApi && (error.codigo === 'token-vencido' || error.codigo === 'no-sesion');

/** Ancho del elemento, medido una sola vez para toda la pista (no por barra); `null` hasta la primera medida. */
function useAnchoMedido(ref: RefObject<HTMLElement | null>): number | null {
  const [ancho, setAncho] = useState<number | null>(null);
  useLayoutEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    if (typeof ResizeObserver === 'undefined') {
      setAncho(nodo.clientWidth || ANCHO_SIN_MEDIDA);
      return;
    }
    const observador = new ResizeObserver((entradas) => {
      const medida = entradas[0]?.contentRect.width;
      if (medida !== undefined) setAncho(Math.round(medida));
    });
    observador.observe(nodo);
    return () => observador.disconnect();
  }, [ref]);
  return ancho;
}

function nombreDelFiltro(proyectoId: number | null, personaId: number | null, catalogo: Catalogo | undefined): string | null {
  if (proyectoId !== null) return catalogo?.proyectos.find((p) => p.id === proyectoId)?.nombre ?? 'un proyecto';
  if (personaId !== null) return catalogo?.personas.find((p) => p.id === personaId)?.nombre ?? 'una persona';
  return null;
}

const porNombre = <T extends { nombre: string }>(a: T, b: T) => a.nombre.localeCompare(b.nombre, 'es-AR');

interface FiltrosLineaProps {
  proyectoId: number | null;
  personaId: number | null;
  catalogo: Catalogo | undefined;
  yo: Yo;
  alCambiar(cambios: { proyecto?: string | null; persona?: string | null }): void;
}

/** Los mismos chips de Proyecto y Persona que en Tareas; «Solo mías» es la persona propia. */
function FiltrosLinea({ proyectoId, personaId, catalogo, yo, alCambiar }: FiltrosLineaProps) {
  const proyectos = useMemo(() => [...(catalogo?.proyectos ?? [])].sort(porNombre), [catalogo]);
  const personas = useMemo(() => (catalogo?.personas ?? []).filter((p) => p.id !== yo.id).sort(porNombre), [catalogo, yo.id]);
  const persona = (id: number): Persona =>
    catalogo?.personas.find((p) => p.id === id) ?? { id, nombre: id === yo.id ? yo.nombre : 'Persona', login: null, email: null, avatarUrl: null };
  return (
    <>
      <Chip
        etiqueta="Proyecto"
        icono={<Folder size={18} />}
        valor={proyectoId === null ? '' : String(proyectoId)}
        opciones={[{ valor: '', texto: 'Todos los proyectos' }, ...proyectos.map((p) => ({ valor: String(p.id), texto: p.nombre }))]}
        activo={proyectoId !== null}
        alCambiar={(v) => alCambiar({ proyecto: v === '' ? null : v })}
      />
      <Chip
        etiqueta="Persona"
        icono={personaId === null ? <Users size={18} /> : <Avatar persona={persona(personaId)} tamano={22} />}
        valor={personaId === null ? '' : String(personaId)}
        opciones={[
          { valor: '', texto: 'Todas las personas' },
          { valor: String(yo.id), texto: 'Solo mías' },
          ...personas.map((p) => ({ valor: String(p.id), texto: p.nombre })),
        ]}
        activo={personaId !== null}
        alCambiar={(v) => alCambiar({ persona: v === '' ? null : v })}
      />
    </>
  );
}

/** Dónde se abrió el alta: el proyecto propuesto y la madre, si es una subtarea. */
interface Alta { proyectoId: number | null; madreId: number | null }

const SIN_CREADAS: ReadonlySet<number> = new Set();
/** Lo que late la barra recién creada (dos vueltas de 0,9 s en `linea.css`). */
const MS_RESALTADO = 1800;

export function PantallaLinea() {
  const yo = useYo();
  // El marco solo muestra las pantallas con la persona cargada.
  return yo.data ? <Linea yo={yo.data} /> : null;
}

function Linea({ yo }: { yo: Yo }) {
  const raiz = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(raiz, [], '[data-entra]');
  const medida = useRef<HTMLDivElement>(null);
  const ancho = useAnchoMedido(medida);
  const tareas = useTareas();
  const catalogo = useCatalogo();
  const ajustes = useAjustes();
  const [params, setParams] = useSearchParams();
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const { tareaId } = useParams();
  const controles = useMemo(() => leerControles(params), [params]);
  const { vista, zoom, desde, soloConDependencias, proyectoId, personaId } = controles;
  const hoy = hoyArgentina();
  const orden = useOrdenLinea();
  const pausas = usePausas();
  const feriadosLista = useFeriados();
  const equipo = useEquipo();
  const { plegados, alternar } = usePlegados();
  const [alta, setAlta] = useState<Alta | null>(null);
  const [recien, setRecien] = useState<number | null>(null);
  // Las creadas desde acá se ven aunque los filtros las escondan, hasta que se cambia de vista o de filtro.
  const claveFiltros = `${vista}|${soloConDependencias}|${proyectoId}|${personaId}`;
  const [creadas, setCreadas] = useState<{ clave: string; ids: ReadonlySet<number> }>({ clave: claveFiltros, ids: SIN_CREADAS });
  const siempreVisibles = creadas.clave === claveFiltros ? creadas.ids : SIN_CREADAS;
  // El resaltado de la recién creada dura lo que su animación: después no vuelve a latir al redibujar.
  useEffect(() => {
    if (recien === null) return;
    const reloj = setTimeout(() => setRecien(null), MS_RESALTADO);
    return () => clearTimeout(reloj);
  }, [recien]);
  const { terminadasVisibles, alternar: alternarTerminadas } = useTerminadasVisibles();
  const vacaciones = useMemo(() => vacacionesPorPersona(equipo.data), [equipo.data]);
  const vacacionesDe = useVacacionesDe();
  const abrirTarea = (id: number) => navegar({ pathname: `${RUTA}/tareas/${id}`, search: ubicacion.search });
  const edicion = useCambiosLinea(vacacionesDe, abrirTarea);

  const cambiar = (cambios: Parameters<typeof conControles>[1]) => setParams(conControles(params, cambios), { replace: true });

  const todas = tareas.data?.tareas;
  const dependencias = tareas.data?.dependencias;
  const cat = catalogo.data;
  // Espera los ajustes para que los proyectos no aparezcan un instante con el color de respaldo.
  const listo = todas !== undefined && dependencias !== undefined && cat !== undefined && !ajustes.isPending;
  const trayendo = !yo.cargaInicialLista;

  // Mientras se arrastra el fondo la ventana sigue al puntero; a la dirección va recién al soltar.
  const [desdeArrastre, setDesdeArrastre] = useState<string | null>(null);
  const desdeVisto = desdeArrastre ?? desde;
  const pista = ancho === null ? null : Math.max(0, ancho - ANCHO_LISTA - RELLENO_LINEA);
  const ventana = useMemo(() => {
    if (pista === null) return null;
    return desdeVisto === null ? ventanaInicial(zoom, pista, hoy) : ventanaDesde(desdeVisto, zoom, pista);
  }, [pista, zoom, desdeVisto, hoy]);
  const desplazar = (nuevo: string, final: boolean) => {
    if (final) cambiar({ desde: nuevo });
    setDesdeArrastre(final ? null : nuevo);
  };

  const ordenGuardado = orden.data;
  const filas = useMemo(
    () => (listo && ventana
      ? armarFilas(todas, dependencias, cat, ventana, { vista, soloConDependencias, proyectoId, personaId, plegados, orden: ordenGuardado ?? {}, yoId: yo.id, terminadasVisibles, siempreVisibles }, ajustes.data?.estilos)
      : []),
    [listo, todas, dependencias, cat, ventana, vista, soloConDependencias, proyectoId, personaId, plegados, ordenGuardado, ajustes.data?.estilos, yo.id, terminadasVisibles, siempreVisibles],
  );
  const feriados = useMemo(
    () => (ventana ? feriadosEnVentana(feriadosLista.data, ventana.desde, ventana.hasta) : new Map<string, string>()),
    [feriadosLista.data, ventana],
  );

  // El subtítulo cuenta lo que pasa los filtros de proyecto o persona, esté o no en la ventana.
  const subtitulo = useMemo(() => {
    if (!listo) return 'Cargando tareas…';
    if (trayendo) return MSG_TRAYENDO;
    const conDependencias = new Set(dependencias.flatMap((d) => [d.sucesoraId, d.predecesoraId]));
    const delFiltro = todas.filter((t: Tarea) =>
      (t.inicio !== null || t.fin !== null) && (proyectoId === null || t.proyectoId === proyectoId) && (personaId === null || t.responsableId === personaId));
    const nombre = nombreDelFiltro(proyectoId, personaId, cat);
    const cuenta = `${plural(delFiltro.length, 'tarea', 'tareas')} con fechas${nombre === null ? '' : ` de ${nombre}`}`;
    return `${cuenta} · ${delFiltro.filter((t) => conDependencias.has(t.id)).length} con dependencias`;
  }, [listo, trayendo, todas, dependencias, cat, proyectoId, personaId]);

  const mover = (sentido: -1 | 1) => {
    if (ventana) cambiar({ desde: moverVentana(ventana, sentido).desde });
  };
  const irAFecha = (fecha: string) => {
    if (ventana) cambiar({ desde: desdeParaVer(fecha, ventana) });
  };

  const cerrarDetalle = () => navegar({ pathname: RUTA, search: ubicacion.search });

  const fechasNueva = useMemo(() => {
    if (!ventana || !cat) return null;
    try {
      return fechasDeNueva(hoy, ventana, cat);
    } catch {
      // Un calendario de OpenProject sin días hábiles: no se ofrece el alta en vez de romper la pantalla.
      return null;
    }
  }, [hoy, ventana, cat]);
  const abrirAlta = (proyecto: number | null, madreId: number | null) => setAlta({ proyectoId: proyecto, madreId });
  // El «+» de la barra superior abre el alta acá mismo, con el proyecto del filtro si hay uno.
  const puedeCrear = listo && fechasNueva !== null;
  useEffect(() => {
    if (!puedeCrear) return;
    const alPedir = () => setAlta({ proyectoId, madreId: null });
    window.addEventListener(EVENTO_NUEVA_TAREA, alPedir);
    return () => window.removeEventListener(EVENTO_NUEVA_TAREA, alPedir);
  }, [puedeCrear, proyectoId]);
  const crear = async (titulo: string, proyecto: number): Promise<boolean> => {
    if (alta === null || fechasNueva === null || !cat) return false;
    const estado = estadoDeColumna('nuevo', cat.estados, cat.tablero);
    if (estado === null) {
      edicion.avisar(mensajeFaltaEstado('nuevo'));
      return false;
    }
    const creada = await edicion.crear({
      titulo, proyectoId: proyecto, estadoId: estado.id, responsableId: yo.id, madreId: alta.madreId,
      inicio: fechasNueva.inicio, fin: fechasNueva.fin, programacionManual: true,
    });
    if (creada === null) return false;
    recordarProyecto(creada.proyectoId);
    // La madre plegada escondería a su hija nueva.
    if (alta.madreId !== null && plegados.has(alta.madreId)) alternar(alta.madreId);
    setCreadas((previas) => ({ clave: claveFiltros, ids: new Set([...(previas.clave === claveFiltros ? previas.ids : []), creada.id]) }));
    setRecien(creada.id);
    setAlta(null);
    return true;
  };

  const error = todas === undefined ? tareas.error : cat === undefined ? catalogo.error : null;
  const falla = error && !loAtiendeElMarco(error);

  let cuerpo;
  if (falla) {
    cuerpo = (
      <div className="tareas__falla">
        <Aviso tipo="error">{error instanceof ErrorApi ? error.mensaje : 'No se pudieron cargar las tareas.'}</Aviso>
        <Boton variante="secundario" onClick={() => void Promise.all([tareas.refetch(), catalogo.refetch()])}>Reintentar</Boton>
      </div>
    );
  } else if (!listo || !ventana) {
    cuerpo = <Vidrio className="linea linea--espera" aria-hidden="true" data-entra="pieza" />;
  } else {
    // Sin tareas en la ventana la línea queda igual, con la pista vacía: así se sigue arrastrando hasta encontrarlas.
    const mensajeVacia = trayendo ? MSG_TRAYENDO : `No hay tareas con fechas entre el ${diaMesCorto(ventana.desde)} y el ${diaMesCorto(ventana.hasta)}.`;
    cuerpo = (
      <LineaDeTiempo
        filas={filas}
        ventana={ventana}
        zoom={zoom}
        tareas={todas}
        dependencias={dependencias}
        catalogo={cat}
        hoy={hoy}
        alAbrir={abrirTarea}
        estilos={ajustes.data?.estilos}
        cambios={edicion}
        feriados={feriados}
        vacaciones={vacaciones}
        alternarGrupo={alternar}
        alternarTerminadas={alternarTerminadas}
        irAFecha={irAFecha}
        orden={ordenGuardado}
        alCrear={puedeCrear ? abrirAlta : undefined}
        recien={recien}
        pausas={pausas.data}
        alDesplazar={desplazar}
        mensajeVacia={filas.length === 0 ? mensajeVacia : undefined}
      />
    );
  }

  return (
    <ProveedorBaseTareas value={RUTA}>
      <div ref={raiz} className="pantalla pantalla-linea">
        <EncabezadoPantalla titulo="Línea de tiempo" subtitulo={subtitulo}>
          <div className="linea__controles" data-entra="pieza">
            <Segmentado etiqueta="Agrupar" opciones={VISTAS} valor={vista} onCambio={(v) => cambiar({ vista: v })} />
            <FiltrosLinea proyectoId={proyectoId} personaId={personaId} catalogo={cat} yo={yo} alCambiar={cambiar} />
            <button type="button" className={unir('chip', soloConDependencias && 'chip--activo')} aria-pressed={soloConDependencias} onClick={() => cambiar({ dependencias: soloConDependencias ? null : '1' })}>
              Solo con dependencias
            </button>
            <div className="linea__navegacion">
              <Boton variante="secundario" icono={<ChevronLeft />} aria-label="Atrás" onClick={() => mover(-1)} />
              <Boton variante="secundario" onClick={() => cambiar({ desde: null })}>Hoy</Boton>
              <Boton variante="secundario" icono={<ChevronRight />} aria-label="Adelante" onClick={() => mover(1)} />
            </div>
            <Segmentado etiqueta="Escala" opciones={ZOOMS} valor={zoom} onCambio={(z) => cambiar({ zoom: z })} />
            <Boton variante="primario" icono={<Plus />} disabled={!puedeCrear} onClick={() => abrirAlta(proyectoId, null)}>Nueva tarea</Boton>
          </div>
        </EncabezadoPantalla>
        <div ref={medida} className="linea__medida">{cuerpo}</div>
        {tareaId !== undefined && <DetalleTarea key={tareaId} id={idDeRuta(tareaId)} alCerrar={cerrarDetalle} />}
        {alta !== null && cat && todas && fechasNueva && (
          <DialogoNuevaTarea
            catalogo={cat}
            tareas={todas}
            proyectoId={alta.proyectoId}
            madreId={alta.madreId}
            fechas={fechasNueva}
            ocupado={edicion.ocupado}
            alCrear={crear}
            alCerrar={() => setAlta(null)}
          />
        )}
      </div>
    </ProveedorBaseTareas>
  );
}
