import { useRef, useState } from 'react';
import { List, SquareKanban, MessageCircle, Plus, Video } from 'lucide-react';
import { TONOS } from '../../compartido/estilos.js';
import type { Persona, Presencia } from '../../compartido/tipos.js';
import { useEntradaEscalonada } from '../animaciones/entradas.js';
import { AnilloAvance } from '../graficos/AnilloAvance.js';
import { Anillos } from '../graficos/Anillos.js';
import { BarraCarga } from '../graficos/BarraCarga.js';
import { Barras } from '../graficos/Barras.js';
import { Dona } from '../graficos/Dona.js';
import { LineaRitmo } from '../graficos/LineaRitmo.js';
import { Avatar } from '../ui/Avatar.js';
import { Aviso } from '../ui/Aviso.js';
import { BarraProgreso } from '../ui/BarraProgreso.js';
import { Boton } from '../ui/Boton.js';
import { Contador } from '../ui/Contador.js';
import { Estrella } from '../ui/Estrella.js';
import { Pildora } from '../ui/Pildora.js';
import { Segmentado } from '../ui/Segmentado.js';
import { Variacion } from '../ui/Variacion.js';
import { Vidrio } from '../ui/Vidrio.js';
import { LineaDeTiempo } from '../linea/LineaDeTiempo.js';
import { BarraLateralMuestra, BarraSuperiorMuestra } from './MarcoMuestra.js';
import { CATALOGO_LINEA, DEPENDENCIAS_LINEA, FERIADOS_LINEA, FILAS_LINEA, HOY_LINEA, TAREAS_LINEA, VACACIONES_LINEA, VENTANA_LINEA } from './datosLinea.js';
import './muestras.css';

const persona = (id: number, nombre: string): Persona => ({ id, nombre, login: null, email: null, avatarUrl: null });
const EQUIPO = [persona(1, 'Ana Pereyra'), persona(2, 'Martín Gómez'), persona(3, 'Lucía Fernández'), persona(4, 'Daniel Ruiz')];
const YO = EQUIPO[0]!;

const PRESENCIAS: Presencia[] = ['conectado', 'trabajando', 'ausente', 'sin-opendash'];

const TAREAS = [
  { titulo: 'Revisar el alta de proveedores', proyecto: 'Portal de clientes', color: 'var(--tono-azul)', vence: 'Hoy' },
  { titulo: 'Probar la conciliación bancaria', proyecto: 'Migración del ERP', color: 'var(--tono-violeta)', vence: 'Hoy' },
  { titulo: 'Documentar la API de turnos', proyecto: 'Agenda de turnos', color: 'var(--tono-verde)', vence: 'Mañana' },
  { titulo: 'Ajustar permisos de stock', proyecto: 'Inventario', color: 'var(--tono-naranja)', vence: 'Jue 23' },
];

const DIAS = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'];
const RITMO = DIAS.map((fecha, i) => ({ fecha, actual: [2, 5, 3, 7, 4, 0, 6][i]!, anterior: [3, 2, 4, 4, 6, 1, 2][i]! }));
const DIA_CORTO = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
const formatoDia = (fecha: string) => DIA_CORTO.format(new Date(`${fecha}T12:00:00-03:00`));
const HORAS = [0.5, 1.5, 0, 2, 1, 0.8, 1.1].map((valor, i) => ({ etiqueta: formatoDia(DIAS[i]!).slice(0, 3), valor }));

const ESTADOS = [
  { nombre: 'Nuevo', color: 'var(--estado-nuevo)' },
  { nombre: 'En curso', color: 'var(--estado-curso)' },
  { nombre: 'En pausa', color: 'var(--estado-pausa)' },
  { nombre: 'Cerrado', color: 'var(--estado-cerrado)' },
];

function Muestra({ tema }: { tema: 'oscuro' | 'claro' }) {
  const [vista, setVista] = useState<'tablero' | 'lista'>('tablero');
  const [minutos, setMinutos] = useState<'15' | '25' | '50'>('25');
  const [fijado, setFijado] = useState(true);
  return (
    <section data-tema={tema} className="muestra" aria-label={`Tema ${tema}`}>
      <BarraLateralMuestra persona={YO} />
      <BarraSuperiorMuestra />
      <div className="muestra-principal">
        <header className="muestra-encabezado">
          <div className="muestra-encabezado__texto">
            <h1 className="titulo-pantalla">Buenas tardes, Ana</h1>
            <p className="subtitulo-pantalla">Lunes 19 de octubre · 3 reuniones y 5 tareas para hoy</p>
          </div>
          <div className="muestra-contadores">
            <Contador etiqueta="Hechas hoy" valor={2} total={8} />
            <Contador etiqueta="Foco hoy" valor="1,5 h" variacion={<Variacion valor={22} unidad="%" />} />
            <Contador etiqueta="Vencidas" valor={0} />
          </div>
          <div className="muestra-acciones">
            <Boton variante="secundario" icono={<Plus />}>Nueva tarea</Boton>
            <Boton variante="primario" icono={<Video />}>Próxima: 14:00</Boton>
          </div>
        </header>

        <div className="muestra-grilla">
          <Vidrio as="section" className="col-span-4 min-h-[323px]">
            <h2 className="tarjeta__titulo">Botones</h2>
            <p className="tarjeta__sub">Primario, secundario y fantasma</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Boton variante="primario" icono={<Plus />}>Crear</Boton>
              <Boton variante="secundario">Cancelar</Boton>
              <Boton variante="fantasma">Ver todo</Boton>
              <Boton variante="secundario" disabled>Desactivado</Boton>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Pildora color="var(--tono-azul)">Portal de clientes</Pildora>
              <Pildora color="var(--tono-rosa)">Turnero</Pildora>
              <Pildora color="var(--tono-naranja)">Inventario</Pildora>
              <Pildora>Sin proyecto</Pildora>
            </div>
          </Vidrio>

          <Vidrio as="section" className="col-span-4 min-h-[323px]">
            <div className="flex justify-between items-start">
              <h2 className="tarjeta__titulo">Equipo</h2>
              <Boton variante="fantasma">Calendario</Boton>
            </div>
            <div className="mt-4 flex items-center gap-3">
              {EQUIPO.map((p, i) => <Avatar key={p.id} persona={p} tamano={36} presencia={PRESENCIAS[i]} />)}
              <Avatar persona={null} tamano={36} />
            </div>
            <div className="mt-5 flex items-end gap-4">
              <Avatar persona={YO} tamano={96} enLinea />
              <Avatar persona={EQUIPO[1]!} tamano={48} />
              <Avatar persona={EQUIPO[2]!} tamano={28} />
              <Avatar persona={EQUIPO[3]!} tamano={22} />
            </div>
          </Vidrio>

          <Vidrio as="section" className="col-span-4 min-h-[323px]">
            <div className="flex justify-between items-start gap-3">
              <div>
                <h2 className="tarjeta__titulo">Foco</h2>
                <p className="tarjeta__sub">Controles y avisos</p>
              </div>
              <Segmentado
                tamano="chico"
                etiqueta="Duración"
                valor={minutos}
                onCambio={setMinutos}
                opciones={[{ valor: '15', etiqueta: '15m' }, { valor: '25', etiqueta: '25m' }, { valor: '50', etiqueta: '50m' }]}
              />
            </div>
            <div className="mt-5">
              <Segmentado
                etiqueta="Vista"
                valor={vista}
                onCambio={setVista}
                opciones={[{ valor: 'tablero', etiqueta: 'Tablero', icono: <SquareKanban /> }, { valor: 'lista', etiqueta: 'Lista', icono: <List /> }]}
              />
            </div>
            <div className="mt-5 grid gap-2.5">
              <Aviso tipo="error">No se pudo guardar: otra persona cambió la tarea.</Aviso>
              <Aviso tipo="info">Datos de hace 2 minutos; actualizando…</Aviso>
            </div>
          </Vidrio>

          <Vidrio as="section" className="col-span-5 min-h-[420px]">
            <h2 className="tarjeta__titulo">Mis tareas</h2>
            <p className="tarjeta__sub">Para hoy y atrasadas</p>
            <ul className="mt-3">
              {TAREAS.map((t, i) => (
                <li key={t.titulo} className="muestra-fila">
                  <span className="grid gap-1.5">
                    <b className="font-semibold">{t.titulo}</b>
                    <span className="flex items-center gap-2 text-mini text-texto-suave">
                      <Pildora color={t.color}>{t.proyecto}</Pildora>{t.vence}
                    </span>
                  </span>
                  <Avatar persona={EQUIPO[i % EQUIPO.length]!} tamano={22} />
                </li>
              ))}
            </ul>
          </Vidrio>

          <Vidrio as="section" className="col-span-7 min-h-[420px]">
            <h2 className="tarjeta__titulo">Estados y tonos</h2>
            <p className="tarjeta__sub">Columnas del tablero y colores de proyecto</p>
            <div className="mt-5 flex flex-wrap gap-5">
              {ESTADOS.map((e) => (
                <span key={e.nombre} className="flex items-center gap-2.5 font-[650]">
                  <i className="muestra-estado" style={{ background: e.color }} />{e.nombre}
                </span>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              {TONOS.map((t) => (
                <span key={t} className="muestra-tono" style={{ ['--t' as string]: `var(--tono-${t})` }} title={t} />
              ))}
            </div>
            <p className="mt-6 flex items-center gap-2 text-chico text-texto-suave">
              <MessageCircle size={15} aria-hidden="true" /> 3 comentarios · <span className="text-exito-texto font-[650]">+12 % que la semana pasada</span>
            </p>
            <div className="mt-6 grid max-w-[320px] gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-[650]">Portal de clientes</span>
                <Estrella activa={fijado} nombre="Portal de clientes" onCambio={setFijado} />
              </div>
              <BarraProgreso valor={5} maximo={8} tono="violeta" etiqueta="Avance de Portal de clientes" />
              <BarraProgreso valor={44} maximo={40} excedida etiqueta="Carga de Martín Gómez" />
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-chico">
                <Variacion valor={22} unidad="%" />
                <Variacion valor={-3} unidad="pts" />
                <Variacion valor={0.4} unidad="d" mejorSiBaja />
                <Variacion valor={-1.5} unidad="h" mejorSiBaja />
                <Variacion valor={null} unidad="%" />
              </p>
            </div>
          </Vidrio>

          <Vidrio as="section" className="col-span-12">
            <h2 className="tarjeta__titulo">Gráficos</h2>
            <p className="tarjeta__sub">Anillos, dona, línea de ritmo, barras y carga</p>
            <div className="mt-6 flex flex-wrap items-center gap-8">
              <Anillos
                anillos={[
                  { valor: 2, total: 8, tono: 'rosa', etiqueta: 'Tareas' },
                  { valor: 1.1, total: 2, tono: 'verde', etiqueta: 'Foco', unidad: 'h' },
                  { valor: 1, total: 3, tono: 'turquesa', etiqueta: 'Reuniones' },
                ]}
              />
              <AnilloAvance porcentaje={45} tono="violeta" etiqueta="Avance de Portal de clientes" />
              <Dona
                leyenda="tareas"
                total={12}
                segmentos={[
                  { valor: 5, tono: 'azul', etiqueta: 'Portal de clientes' },
                  { valor: 4, tono: 'violeta', etiqueta: 'Migración del ERP' },
                  { valor: 3, tono: 'naranja', etiqueta: 'Inventario' },
                ]}
              />
              <div className="grid w-[260px] gap-3">
                <BarraCarga horas={22} capacidad={40} />
                <BarraCarga horas={44} capacidad={40} />
              </div>
            </div>
            <div className="mt-8 grid gap-8 md:grid-cols-[1.4fr_1fr]">
              <LineaRitmo puntos={RITMO} etiquetaActual="Esta semana" etiquetaAnterior="Semana anterior" formatoFecha={formatoDia} />
              <Barras barras={HORAS} formato={(v) => `${v.toLocaleString('es-AR')} h`} destacarUltima />
            </div>
          </Vidrio>
        </div>
      </div>
    </section>
  );
}

// Línea de tiempo (boceto B), en los dos temas para compararla con el boceto.
function MuestraLinea({ tema }: { tema: 'oscuro' | 'claro' }) {
  return (
    <section data-tema={tema} className="muestra-linea" aria-label={`Línea de tiempo, tema ${tema}`}>
      <LineaDeTiempo
        filas={FILAS_LINEA}
        ventana={VENTANA_LINEA}
        zoom="mes"
        tareas={TAREAS_LINEA}
        dependencias={DEPENDENCIAS_LINEA}
        catalogo={CATALOGO_LINEA}
        hoy={HOY_LINEA}
        alAbrir={() => {}}
        feriados={FERIADOS_LINEA}
        vacaciones={VACACIONES_LINEA}
        alternarGrupo={() => {}} alternarTerminadas={() => {}}
      />
    </section>
  );
}

export function PantallaMuestras() {
  const raiz = useRef<HTMLDivElement>(null);
  useEntradaEscalonada(raiz);
  return (
    <div ref={raiz}>
      <Muestra tema="oscuro" />
      <Muestra tema="claro" />
      <MuestraLinea tema="oscuro" />
      <MuestraLinea tema="claro" />
    </div>
  );
}
