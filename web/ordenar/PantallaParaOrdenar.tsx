import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { CircleCheck, Folder, Users } from 'lucide-react';
import type { Catalogo, Persona, Yo } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useCatalogo, useTareas, useYo } from '../api/consultas.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { idDeRuta, ProveedorBaseTareas, rutaDetalle } from '../tareas/baseTareas.js';
import { useCompletarTarea } from '../tareas/CasillaTarea.js';
import { DetalleTarea } from '../tareas/DetalleTarea.js';
import { Chip } from '../tareas/Filtros.js';
import { useCambiosLinea } from '../linea/useCambiosLinea.js';
import { useVacacionesDe } from '../linea/useVacacionesDe.js';
import type { PeriodoCarga } from '../equipo/carga.js';
import { Aviso } from '../ui/Aviso.js';
import { Avatar } from '../ui/Avatar.js';
import { Boton } from '../ui/Boton.js';
import { plural } from '../ui/plural.js';
import { Vidrio } from '../ui/Vidrio.js';
import { ElegirResponsable } from './ElegirResponsable.js';
import { FilaOrdenar, type Globo } from './FilaOrdenar.js';
import { GloboFechas } from './GloboFechas.js';
import { armarParaOrdenar, type FilaSobrecarga, type FilaTarea, type FiltroOrdenar } from './logica.js';
import { SeccionOrdenar } from './SeccionOrdenar.js';
import { useConSalida } from './useConSalida.js';
import { useEntradaOrdenar } from './useCuentaParaOrdenar.js';
import '../tareas/tareas.css';
import './ordenar.css';

const RUTA = '/para-ordenar';
const TEXTO_PERIODO: Record<PeriodoCarga, string> = { semana: 'esta semana', quincena: 'esta quincena', mes: 'este mes' };
const ZOOM_DE: Record<PeriodoCarga, string> = { semana: 'semana', quincena: 'mes', mes: 'mes' };

const loAtiendeElMarco = (error: unknown): boolean =>
  error instanceof ErrorApi && (error.codigo === 'token-vencido' || error.codigo === 'no-sesion');

export function PantallaParaOrdenar() {
  const yo = useYo();
  // El marco solo muestra las pantallas con la persona cargada.
  return yo.data ? <ParaOrdenar yo={yo.data} /> : null;
}

function filtroDe(params: URLSearchParams, yoId: number): FiltroOrdenar {
  const persona = params.get('persona');
  const proyecto = params.get('proyecto');
  return {
    // `?persona=<mi id>` es lo mismo que «Mías».
    persona: persona === 'todas' ? 'todas' : persona !== null && /^[1-9]\d*$/.test(persona) && Number(persona) !== yoId ? Number(persona) : 'mias',
    proyectoId: proyecto !== null && /^[1-9]\d*$/.test(proyecto) ? Number(proyecto) : null,
  };
}

const porNombre = <T extends { nombre: string }>(a: T, b: T) => a.nombre.localeCompare(b.nombre, 'es-AR');

function ParaOrdenar({ yo }: { yo: Yo }) {
  const raiz = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(raiz);
  const tareas = useTareas();
  const catalogo = useCatalogo();
  const entrada = useEntradaOrdenar();
  const [params, setParams] = useSearchParams();
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const { tareaId } = useParams();
  const vacacionesDe = useVacacionesDe();
  const abrir = useCallback((id: number) => navegar({ pathname: rutaDetalle(RUTA, id), search: ubicacion.search }), [navegar, ubicacion.search]);
  const cambios = useCambiosLinea(vacacionesDe, abrir);
  const [aviso, setAviso] = useState<string | null>(null);
  const completador = useCompletarTarea(setAviso);
  const [abierto, setAbierto] = useState<{ fila: string; globo: Globo } | null>(null);

  const filtro = useMemo(() => filtroDe(params, yo.id), [params, yo.id]);
  const r = useMemo(() => (entrada ? armarParaOrdenar(entrada, filtro) : null), [entrada, filtro]);
  const cat = catalogo.data;

  const cambiarParam = (clave: string, valor: string) => {
    const nuevos = new URLSearchParams(params);
    if (valor === '' || (clave === 'persona' && valor === 'mias')) nuevos.delete(clave);
    else nuevos.set(clave, valor);
    setParams(nuevos, { replace: true });
  };

  const total = r ? r.pisan.length + r.vencidas.length + r.sinFechas.length + r.sinAsignar.length + r.sobrecarga.length : 0;
  const error = tareas.data === undefined ? tareas.error : cat === undefined ? catalogo.error : null;
  const falla = error && !loAtiendeElMarco(error);

  return (
    <ProveedorBaseTareas value={RUTA}>
      <div ref={raiz} className="pantalla pantalla-ordenar">
        <EncabezadoPantalla titulo="Para ordenar" subtitulo={r ? (total === 0 ? 'Nada para arreglar' : `${plural(total, 'cosa', 'cosas')} para arreglar`) : 'Cargando…'} />
        <Filtro filtro={filtro} catalogo={cat} yo={yo} alCambiar={cambiarParam} />
        {falla ? (
          <div className="tareas__falla">
            <Aviso tipo="error">{error instanceof ErrorApi ? error.mensaje : 'No se pudieron cargar las tareas.'}</Aviso>
            <Boton variante="secundario" onClick={() => void Promise.all([tareas.refetch(), catalogo.refetch()])}>Reintentar</Boton>
          </div>
        ) : r && entrada && cat ? (
          <>
            {aviso && <Aviso tipo="error">{aviso}</Aviso>}
            <Secciones r={r} contexto={`${filtro.persona}|${filtro.proyectoId}`} entrada={entrada} cat={cat} accion={completador} cambios={cambios} abierto={abierto} setAbierto={setAbierto} alAbrir={abrir} />
            {total === 0 && (
              <Vidrio className="ordenar__orden" role="status" tabIndex={-1}>
                <CircleCheck size={28} aria-hidden="true" />
                <p>Todo en orden</p>
              </Vidrio>
            )}
          </>
        ) : null}
        {tareaId !== undefined && (
          <DetalleTarea key={tareaId} id={idDeRuta(tareaId)} alCerrar={() => navegar({ pathname: RUTA, search: ubicacion.search })} />
        )}
      </div>
    </ProveedorBaseTareas>
  );
}

function Filtro({ filtro, catalogo, yo, alCambiar }: {
  filtro: FiltroOrdenar; catalogo: Catalogo | undefined; yo: Yo; alCambiar(clave: string, valor: string): void;
}) {
  const proyectos = [...(catalogo?.proyectos ?? [])].filter((p) => p.activo && !catalogo?.plantillas.includes(p.id)).sort(porNombre);
  const personas = [...(catalogo?.personas ?? [])].filter((p) => p.id !== yo.id).sort(porNombre);
  const personaDe = (id: number): Persona =>
    catalogo?.personas.find((p) => p.id === id) ?? { id, nombre: 'Persona', login: null, email: null, avatarUrl: null };
  return (
    <Vidrio className="filtros" role="search" aria-label="Filtros de Para ordenar">
      <div className="filtros__desplazable">
        <Chip
          etiqueta="Persona"
          icono={filtro.persona === 'todas' ? <Users size={18} /> : <Avatar persona={personaDe(filtro.persona === 'mias' ? yo.id : filtro.persona)} tamano={22} />}
          valor={String(filtro.persona)}
          opciones={[{ valor: 'mias', texto: 'Mías' }, { valor: 'todas', texto: 'Todo el equipo' }, ...personas.map((p) => ({ valor: String(p.id), texto: p.nombre }))]}
          activo={filtro.persona !== 'mias'}
          alCambiar={(v) => alCambiar('persona', v)}
        />
        <Chip
          etiqueta="Proyecto"
          icono={<Folder size={18} />}
          valor={filtro.proyectoId === null ? '' : String(filtro.proyectoId)}
          opciones={[{ valor: '', texto: 'Todos los proyectos' }, ...proyectos.map((p) => ({ valor: String(p.id), texto: p.nombre }))]}
          activo={filtro.proyectoId !== null}
          alCambiar={(v) => alCambiar('proyecto', v)}
        />
      </div>
    </Vidrio>
  );
}

type Abierto = { fila: string; globo: Globo } | null;

interface SeccionesProps {
  r: ReturnType<typeof armarParaOrdenar>;
  /** Cambia con el filtro: las filas que desaparecen por eso no se animan como arregladas. */
  contexto: string;
  entrada: NonNullable<ReturnType<typeof useEntradaOrdenar>>;
  cat: Catalogo;
  accion: ReturnType<typeof useCompletarTarea>;
  cambios: ReturnType<typeof useCambiosLinea>;
  abierto: Abierto;
  setAbierto(valor: Abierto): void;
  alAbrir(id: number): void;
}

function Secciones({ r, contexto, entrada, cat, accion, cambios, abierto, setAbierto, alAbrir }: SeccionesProps) {
  const pisan = useConSalida(r.pisan, (f) => `pisan-${f.tarea.id}`, contexto);
  const vencidas = useConSalida(r.vencidas, (f) => `vencidas-${f.tarea.id}`, contexto);
  const sinFechas = useConSalida(r.sinFechas, (f) => `sinFechas-${f.tarea.id}`, contexto);
  const sinAsignar = useConSalida(r.sinAsignar, (f) => `sinAsignar-${f.tarea.id}`, contexto);
  const sobrecarga = useConSalida(r.sobrecarga, (f) => `sobrecarga-${f.personaId}`, contexto);

  // Si la fila del globito abierto ya no está en la lista, el globito se cierra.
  const clavesVivas = [...r.pisan, ...r.vencidas, ...r.sinFechas, ...r.sinAsignar].map((f) => `${f.seccion}-${f.tarea.id}`).join(',');
  useEffect(() => {
    if (abierto !== null && !clavesVivas.split(',').includes(abierto.fila)) setAbierto(null);
  }, [clavesVivas, abierto, setAbierto]);

  const filas = (titulo: string, lista: { item: FilaTarea; sale: boolean }[], total: number) => lista.length === 0 ? null : (
    <SeccionOrdenar titulo={titulo} cantidad={total}>
      {lista.map(({ item: fila, sale }) => {
        // En una sucesora automática el arreglo es mover otra tarea: el globito es el de esa.
        const objetivo = fila.moverId === null ? fila.tarea : entrada.tareas.find((t) => t.id === fila.moverId) ?? fila.tarea;
        const globo = !sale && abierto?.fila === `${fila.seccion}-${fila.tarea.id}` ? abierto.globo : null;
        const cerrar = () => setAbierto(null);
        return (
          <FilaOrdenar
            key={`${fila.seccion}-${fila.tarea.id}`}
            fila={fila}
            catalogo={cat}
            accion={accion}
            sale={sale}
            alAbrir={alAbrir}
            alCorrerDetras={(id) => void cambios.correrDetras(id)}
            alPedirGlobo={(g) => setAbierto(globo === g ? null : { fila: `${fila.seccion}-${fila.tarea.id}`, globo: g })}
            globo={globo === 'fechas'
              ? (id) => <GloboFechas id={id} tarea={objetivo} tareas={entrada.tareas} dependencias={entrada.dependencias} catalogo={cat} cambios={cambios} alCerrar={cerrar} />
              : globo === 'responsable' ? (id) => <ElegirResponsable id={id} tarea={fila.tarea} catalogo={cat} alCerrar={cerrar} /> : null}
          />
        );
      })}
    </SeccionOrdenar>
  );

  return (
    <>
      {filas('Fechas que se pisan', pisan, r.pisan.length)}
      {filas('Vencidas', vencidas, r.vencidas.length)}
      {filas('Sin fechas', sinFechas, r.sinFechas.length)}
      {filas('Sin asignar', sinAsignar, r.sinAsignar.length)}
      {sobrecarga.length > 0 && (
        <SeccionOrdenar titulo="Más trabajo del que entra" cantidad={r.sobrecarga.length}>
          {sobrecarga.map(({ item, sale }) => <FilaCarga key={item.personaId} fila={item} cat={cat} sale={sale} />)}
        </SeccionOrdenar>
      )}
    </>
  );
}

const horasTexto = (h: number): string => String(Math.round(h * 10) / 10).replace('.', ',');

function FilaCarga({ fila, cat, sale }: { fila: FilaSobrecarga; cat: Catalogo; sale: boolean }) {
  const navegar = useNavigate();
  const persona = cat.personas.find((p) => p.id === fila.personaId) ?? null;
  const nombre = persona?.nombre ?? 'Persona sin datos';
  const texto = `${nombre} · ${TEXTO_PERIODO[fila.periodo]}: ${horasTexto(fila.horas)} h de tareas, entran ${horasTexto(fila.capacidad)} h`;
  return (
    <li className={sale ? 'ordenar__fila ordenar__fila--carga ordenar__fila--sale' : 'ordenar__fila ordenar__fila--carga'} aria-hidden={sale || undefined}>
      <Avatar persona={persona} tamano={28} />
      <div className="ordenar__texto"><span className="ordenar__titulo">{texto}</span></div>
      <div className="ordenar__arreglo">
        <Boton
          variante="secundario"
          disabled={sale}
          onClick={() => navegar(`/linea-de-tiempo?vista=persona&zoom=${ZOOM_DE[fila.periodo]}&persona=${fila.personaId}`)}
        >
          Ver en la línea
        </Boton>
      </div>
    </li>
  );
}
