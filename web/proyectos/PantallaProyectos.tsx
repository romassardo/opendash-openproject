import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { estiloPorDefecto } from '../../compartido/estilos.js';
import type { Yo } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useAjustes, useCatalogo, useOpcionesNuevoProyecto, useTareas, useYo } from '../api/consultas.js';
import { useFijarProyecto } from '../api/mutaciones.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { hoyArgentina } from '../fechas.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { Contador } from '../ui/Contador.js';
import { Segmentado, type OpcionSegmentado } from '../ui/Segmentado.js';
import { contadoresProyectos, resumirProyecto, type ResumenProyecto } from './logica.js';
import { DialogoNuevoProyecto, puedeCrearProyecto } from './DialogoNuevoProyecto.js';
import { TarjetaProyecto } from './TarjetaProyecto.js';
// Los contadores del encabezado usan la fila de Tareas.
import '../tareas/tareas.css';
import './proyectos.css';

const SIN_DATO = '–';

type FiltroEstado = 'todos' | 'activos' | 'terminados';
const OPCIONES: OpcionSegmentado<FiltroEstado>[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'activos', etiqueta: 'Activos' },
  { valor: 'terminados', etiqueta: 'Terminados' },
];

const filtroDe = (crudo: string | null): FiltroEstado => (crudo === 'activos' || crudo === 'terminados' ? crudo : 'todos');
const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

/** Errores que ya atiende el marco (diálogo de token, vuelta al ingreso): la pantalla no los repite. */
const loAtiendeElMarco = (error: unknown): boolean =>
  error instanceof ErrorApi && (error.codigo === 'token-vencido' || error.codigo === 'no-sesion');

export function PantallaProyectos() {
  const yo = useYo();
  // El marco solo muestra las pantallas con la persona cargada.
  return yo.data ? <Proyectos yo={yo.data} /> : null;
}

function Proyectos({ yo }: { yo: Yo }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(ref);
  const catalogo = useCatalogo();
  const tareas = useTareas();
  const ajustes = useAjustes();
  const fijar = useFijarProyecto();
  const opciones = useOpcionesNuevoProyecto().data;
  const [creando, setCreando] = useState(false);
  const puedeCrear = opciones !== undefined && puedeCrearProyecto(opciones);
  const [params, setParams] = useSearchParams();
  const filtro = filtroDe(params.get('estado'));

  const hoy = hoyArgentina();
  const cat = catalogo.data;
  const lista = tareas.data?.tareas;
  const resumenes = useMemo<ResumenProyecto[] | null>(
    () => (cat && lista ? cat.proyectos.filter((p) => p.activo).map((p) => resumirProyecto(p, lista, cat, hoy)) : null),
    [cat, lista, hoy],
  );
  const cuentas = resumenes ? contadoresProyectos(resumenes, hoy) : null;
  const visibles = resumenes?.filter((r) => filtro === 'todos' || r.estado === (filtro === 'activos' ? 'activo' : 'terminado')) ?? [];
  const error = lista === undefined ? tareas.error : cat === undefined ? catalogo.error : null;
  const falla = error && !loAtiendeElMarco(error);

  const cambiarFiltro = (nuevo: FiltroEstado) => {
    const siguiente = new URLSearchParams(params);
    if (nuevo === 'todos') siguiente.delete('estado');
    else siguiente.set('estado', nuevo);
    setParams(siguiente);
  };

  return (
    <div ref={ref} className="pantalla pantalla-proyectos">
      <EncabezadoPantalla
        titulo="Proyectos"
        subtitulo={cuentas ? `${plural(cuentas.activos, 'activo', 'activos')} · ${plural(cuentas.terminados, 'terminado', 'terminados')}` : 'Cargando proyectos…'}
      >
        <div className="proyectos__barra">
          <div className="contadores" role="group" aria-label="Resumen de proyectos">
            <Contador etiqueta="Activos" valor={cuentas?.activos ?? SIN_DATO} />
            <Contador etiqueta="Terminados" valor={cuentas?.terminados ?? SIN_DATO} />
            <Contador etiqueta="En fecha" valor={cuentas ? (cuentas.enFecha === null ? '—' : `${cuentas.enFecha}%`) : SIN_DATO} />
            <Contador etiqueta="Vencen este mes" valor={cuentas?.vencenEsteMes ?? SIN_DATO} />
          </div>
          {puedeCrear && <Boton variante="primario" onClick={() => setCreando(true)}>Nuevo proyecto</Boton>}
          <div data-entra="pieza">
            <Segmentado opciones={OPCIONES} valor={filtro} onCambio={cambiarFiltro} etiqueta="Estado" />
          </div>
        </div>
      </EncabezadoPantalla>
      {creando && opciones !== undefined && <DialogoNuevoProyecto opciones={opciones} alCerrar={() => setCreando(false)} />}
      {fijar.isError && <Aviso tipo="error">No se pudo cambiar el fijado. Probá de nuevo.</Aviso>}
      {falla ? (
        <div className="proyectos__falla">
          <Aviso tipo="error">{error instanceof ErrorApi ? error.mensaje : 'No se pudieron cargar los proyectos.'}</Aviso>
          <Boton variante="secundario" onClick={() => void Promise.all([tareas.refetch(), catalogo.refetch()])}>Reintentar</Boton>
        </div>
      ) : (
        <div className="proyectos__grilla">
          {cat && visibles.map((resumen) => (
            <TarjetaProyecto
              key={resumen.proyecto.id}
              resumen={resumen}
              estilo={ajustes.data?.estilos[resumen.proyecto.id] ?? estiloPorDefecto(resumen.proyecto.id)}
              personas={cat.personas}
              hoy={hoy}
              fijado={yo.fijados.includes(resumen.proyecto.id)}
              onFijar={(fijado) => fijar.mutate({ proyectoId: resumen.proyecto.id, fijado })}
            />
          ))}
          {resumenes && visibles.length === 0 && <p className="proyectos__vacio">No hay proyectos para mostrar.</p>}
        </div>
      )}
    </div>
  );
}
