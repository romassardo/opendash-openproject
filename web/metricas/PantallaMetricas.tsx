import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, List } from 'lucide-react';
import { estiloPorDefecto } from '../../compartido/estilos.js';
import type { Yo } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useAjustes, useCatalogo, useEquipo, useFeriados, useHorasEquipo, usePausas, useTareas, useYo } from '../api/consultas.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { feriadosDelPeriodo } from '../equipo/capacidad.js';
import { intervaloCarga, PERIODOS_CARGA, type PeriodoCarga } from '../equipo/carga.js';
import { armarEquipo } from '../equipo/equipo.js';
import { diaMesCorto, hoyArgentina } from '../fechas.js';
import { Barras } from '../graficos/Barras.js';
import { Dona } from '../graficos/Dona.js';
import { numeroEs } from '../graficos/geometria.js';
import { LineaRitmo } from '../graficos/LineaRitmo.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { Contador } from '../ui/Contador.js';
import { Segmentado } from '../ui/Segmentado.js';
import { Variacion } from '../ui/Variacion.js';
import { Vidrio } from '../ui/Vidrio.js';
import { duracionTexto } from '../../compartido/horas.js';
import { calcularMetricas, type Indicador, type Periodo } from './logica.js';
import { RealEstimado } from './RealEstimado.js';
import { TarjetaCarga } from './TarjetaCarga.js';
// Los contadores del encabezado y el selector de vista usan lo de Tareas.
import '../tareas/tareas.css';
import './metricas.css';

const SIN_DATO = '–';
const PERIODO_POR_DEFECTO: Periodo = 30;
const PERIODOS: Periodo[] = [7, 30, 90];
const OPCIONES = PERIODOS.map((p) => ({ valor: String(p), etiqueta: `${p} d` }));

/** El período de la dirección; cualquier otra cosa vale el de siempre. */
const periodoDe = (crudo: string | null): Periodo => PERIODOS.find((p) => String(p) === crudo) ?? PERIODO_POR_DEFECTO;
/** Lo mismo para el período de la carga, que arranca en la semana. */
const periodoCargaDe = (crudo: string | null): PeriodoCarga => PERIODOS_CARGA.find((p) => p === crudo) ?? 'semana';

const decimalEs = (valor: number): string => valor.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const conValor = (indicador: Indicador | undefined, formato: (v: number) => string): string =>
  indicador?.valor == null ? SIN_DATO : formato(indicador.valor);

/** Errores que ya atiende el marco (diálogo de token, vuelta al ingreso): la pantalla no los repite. */
const loAtiendeElMarco = (error: unknown): boolean =>
  error instanceof ErrorApi && (error.codigo === 'token-vencido' || error.codigo === 'no-sesion');

/** Descarga un archivo con un enlace temporal. */
function descargar(archivo: Blob, nombre: string): void {
  const url = URL.createObjectURL(archivo);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PantallaMetricas() {
  const yo = useYo();
  // El marco solo muestra las pantallas con la persona cargada.
  return yo.data ? <Metricas yo={yo.data} /> : null;
}

function Metricas({ yo }: { yo: Yo }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(ref);
  const [params, setParams] = useSearchParams();
  const periodo = periodoDe(params.get('periodo'));
  const periodoCarga = periodoCargaDe(params.get('carga'));
  const [tabla, setTabla] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [fallaExcel, setFallaExcel] = useState(false);

  const catalogo = useCatalogo();
  const tareas = useTareas();
  const ajustes = useAjustes();
  const equipo = useEquipo();
  const pausas = usePausas();
  const feriados = useFeriados();
  // Se piden dos períodos: el actual y el anterior, para las variaciones.
  const horasEquipo = useHorasEquipo(periodo * 2);

  const hoy = hoyArgentina();
  const cat = catalogo.data;
  const lista = tareas.data?.tareas;
  const falla = [tareas, catalogo, ajustes, equipo, horasEquipo].find((c) => c.error && !loAtiendeElMarco(c.error));

  const metricas = useMemo(
    () => (cat && lista && horasEquipo.data ? calcularMetricas(lista, cat, horasEquipo.data.dias, periodo, hoy) : null),
    [cat, lista, horasEquipo.data, periodo, hoy],
  );
  // Los feriados no frenan el dibujo: mientras llegan, la capacidad va sin descontarlos.
  const diasFeriados = useMemo(() => new Set(feriados.data?.feriados.map((f) => f.fecha) ?? []), [feriados.data]);
  const feriadosHabiles = useMemo(() => feriadosDelPeriodo(diasFeriados, intervaloCarga(hoy, periodoCarga)), [diasFeriados, hoy, periodoCarga]);
  const integrantes = useMemo(
    () =>
      cat && lista && ajustes.data && equipo.data
        ? armarEquipo(cat, lista, equipo.data, ajustes.data.metricas, yo.id, hoy, null, periodoCarga, diasFeriados, pausas.data)
        : null,
    [cat, lista, ajustes.data, equipo.data, yo.id, hoy, periodoCarga, diasFeriados, pausas.data],
  );

  /** Cambia un parámetro de la dirección sin tocar los demás. */
  const fijarParametro = (clave: 'periodo' | 'carga', valor: string) => {
    const siguiente = new URLSearchParams(params);
    siguiente.set(clave, valor);
    setParams(siguiente);
  };
  const elegirPeriodo = (valor: string) => fijarParametro('periodo', valor);
  const elegirPeriodoCarga = (valor: PeriodoCarga) => fijarParametro('carga', valor);

  const nombrePersona = (id: number): string => cat?.personas.find((p) => p.id === id)?.nombre ?? `Persona ${id}`;
  const nombreProyecto = (id: number): string => cat?.proyectos.find((p) => p.id === id)?.nombre ?? `Proyecto ${id}`;

  /** Arma el libro con lo que hay en pantalla; la librería del Excel se carga recién acá. */
  const exportar = async () => {
    if (!metricas || !cat || !lista || !integrantes) return;
    setGenerando(true);
    setFallaExcel(false);
    try {
      const libro = await import('./excel/libro.js');
      const hojas = libro.libroMetricas({
        metricas, tareas: lista, catalogo: cat, integrantes, periodo, periodoCarga,
        restarReuniones: ajustes.data?.metricas.restarReuniones ?? false,
        hoy, generado: new Date(), nombreProyecto,
      });
      descargar(await libro.archivoExcel(hojas), libro.nombreExcel(periodo, hoy));
    } catch {
      setFallaExcel(true);
    } finally {
      setGenerando(false);
    }
  };

  const tonoProyecto = (id: number) => (ajustes.data?.estilos[id] ?? estiloPorDefecto(id)).color;
  // Mientras cargan los datos no se muestra «0»: no es un dato, es que todavía no hay.
  const cerradas = metricas?.completadas.valor ?? 0;
  const horasTrabajadas = metricas?.horasTrabajadas.valor ?? 0;
  const cerradasTexto = metricas ? numeroEs(cerradas) : SIN_DATO;
  const etiquetaActual = `Últimos ${periodo} días`;
  const etiquetaAnterior = `${periodo} días anteriores`;

  return (
    <div ref={ref} className="pantalla pantalla-metricas">
      <EncabezadoPantalla titulo="Métricas" subtitulo={`Cómo trabajó el equipo en los últimos ${periodo} días`}>
        <div className="metricas__barra">
          <div className="contadores" role="group" aria-label="Resumen del período">
            <Contador
              etiqueta="Completadas"
              valor={cerradasTexto}
              variacion={metricas && <Variacion valor={metricas.completadas.variacion} unidad="%" />}
            />
            <Contador
              etiqueta="A tiempo"
              valor={conValor(metricas?.aTiempo, (v) => `${v} %`)}
              variacion={metricas && <Variacion valor={metricas.aTiempo.variacion} unidad="pts" />}
            />
            <Contador
              etiqueta="Horas trabajadas"
              valor={conValor(metricas?.horasTrabajadas, (v) => `${numeroEs(v)} h`)}
              variacion={metricas && <Variacion valor={metricas.horasTrabajadas.variacion} unidad="%" />}
            />
            <Contador
              etiqueta="Tiempo de ciclo"
              valor={conValor(metricas?.cicloDias, (v) => `${decimalEs(v)} d`)}
              variacion={metricas && <Variacion valor={metricas.cicloDias.variacion} unidad="d" mejorSiBaja />}
            />
          </div>
          <div className="metricas__acciones" data-entra="pieza">
            <Segmentado etiqueta="Período" opciones={OPCIONES} valor={String(periodo)} onCambio={elegirPeriodo} />
            <Boton variante="secundario" icono={<Download />} onClick={() => void exportar()} disabled={!metricas || !integrantes || generando}>Descargar Excel</Boton>
          </div>
        </div>
      </EncabezadoPantalla>
      {fallaExcel && <Aviso tipo="error">No se pudo armar el Excel. Probá de nuevo.</Aviso>}
      {falla ? (
        <div className="metricas__falla">
          <Aviso tipo="error">{falla.error instanceof ErrorApi ? falla.error.mensaje : 'No se pudieron cargar las métricas.'}</Aviso>
          <Boton
            variante="secundario"
            onClick={() => void Promise.all([tareas.refetch(), catalogo.refetch(), ajustes.refetch(), equipo.refetch(), horasEquipo.refetch()])}
          >
            Reintentar
          </Boton>
        </div>
      ) : (
        <div className="metricas__grilla">
          <Vidrio as="section" className="metricas__tarjeta metricas__ritmo" aria-labelledby="metricas-ritmo">
            <header className="metricas__cabeza">
              <div>
                <h2 id="metricas-ritmo" className="tarjeta__titulo">Ritmo</h2>
                <p className="tarjeta__sub">Tareas cerradas por día</p>
              </div>
              <Boton variante="secundario" icono={<List />} aria-pressed={tabla} onClick={() => setTabla((t) => !t)}>Tabla</Boton>
            </header>
            <div className="metricas__total">
              <b className="tnum">{cerradasTexto}</b>
              <span>cerradas</span>
              {metricas && <Variacion valor={metricas.completadas.variacion} unidad="%" />}
              <small>{`frente a los ${periodo} días anteriores`}</small>
            </div>
            {metricas && !tabla && (
              <>
                <p className="metricas__leyenda">
                  <span><i className="metricas__marca metricas__marca--actual" aria-hidden="true" />{etiquetaActual}</span>
                  <span><i className="metricas__marca" aria-hidden="true" />{etiquetaAnterior}</span>
                </p>
                <LineaRitmo puntos={metricas.ritmo} etiquetaActual={etiquetaActual} etiquetaAnterior={etiquetaAnterior} formatoFecha={diaMesCorto} />
              </>
            )}
            {metricas && tabla && (
              <div className="metricas__tabla-caja">
                <table className="metricas__tabla">
                  <caption className="metricas__solo-lectores">{`Tareas cerradas por día, ${etiquetaActual.toLowerCase()} y ${etiquetaAnterior}`}</caption>
                  <thead>
                    <tr><th scope="col">Día</th><th scope="col">{etiquetaActual}</th><th scope="col">{etiquetaAnterior}</th></tr>
                  </thead>
                  <tbody>
                    {metricas.ritmo.map((p) => (
                      <tr key={p.fecha}>
                        <td>{diaMesCorto(p.fecha)}</td>
                        <td className="tnum">{numeroEs(p.actual)}</td>
                        <td className="tnum">{numeroEs(p.anterior)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Vidrio>

          <Vidrio as="section" className="metricas__tarjeta metricas__proyectos" aria-labelledby="metricas-proyectos">
            <header className="metricas__cabeza">
              <div>
                <h2 id="metricas-proyectos" className="tarjeta__titulo">Por proyecto</h2>
                <p className="tarjeta__sub">Adónde fue el trabajo cerrado</p>
              </div>
            </header>
            <div className="metricas__dona">
              <Dona
                leyenda="cerradas"
                total={cerradas}
                totalTexto={cerradasTexto}
                segmentos={(metricas?.porProyecto ?? []).map((p) => ({
                  valor: p.cantidad,
                  tono: tonoProyecto(p.proyectoId),
                  etiqueta: nombreProyecto(p.proyectoId),
                }))}
              />
            </div>
            <ul className="metricas__proyectos-lista">
              {(metricas?.porProyecto ?? []).map((p) => (
                <li key={p.proyectoId} className="metricas__proyecto">
                  <i className="metricas__punto" style={{ background: `var(--tono-${tonoProyecto(p.proyectoId)})` }} aria-hidden="true" />
                  <span className="metricas__proyecto-nombre">{nombreProyecto(p.proyectoId)}</span>
                  <b className="metricas__proyecto-cantidad tnum">{numeroEs(p.cantidad)}</b>
                  <span className="metricas__proyecto-porcentaje tnum">{`${p.porcentaje} %`}</span>
                </li>
              ))}
            </ul>
          </Vidrio>

          <Vidrio as="section" className="metricas__tarjeta metricas__horas" aria-labelledby="metricas-horas">
            <header className="metricas__cabeza">
              <div>
                <h2 id="metricas-horas" className="tarjeta__titulo">Horas trabajadas</h2>
                <p className="tarjeta__sub">Horas del equipo por día, cargadas en OpenProject</p>
              </div>
            </header>
            <p className="metricas__resumen tnum">
              {metricas ? `${numeroEs(horasTrabajadas)} horas · en promedio ${duracionTexto((horasTrabajadas * 3600) / periodo)} por día` : SIN_DATO}
            </p>
            {metricas && (
              <Barras
                barras={metricas.horasPorDia.map((d) => ({ etiqueta: diaMesCorto(d.fecha), valor: d.horas }))}
                formato={(v) => `${numeroEs(v)} h`}
                destacarUltima
              />
            )}
          </Vidrio>

          {metricas && (
            <RealEstimado datos={metricas.realEstimado} nombrePersona={nombrePersona} nombreProyecto={nombreProyecto} />
          )}

          {integrantes && <TarjetaCarga
            integrantes={integrantes}
            hoy={hoy}
            periodo={periodoCarga}
            feriados={feriadosHabiles}
            restarReuniones={ajustes.data?.metricas.restarReuniones ?? false}
            onCambioPeriodo={elegirPeriodoCarga}
          />}
        </div>
      )}
    </div>
  );
}
