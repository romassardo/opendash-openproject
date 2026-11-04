import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams, type SetURLSearchParams } from 'react-router';
import { ChartGantt, List, Plus, SquareKanban } from 'lucide-react';
import { NOMBRE_COLUMNA } from '../../compartido/columnas.js';
import type { Catalogo, Columna, Tarea } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useCatalogo, useTareas, useYo } from '../api/consultas.js';
import type { Yo } from '../../compartido/tipos.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { EVENTO_NUEVA_TAREA } from '../marco/BarraSuperior.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { Segmentado, type OpcionSegmentado } from '../ui/Segmentado.js';
import { baseDeContexto, idDeRuta, ProveedorBaseTareas, type ContextoTareas } from './baseTareas.js';
import { Contadores } from './Contadores.js';
import { DetalleTarea } from './DetalleTarea.js';
import { esPedidoDeNuevaTarea } from './EscuchaNuevaTarea.js';
import { conFiltro, leerFiltro, type FiltroUrl } from './filtroUrl.js';
import { Filtros } from './Filtros.js';
import { columnaDeTarea, contadores, filtrarTareas, hoyArgentina, MSG_TRAYENDO, resumenAbiertas, type FiltroTareas } from './logica.js';
import { Lista } from './Lista.js';
import { Tablero, type FormularioAbierto } from './Tablero.js';
import './tareas.css';

type Vista = 'tablero' | 'lista';

const VISTAS: OpcionSegmentado<Vista>[] = [
  { valor: 'tablero', etiqueta: 'Tablero', icono: <SquareKanban /> },
  { valor: 'lista', etiqueta: 'Lista', icono: <List /> },
];

const CLAVE_VISTA = 'od:vista-tareas';

/** Vista recordada; sin almacenamiento o con un valor desconocido, el tablero. */
function leerVista(): Vista {
  try {
    return window.localStorage.getItem(CLAVE_VISTA) === 'lista' ? 'lista' : 'tablero';
  } catch {
    return 'tablero';
  }
}

function guardarVista(vista: Vista): void {
  try {
    window.localStorage.setItem(CLAVE_VISTA, vista);
  } catch {
    // Sin almacenamiento la vista simplemente no se recuerda.
  }
}

// El texto filtra al instante; a la dirección va cuando se deja de escribir.
const DEMORA_TEXTO_MS = 250;

/**
 * Texto libre del filtro, sincronizado con `?q=`: se escribe con demora y `replace` (sin sumar historial)
 * y se adopta el de la dirección cuando cambia desde afuera (un enlace, atrás/adelante).
 */
function useTextoEnDireccion(params: URLSearchParams, setParams: SetURLSearchParams): [string, (texto: string) => void] {
  const enDireccion = params.get('q') ?? '';
  const [texto, setTexto] = useState(enDireccion);
  // Último valor escrito o adoptado: lo que difiera de él en la dirección vino de afuera.
  const conocido = useRef(enDireccion);

  useEffect(() => {
    if (enDireccion === conocido.current) return;
    conocido.current = enDireccion;
    setTexto(enDireccion);
  }, [enDireccion]);

  useEffect(() => {
    if (texto === conocido.current) return;
    const espera = window.setTimeout(() => {
      conocido.current = texto;
      setParams((previos) => {
        const nuevos = new URLSearchParams(previos);
        if (texto === '') nuevos.delete('q');
        else nuevos.set('q', texto);
        return nuevos;
      }, { replace: true });
    }, DEMORA_TEXTO_MS);
    return () => window.clearTimeout(espera);
  }, [texto, setParams]);

  return [texto, setTexto];
}

// Los paneles entran con la pantalla; las tarjetas, con su propio escalonado cuando llegan los datos.
const SELECTOR_PANELES = '[data-entra]:not([data-entra="tarjeta"]):not([data-entra="fila"])';

/** Errores que ya atiende el marco (diálogo de token, vuelta al ingreso): la pantalla no los repite. */
const loAtiendeElMarco = (error: unknown): boolean =>
  error instanceof ErrorApi && (error.codigo === 'token-vencido' || error.codigo === 'no-sesion');

function responsableDelFiltro(persona: FiltroTareas['persona'], usuarioId: number): number | null {
  if (persona === 'mias') return usuarioId;
  return persona === 'todas' ? null : persona;
}

export interface PantallaTareasProps {
  /** Las tareas de un proyecto o de una persona: la pantalla las prefiltra y lleva su nombre como título. */
  contexto?: ContextoTareas;
  /** Control para cambiar de parte del proyecto; va al comienzo de las acciones del encabezado. */
  pestanas?: ReactNode;
}

export function PantallaTareas({ contexto, pestanas }: PantallaTareasProps = {}) {
  const yo = useYo();
  // El marco solo muestra las pantallas con la persona cargada.
  return yo.data ? <Tareas yo={yo.data} contexto={contexto} pestanas={pestanas} /> : null;
}

/** Título de la pantalla: el nombre del proyecto o de la persona; sin catálogo todavía, el genérico. */
function tituloDe(contexto: ContextoTareas | undefined, catalogo: Catalogo | undefined): string {
  if (!contexto) return 'Tareas';
  if (contexto.tipo === 'proyecto') return catalogo?.proyectos.find((p) => p.id === contexto.id)?.nombre ?? 'Proyecto';
  return catalogo?.personas.find((p) => p.id === contexto.id)?.nombre ?? 'Persona';
}

function Tareas({ yo, contexto, pestanas }: { yo: Yo; contexto: ContextoTareas | undefined; pestanas: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(ref, [], SELECTOR_PANELES);
  const tareas = useTareas();
  const catalogo = useCatalogo();
  const [params, setParams] = useSearchParams();
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const { id, tareaId } = useParams();
  // Con contexto la ruta es `/proyectos/:id/tareas/:tareaId`; sin él, `/tareas/:id`.
  const idDetalle = contexto ? tareaId : id;
  const base = baseDeContexto(contexto);

  const [texto, setTexto] = useTextoEnDireccion(params, setParams);
  const [vista, setVista] = useState<Vista>(leerVista);
  const [formulario, setFormulario] = useState<FormularioAbierto | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const origenFormulario = useRef<HTMLElement | null>(null);

  // Tareas abre con las tuyas; dentro de un proyecto, con las de todo el equipo.
  const personaPorDefecto = contexto === undefined ? 'mias' : 'todas';
  const enDireccion = useMemo(() => leerFiltro(params, personaPorDefecto), [params, personaPorDefecto]);
  // El filtro que fija el contexto manda sobre lo que diga la dirección.
  const filtroUrl = useMemo<FiltroUrl>(() => {
    if (contexto?.tipo === 'proyecto') return { ...enDireccion, proyectoId: contexto.id };
    if (contexto?.tipo === 'persona') return { ...enDireccion, persona: contexto.id };
    return enDireccion;
  }, [enDireccion, contexto]);
  const filtro = useMemo<FiltroTareas>(() => ({ ...filtroUrl, texto }), [filtroUrl, texto]);
  const hoy = hoyArgentina();
  const todas = tareas.data?.tareas;
  const filtradas = useMemo(
    () => (todas && catalogo.data ? filtrarTareas(todas, filtro, catalogo.data, yo.id) : []),
    [todas, catalogo.data, filtro, yo.id],
  );
  const cat = catalogo.data;
  const listo = todas !== undefined && cat !== undefined;
  // Recién registrada, lo vacío no es «no hay tareas»: el servidor todavía las está trayendo.
  const trayendo = !yo.cargaInicialLista;
  let subtitulo = 'Cargando tareas…';
  if (todas && cat) subtitulo = trayendo ? MSG_TRAYENDO : resumenAbiertas(filtradas, cat);

  const elegirVista = (nueva: Vista) => {
    setVista(nueva);
    guardarVista(nueva);
  };

  // Lo que fija el contexto no se escribe en la dirección.
  const cambiarFiltro = (nuevo: FiltroUrl) =>
    setParams(conFiltro(params, { ...nuevo, proyectoId: contexto?.tipo === 'proyecto' ? enDireccion.proyectoId : nuevo.proyectoId, persona: contexto?.tipo === 'persona' ? enDireccion.persona : nuevo.persona }, personaPorDefecto), { replace: true });

  const abrirFormulario = useCallback((columna: Columna) => {
    origenFormulario.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setVista('tablero');
    setFormulario({
      columna,
      proyectoId: filtroUrl.proyectoId,
      responsableId: responsableDelFiltro(filtroUrl.persona, yo.id),
    });
  }, [filtroUrl, yo.id]);

  const cerrarFormulario = useCallback(() => {
    setFormulario(null);
    const origen = origenFormulario.current;
    origenFormulario.current = null;
    if (origen?.isConnected) origen.focus();
  }, []);

  // El detalle se abre encima del tablero; al cerrarlo se vuelve a /tareas con los mismos filtros.
  const cerrarDetalle = useCallback(
    () => navegar({ pathname: base === '' ? '/tareas' : base, search: ubicacion.search }),
    [navegar, ubicacion.search, base],
  );

  const alCrear = (tarea: Tarea) => {
    const columna = cat ? ` en ${NOMBRE_COLUMNA[columnaDeTarea(tarea, cat)]}` : '';
    setAnuncio(`Se creó la tarea «${tarea.titulo}»${columna}.`);
    cerrarFormulario();
  };

  // El «+» de la barra superior y cualquier «Nueva tarea» de la app abren el alta en «Nuevo».
  useEffect(() => {
    const alPedir = () => abrirFormulario('nuevo');
    window.addEventListener(EVENTO_NUEVA_TAREA, alPedir);
    return () => window.removeEventListener(EVENTO_NUEVA_TAREA, alPedir);
  }, [abrirFormulario]);

  // Llegada desde otra pantalla con el pedido de alta: se abre y se borra el pedido del historial.
  const pedido = esPedidoDeNuevaTarea(ubicacion.state);
  useEffect(() => {
    if (!pedido) return;
    abrirFormulario('nuevo');
    navegar({ pathname: ubicacion.pathname, search: ubicacion.search }, { replace: true, state: null });
  }, [pedido, abrirFormulario, navegar, ubicacion.pathname, ubicacion.search]);

  const titulo = tituloDe(contexto, cat);
  const error = todas === undefined ? tareas.error : cat === undefined ? catalogo.error : null;
  const falla = error && !loAtiendeElMarco(error);

  return (
    <ProveedorBaseTareas value={base}>
      <div ref={ref} className="pantalla pantalla-tareas">
        <EncabezadoPantalla titulo={titulo} subtitulo={subtitulo}>
          <div className="tareas__barra">
            <Contadores cuentas={todas && cat && !trayendo ? contadores(filtradas, cat, hoy) : null} />
            <div className="tareas__acciones" data-entra="pieza">
              {pestanas}
              {contexto && (
                <Link to={`/linea-de-tiempo?vista=${contexto.tipo}&${contexto.tipo}=${contexto.id}`} className="boton boton--secundario">
                  <span className="boton__icono" aria-hidden="true"><ChartGantt /></span>
                  Línea de tiempo
                </Link>
              )}
              <Segmentado etiqueta="Vista" opciones={VISTAS} valor={vista} onCambio={elegirVista} />
              <Boton variante="primario" icono={<Plus />} onClick={() => abrirFormulario('nuevo')}>
                Nueva tarea
              </Boton>
            </div>
          </div>
        </EncabezadoPantalla>
        <Filtros filtro={filtro} catalogo={catalogo.data} yo={yo} alCambiar={cambiarFiltro} alCambiarTexto={setTexto} ocultar={contexto?.tipo} />
        {falla ? (
          <div className="tareas__falla">
            <Aviso tipo="error">{error instanceof ErrorApi ? error.mensaje : 'No se pudieron cargar las tareas.'}</Aviso>
            <Boton variante="secundario" onClick={() => void Promise.all([tareas.refetch(), catalogo.refetch()])}>
              Reintentar
            </Boton>
          </div>
        ) : vista === 'tablero' || !listo ? (
          <Tablero
            tareas={filtradas}
            todas={todas ?? []}
            catalogo={cat ?? CATALOGO_VACIO}
            hoy={hoy}
            listo={listo}
            trayendo={trayendo}
            formulario={formulario}
            alPedirFormulario={abrirFormulario}
            alCerrarFormulario={cerrarFormulario}
            alCrear={alCrear}
          />
        ) : (
          <Lista tareas={filtradas} todas={todas ?? []} catalogo={cat} hoy={hoy} trayendo={trayendo} titulo={contexto ? titulo : undefined} />
        )}
        <p className="sr-only" role="status">{anuncio}</p>
        {idDetalle !== undefined && <DetalleTarea key={idDetalle} id={idDeRuta(idDetalle)} alCerrar={cerrarDetalle} />}
      </div>
    </ProveedorBaseTareas>
  );
}

const CATALOGO_VACIO: Catalogo = { estados: [], tipos: [], prioridades: [], proyectos: [], versiones: [], personas: [], asignables: {}, semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [], plantillas: [], tablero: { nuevo: null, curso: null, pausa: null, cerrado: null } };
