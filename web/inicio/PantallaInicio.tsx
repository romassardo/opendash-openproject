import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Catalogo, Yo } from '../../compartido/tipos.js';
import { ErrorApi } from '../api/cliente.js';
import { useAjustes, useCalendario, useCatalogo, useEquipo, useFeriados, useTareas, useYo } from '../api/consultas.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { diasEntre } from '../fechas.js';
import { EVENTO_NUEVA_TAREA } from '../marco/BarraSuperior.js';
import { EncabezadoPantalla } from '../marco/Encabezado.js';
import { useCompletarTarea } from '../tareas/CasillaTarea.js';
import { Aviso } from '../ui/Aviso.js';
import { duracionTexto, JORNADA_HORAS_DEFECTO } from '../../compartido/horas.js';
import { useHorasEnCurso } from '../horas/HorasProvider.js';
import { Boton } from '../ui/Boton.js';
import { Contador } from '../ui/Contador.js';
import { useHoy } from '../ui/hoy.js';
import { agendaDeHoy, resumenHoy, saludo, semanaEquipo, subtituloInicio } from './logica.js';
import { quienFalta } from './quienFalta.js';
import { TarjetaQuienFalta } from './TarjetaQuienFalta.js';
import { TarjetaTrabajando } from './TarjetaTrabajando.js';
import { BotonProxima, TarjetaHoy, TarjetaMisTareas, TarjetaProximo, TarjetaSemana } from './TarjetasInicio.js';
// Las filas de Mis tareas usan las piezas de Tareas (casilla, prioridad, fecha).
import '../tareas/tareas.css';
import './inicio.css';

const SIN_DATO = '–';
const SEG_HORA = 3600;
// Cada cuánto se revisa qué reunión está en curso mientras queden reuniones hoy.
const REFRESCO_RELOJ_MS = 30_000;

/** Errores que ya atiende el marco (diálogo de token, vuelta al ingreso): la pantalla no los repite. */
const loAtiendeElMarco = (error: unknown): boolean =>
  error instanceof ErrorApi && (error.codigo === 'token-vencido' || error.codigo === 'no-sesion');

export function PantallaInicio() {
  const yo = useYo();
  // El marco solo muestra las pantallas con la persona cargada.
  return yo.data ? <Inicio yo={yo.data} /> : null;
}

function Inicio({ yo }: { yo: Yo }) {
  const ref = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(ref);
  const tareas = useTareas();
  const catalogo = useCatalogo();
  // El reloj vivo: avanza cada segundo mientras corre el cronómetro.
  const { estado: horasEstado, totalHoySegundos } = useHorasEnCurso();
  const jornadaAjustes = useAjustes().data?.horas.jornadaHoras;
  const [aviso, setAviso] = useState<string | null>(null);
  const completador = useCompletarTarea(setAviso);
  const equipo = useEquipo();
  const feriados = useFeriados();

  const ahora = new Date();
  const hoy = useHoy();
  const calendario = useCalendario(hoy, hoy);
  const estadoCalendario = calendario.data?.estado ?? null;
  // Sin respuesta todavía (cargando) o con la consulta caída, no se sabe si hay calendario: no se lo ofrece.
  const cargaCalendario = calendario.data ? 'lista' : calendario.isError ? 'error' : 'cargando';
  const conectado = cargaCalendario === 'lista' && estadoCalendario !== null;
  const agenda = agendaDeHoy(calendario.data?.reuniones ?? [], hoy, ahora);
  const reunionesHoy = conectado ? agenda.reuniones.length : null;
  const quedan = agenda.actual !== null || agenda.siguiente !== null;
  const [, setTic] = useState(0);
  useEffect(() => {
    if (!quedan) return;
    const reloj = setInterval(() => setTic((n) => n + 1), REFRESCO_RELOJ_MS);
    return () => clearInterval(reloj);
  }, [quedan]);
  const lista = tareas.data?.tareas;
  const cat = catalogo.data;
  const resumen = lista && cat ? resumenHoy(lista, cat, yo.id, hoy) : null;
  const semana = lista && cat ? semanaEquipo(lista, cat, hoy) : null;
  const cargaFalta = equipo.data && cat && feriados.data ? 'lista'
    : (equipo.isError && !equipo.data) || (feriados.isError && !feriados.data) || (catalogo.isError && !cat) ? 'error' : 'cargando';
  const ausencias = quienFalta(hoy, equipo.data ?? [], cat?.personas ?? [], feriados.data?.feriados ?? [], yo.id);
  const horas = {
    horas: totalHoySegundos / SEG_HORA,
    meta: horasEstado ? horasEstado.jornadaSegundos / SEG_HORA : (jornadaAjustes ?? JORNADA_HORAS_DEFECTO),
  };
  const error = lista === undefined ? tareas.error : cat === undefined ? catalogo.error : null;
  const falla = error && !loAtiendeElMarco(error);
  const accion = {
    enVuelo: completador.enVuelo,
    completar: (...args: Parameters<typeof completador.completar>) => {
      setAviso(null);
      return completador.completar(...args);
    },
  };

  const pedirNuevaTarea = () => window.dispatchEvent(new Event(EVENTO_NUEVA_TAREA));

  return (
    <div ref={ref} className="pantalla pantalla-inicio">
      <EncabezadoPantalla
        titulo={saludo(yo.nombre, ahora)}
        subtitulo={resumen ? subtituloInicio(hoy, resumen.paraHoy, reunionesHoy) : 'Cargando tareas…'}
      >
        <div className="inicio__barra">
          <div className="contadores" role="group" aria-label="Resumen de hoy">
            <Contador etiqueta="Hechas hoy" valor={resumen?.hechas ?? SIN_DATO} total={resumen?.paraHoy} />
            <Contador etiqueta="Horas hoy" valor={duracionTexto(totalHoySegundos)} />
            <Contador etiqueta="Vencidas" valor={resumen?.vencidas ?? SIN_DATO} enlace="/para-ordenar" />
          </div>
          <div className="inicio__acciones" data-entra="pieza">
            <BotonProxima agenda={agenda} />
            <Boton variante="primario" icono={<Plus />} onClick={pedirNuevaTarea}>Nueva tarea</Boton>
          </div>
        </div>
      </EncabezadoPantalla>
      {falla ? (
        <div className="inicio__falla">
          <Aviso tipo="error">{error instanceof ErrorApi ? error.mensaje : 'No se pudo cargar Inicio.'}</Aviso>
          <Boton variante="secundario" onClick={() => void Promise.all([tareas.refetch(), catalogo.refetch()])}>Reintentar</Boton>
        </div>
      ) : (
        <div className="inicio__grilla">
          <TarjetaHoy hechas={resumen?.hechas ?? 0} paraHoy={resumen?.paraHoy ?? 0} horas={horas.horas} metaHoras={horas.meta}
            reuniones={conectado ? { pasadas: agenda.pasadas, total: agenda.reuniones.length } : undefined}
          />
          <TarjetaProximo agenda={agenda} carga={cargaCalendario} conectado={conectado} estado={estadoCalendario} ahora={ahora} />
          <TarjetaTrabajando tareas={lista ?? []} catalogo={cat ?? SIN_CATALOGO} usuarioId={yo.id} />
          <TarjetaMisTareas mias={resumen?.mias ?? []} catalogo={cat ?? SIN_CATALOGO} hoy={hoy} accion={accion} aviso={aviso} />
          <TarjetaSemana semana={semana ?? SEMANA_VACIA} indiceHoy={Math.max(0, diasEntre(semana?.dias[0]?.fecha ?? hoy, hoy))} />
          <TarjetaQuienFalta
            ausencias={ausencias}
            carga={cargaFalta}
            alReintentar={() => void Promise.all([equipo.refetch(), feriados.refetch(), catalogo.refetch()])}
          />
        </div>
      )}
    </div>
  );
}

const SIN_CATALOGO: Catalogo = { estados: [], tipos: [], prioridades: [], proyectos: [], versiones: [], personas: [], asignables: {}, semanaNoLaborable: [0, 6], diasNoLaborables: [], plantillasOp: [], plantillas: [], tablero: { nuevo: null, curso: null, pausa: null, cerrado: null } };
const SEMANA_VACIA = { dias: Array.from({ length: 7 }, () => ({ fecha: '', cantidad: 0 })), total: 0, anterior: 0, variacion: null };
