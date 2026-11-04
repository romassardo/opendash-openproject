import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Catalogo, Feriado, MiembroEquipo } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { AJUSTES, CATALOGO, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { archivoExcel, libroMetricas } from './excel/libro.js';

// El libro real arma el Excel con una librería pesada: aquí se simula y se mira qué recibe y qué se descarga.
vi.mock('./excel/libro.js', () => ({
  libroMetricas: vi.fn(() => []),
  archivoExcel: vi.fn(async () => new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
  nombreExcel: (periodo: number, hoy: string) => `opendash-metricas-${periodo}d-${hoy}.xlsx`,
}));

// Martes 20 de octubre de 2026.
const AHORA = new Date('2026-10-20T15:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: AHORA });
});

afterEach(() => {
  cleanup();
  limpiarEntorno();
  vi.useRealTimers();
});

const CAT: Catalogo = CATALOGO;
const MIEMBROS: MiembroEquipo[] = [
  { personaId: 9, presencia: 'conectado', rol: 'Líder de producto', capacidadHoras: 40, trabajandoEn: [], vacaciones: [], reunionesPorSemana: null },
  { personaId: 5, presencia: 'conectado', rol: 'Desarrollo', capacidadHoras: 8, trabajandoEn: [], vacaciones: [], reunionesPorSemana: null },
];
// Cerradas: una ayer (a tiempo), una el 5 de octubre (tarde) y una de septiembre (fuera de los 30 días).
const TAREAS = [
  tareaDe(1, { titulo: 'Relevamiento', proyectoId: 11, responsableId: 9, estadoId: 12, fin: '2026-10-19', cerradaEl: '2026-10-19T14:00:00Z' }),
  tareaDe(2, { titulo: 'Cobranzas', proyectoId: 12, responsableId: 5, estadoId: 12, fin: '2026-10-01', cerradaEl: '2026-10-05T14:00:00Z' }),
  tareaDe(3, { titulo: 'Vieja', proyectoId: 11, responsableId: 9, estadoId: 12, cerradaEl: '2026-09-10T14:00:00Z' }),
  // Larga: 7 sep al 30 oct, 80 h en 8 semanas = 10 h por semana; en curso, así que suma 10 h esta semana.
  tareaDe(4, { titulo: 'Migración de datos', proyectoId: 12, responsableId: 5, estadoId: 7, inicio: '2026-09-07', fin: '2026-10-30', estimacionHoras: 80 }),
  tareaDe(5, { titulo: 'Corta', proyectoId: 11, responsableId: 9, estadoId: 7, estimacionHoras: 5 }),
];
// Dos horas trabajadas ayer.
const HORAS = { dias: [{ usuarioId: 9, dia: '2026-10-19', segundos: 7200 }], enMarcha: [] };

interface Extras { feriados?: Feriado[]; miembros?: MiembroEquipo[]; restarReuniones?: boolean }

async function abrir(ruta = '/metricas', tareas = TAREAS, { feriados = [], miembros = MIEMBROS, restarReuniones = false }: Extras = {}) {
  prepararEntorno(ruta);
  const api = simularApi({
    'GET /api/catalogo': ok(CAT),
    'GET /api/tareas': ok({ tareas, dependencias: [] }),
    'GET /api/equipo': ok(miembros),
    'GET /api/horas/equipo': ok(HORAS),
    'GET /api/feriados': ok({ feriados, actualizado: null }),
    'GET /api/ajustes': ok({ ...AJUSTES, metricas: { ...AJUSTES.metricas, restarReuniones } }),
  });
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Métricas' });
  await screen.findByRole('heading', { level: 2, name: 'Carga' });
  await waitFor(() => expect(contador('Completadas')).not.toHaveTextContent('–'));
  return { api, usuario: userEvent.setup({ advanceTimers: () => {} }) };
}

const contador = (etiqueta: string) => screen.getByText(etiqueta, { selector: 'dt' }).closest('dl')!;
const tarjeta = (titulo: string) => screen.getByRole('heading', { level: 2, name: titulo }).closest('section, article') as HTMLElement;
type Dentro = ReturnType<typeof within>;
const fila = (carga: Dentro, nombre: string) => carga.getByRole('button', { name: new RegExp(nombre) }).closest('li') as HTMLElement;
const totales = (carga: Dentro) =>
  within(carga.getByRole('list', { name: 'Total del equipo' })).getAllByRole('listitem').map((i) => i.textContent);

describe('Pantalla Métricas', () => {
  it('mientras cargan las tareas, los contadores y totales muestran «–» y no «0»', async () => {
    prepararEntorno('/metricas');
    simularApi({
      'GET /api/catalogo': ok(CAT),
      'GET /api/tareas': ok({ tareas: TAREAS, dependencias: [] }),
      'GET /api/equipo': ok(MIEMBROS),
      'GET /api/horas/equipo': ok(HORAS),
    });
    // Se retiene la lectura de tareas hasta soltarla.
    const real = fetch;
    let soltar: () => void = () => {};
    const compuerta = new Promise<void>((resolver) => { soltar = resolver; });
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) =>
      String(entrada).includes('/api/tareas') ? compuerta.then(() => real(entrada, init)) : real(entrada, init));
    const { container } = render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Métricas' });
    expect(contador('Completadas')).toHaveTextContent(/^Completadas–/);
    expect(container.querySelector('.metricas__total b')).toHaveTextContent('–');
    expect(container.querySelector('.grafico-dona__centro b')).toHaveTextContent('–');
    expect(container.querySelector('.metricas__resumen')).toHaveTextContent('–');
    expect(container.querySelector('.metricas__resumen')).not.toHaveTextContent('0 horas');
    soltar();
    await waitFor(() => expect(contador('Completadas')).toHaveTextContent(/^Completadas2/));
    expect(container.querySelector('.metricas__total b')).toHaveTextContent('2');
  });

  it('cambiar a 7 días recalcula los contadores', async () => {
    const { usuario } = await abrir();
    expect(screen.getByText('Cómo trabajó el equipo en los últimos 30 días')).toBeInTheDocument();
    expect(contador('Completadas')).toHaveTextContent(/^Completadas2/);
    expect(contador('A tiempo')).toHaveTextContent('50 %');
    expect(contador('Horas trabajadas')).toHaveTextContent('2 h');
    await usuario.click(screen.getByRole('radio', { name: '7 d' }));
    await waitFor(() => expect(contador('Completadas')).toHaveTextContent(/^Completadas1/));
    expect(contador('A tiempo')).toHaveTextContent('100 %');
    expect(window.location.search).toBe('?periodo=7');
    expect(screen.getByText('Cómo trabajó el equipo en los últimos 7 días')).toBeInTheDocument();
  });

  it('el período sale de la dirección', async () => {
    await abrir('/metricas?periodo=7');
    expect(screen.getByRole('radio', { name: '7 d' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Tabla muestra los mismos datos que el gráfico', async () => {
    const { usuario } = await abrir();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Tabla' }));
    const tabla = screen.getByRole('table', { name: /Tareas cerradas por día/ });
    const filas = within(tabla).getAllByRole('row');
    // Encabezado más una fila por día.
    expect(filas).toHaveLength(31);
    const ayer = filas.find((f) => within(f).queryByText('19 oct'));
    expect(ayer).toBeDefined();
    expect(within(ayer!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['19 oct', '1', '0']);
    const cierres = filas.slice(1).reduce((total, f) => total + Number(within(f).getAllByRole('cell')[1]!.textContent), 0);
    expect(cierres).toBe(2);
    await usuario.click(screen.getByRole('button', { name: 'Tabla' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('Descargar Excel arma el libro del período y baja el archivo', async () => {
    const { usuario } = await abrir('/metricas?periodo=7');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:xlsx'), revokeObjectURL: vi.fn() }));
    const descargas: string[] = [];
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      descargas.push(`${this.download}|${this.href}`);
    });
    await usuario.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    await waitFor(() => expect(descargas).toEqual(['opendash-metricas-7d-2026-10-20.xlsx|blob:xlsx']));
    expect(vi.mocked(libroMetricas)).toHaveBeenCalledWith(
      expect.objectContaining({ periodo: 7, periodoCarga: 'semana', hoy: '2026-10-20', restarReuniones: false, tareas: TAREAS, generado: AHORA }),
    );
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).not.toBeInTheDocument();
    clic.mockRestore();
  });

  it('si el Excel falla avisa del error y el botón vuelve a estar disponible', async () => {
    const { usuario } = await abrir();
    vi.mocked(archivoExcel).mockRejectedValueOnce(new Error('boom'));
    await usuario.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo armar el Excel. Probá de nuevo.');
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeEnabled();
  });

  it('mientras se arma el Excel el botón queda deshabilitado', async () => {
    const { usuario } = await abrir();
    let soltar: (b: Blob) => void = () => {};
    vi.mocked(archivoExcel).mockReturnValueOnce(new Promise<Blob>((r) => { soltar = r; }));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:xlsx'), revokeObjectURL: vi.fn() }));
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await usuario.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeDisabled();
    soltar(new Blob(['x']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeEnabled());
    clic.mockRestore();
  });

  it('el botón de Excel está deshabilitado mientras no hay métricas ni equipo', async () => {
    prepararEntorno('/metricas');
    simularApi({
      'GET /api/catalogo': ok(CAT),
      'GET /api/tareas': ok({ tareas: TAREAS, dependencias: [] }),
      'GET /api/equipo': ok(MIEMBROS),
      'GET /api/horas/equipo': ok(HORAS),
    });
    const real = fetch;
    let soltar: () => void = () => {};
    const compuerta = new Promise<void>((resolver) => { soltar = resolver; });
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) =>
      String(entrada).includes('/api/equipo') ? compuerta.then(() => real(entrada, init)) : real(entrada, init));
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Métricas' });
    await waitFor(() => expect(contador('Completadas')).not.toHaveTextContent('–'));
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeDisabled();
    soltar();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeEnabled());
  });

  it('la carga marca a quien se pasa y despliega sus tareas largas', async () => {
    const { usuario } = await abrir();
    const carga = within(tarjeta('Carga'));
    expect(carga.getByText('1 por encima de su capacidad')).toBeInTheDocument();
    // Martín: 10 h de la larga contra una capacidad de 8 h.
    expect(carga.getByRole('meter', { name: '10 h de 8 h, excedida' })).toBeInTheDocument();
    expect(carga.getByText('2 tareas abiertas')).toBeInTheDocument();
    expect(carga.queryByText('Migración de datos')).not.toBeInTheDocument();
    const fila = carga.getByRole('button', { name: /Martín Gómez/ });
    expect(fila).toHaveAttribute('aria-expanded', 'false');
    await usuario.click(fila);
    expect(fila).toHaveAttribute('aria-expanded', 'true');
    expect(carga.getByText('Migración de datos')).toBeInTheDocument();
    expect(carga.getByText('7 sept – 30 oct')).toBeInTheDocument();
    expect(carga.getByText('semana 7 de 8 · 10 h por semana')).toBeInTheDocument();
    await usuario.click(fila);
    expect(carga.queryByText('Migración de datos')).not.toBeInTheDocument();
  });

  it('con todos dentro de su capacidad lo dice', async () => {
    await abrir('/metricas', [TAREAS[0]!, TAREAS[4]!]);
    expect(await screen.findByText('Todos dentro de su capacidad')).toBeInTheDocument();
  });

  it('la carga arranca en la semana con el total del equipo y las horas libres de cada uno', async () => {
    await abrir();
    const carga = within(tarjeta('Carga'));
    expect(carga.getByRole('radio', { name: 'Semana' })).toHaveAttribute('aria-checked', 'true');
    expect(carga.getByText('Horas estimadas de esta semana (19 – 23 oct) contra la capacidad')).toBeInTheDocument();
    // Ana: 5 h de la corta en curso contra 40 h. Martín: 10 h de la larga contra 8 h.
    expect(carga.getByText('Todo el equipo · 2 personas')).toBeInTheDocument();
    expect(totales(carga)).toEqual(['15 h asignadas', '48 h de capacidad', '35 h libres']);
    expect(within(fila(carga, 'Ana')).getByText('35 h libres')).toBeInTheDocument();
    expect(within(fila(carga, 'Martín')).getByText('2 h de más')).toBeInTheDocument();
  });

  it('la quincena duplica la capacidad y suma las dos semanas de la tarea larga', async () => {
    const { usuario } = await abrir();
    const carga = within(tarjeta('Carga'));
    await usuario.click(carga.getByRole('radio', { name: 'Quincena' }));
    expect(await carga.findByText('Horas estimadas de esta semana y la próxima (19 – 30 oct) contra la capacidad')).toBeInTheDocument();
    expect(carga.getByRole('meter', { name: '20 h de 16 h, excedida' })).toBeInTheDocument();
    expect(within(fila(carga, 'Martín')).getByText('4 h de más')).toBeInTheDocument();
    expect(within(fila(carga, 'Ana')).getByText('75 h libres')).toBeInTheDocument();
    expect(totales(carga)).toEqual(['25 h asignadas', '96 h de capacidad', '75 h libres']);
    expect(window.location.search).toBe('?carga=quincena');
  });

  it('el período de la carga sale de la dirección', async () => {
    await abrir('/metricas?carga=mes');
    const carga = within(tarjeta('Carga'));
    expect(carga.getByRole('radio', { name: 'Mes' })).toHaveAttribute('aria-checked', 'true');
    expect(carga.getByText('Horas estimadas de las próximas 4 semanas (19 oct – 13 nov) contra la capacidad')).toBeInTheDocument();
    expect(carga.getByText('Todos dentro de su capacidad')).toBeInTheDocument();
    expect(totales(carga)).toEqual(['25 h asignadas', '192 h de capacidad', '167 h libres']);
  });

  describe('con feriados, vacaciones y reuniones', () => {
    const feriado = (fecha: string): Feriado => ({ fecha, nombre: 'Feriado', puente: false, manual: false });

    it('el subtítulo de Carga avisa el feriado de la semana', async () => {
      await abrir('/metricas', TAREAS, { feriados: [feriado('2026-10-19')] });
      expect(await within(tarjeta('Carga')).findByText('Horas estimadas de esta semana (19 – 23 oct · feriado el lunes) contra la capacidad')).toBeInTheDocument();
      // 40 h menos el lunes y 8 h menos el lunes: 32 + 6,4 = 38,4 h.
      expect(totales(within(tarjeta('Carga')))[1]).toBe('38,4 h de capacidad');
    });

    it('en quincena dice la fecha del feriado y con dos los cuenta', async () => {
      await abrir('/metricas?carga=quincena', TAREAS, { feriados: [feriado('2026-10-26')] });
      expect(await within(tarjeta('Carga')).findByText('Horas estimadas de esta semana y la próxima (19 – 30 oct · feriado el 26 oct) contra la capacidad')).toBeInTheDocument();
      cleanup();
      limpiarEntorno();
      await abrir('/metricas?carga=quincena', TAREAS, { feriados: [feriado('2026-10-26'), feriado('2026-10-30')] });
      expect(await within(tarjeta('Carga')).findByText('Horas estimadas de esta semana y la próxima (19 – 30 oct · 2 feriados) contra la capacidad')).toBeInTheDocument();
    });

    it('en el mes un solo feriado lleva su fecha', async () => {
      await abrir('/metricas?carga=mes', TAREAS, { feriados: [feriado('2026-11-09'), feriado('2026-11-14')] });
      expect(await within(tarjeta('Carga')).findByText('Horas estimadas de las próximas 4 semanas (19 oct – 13 nov · feriado el 9 nov) contra la capacidad')).toBeInTheDocument();
    });

    it('con la opción prendida dice menos reuniones y las horas de cada uno', async () => {
      const miembros: MiembroEquipo[] = [
        { ...MIEMBROS[0]!, reunionesPorSemana: { '2026-10-19': 6 } },
        { ...MIEMBROS[1]!, reunionesPorSemana: 'sin-calendario' },
      ];
      await abrir('/metricas', TAREAS, { miembros, restarReuniones: true });
      const carga = within(tarjeta('Carga'));
      expect(await carga.findByText('Horas estimadas de esta semana (19 – 23 oct) contra la capacidad menos reuniones')).toBeInTheDocument();
      expect(within(fila(carga, 'Ana')).getByText('Líder de producto · 6 h de reuniones')).toBeInTheDocument();
      expect(within(fila(carga, 'Martín')).getByText('Desarrollo · sin calendario')).toBeInTheDocument();
      // 40 h menos 6 h de reunión; Martín no resta nada.
      expect(totales(carga)[1]).toBe('42 h de capacidad');
    });

    it('con la opción apagada no habla de reuniones', async () => {
      const miembros: MiembroEquipo[] = [{ ...MIEMBROS[0]!, reunionesPorSemana: null }, MIEMBROS[1]!];
      await abrir('/metricas', TAREAS, { miembros });
      const carga = within(tarjeta('Carga'));
      expect(carga.queryByText(/reuniones/)).not.toBeInTheDocument();
      expect(within(fila(carga, 'Ana')).getByText('Líder de producto')).toBeInTheDocument();
    });

    it('la fila dice las vacaciones dentro del período', async () => {
      const miembros: MiembroEquipo[] = [
        { ...MIEMBROS[0]!, vacaciones: [{ desde: '2026-10-28', hasta: '2026-11-03' }] },
        { ...MIEMBROS[1]!, vacaciones: [{ desde: '2026-11-02', hasta: '2026-11-06' }] },
      ];
      await abrir('/metricas?carga=mes', TAREAS, { miembros });
      const carga = within(tarjeta('Carga'));
      expect(await carga.findByText('Líder de producto · de vacaciones 28 oct – 3 nov')).toBeInTheDocument();
      expect(carga.getByText('Desarrollo · de vacaciones 2 – 6 nov')).toBeInTheDocument();
      // Ana pierde 5 días de 8 h; Martín, 5 días de 1,6 h.
      expect(totales(carga)[1]).toBe('144 h de capacidad');
    });
  });

  it('un período de carga desconocido en la dirección vale la semana', async () => {
    await abrir('/metricas?carga=anio');
    expect(within(tarjeta('Carga')).getByRole('radio', { name: 'Semana' })).toHaveAttribute('aria-checked', 'true');
  });

  it('por proyecto cuenta las cerradas del período con su porcentaje', async () => {
    await abrir();
    const proyectos = within(tarjeta('Por proyecto'));
    expect(proyectos.getByRole('img', { name: /2 cerradas/ })).toBeInTheDocument();
    const filas = proyectos.getAllByRole('listitem');
    expect(filas.map((i) => i.querySelector('.metricas__proyecto-nombre')?.textContent)).toEqual(['Portal de clientes', 'Migración del ERP']);
    expect(filas.map((i) => i.querySelector('.metricas__proyecto-cantidad')?.textContent)).toEqual(['1', '1']);
    expect(filas.map((i) => i.querySelector('.metricas__proyecto-porcentaje')?.textContent)).toEqual(['50 %', '50 %']);
  });

  it('las horas trabajadas muestran el total y el promedio por día', async () => {
    await abrir();
    expect(screen.getByText('2 horas · en promedio 4 m por día')).toBeInTheDocument();
  });

  it('sin cierres en el período muestra 0 y la variación —', async () => {
    await abrir('/metricas', [TAREAS[3]!, TAREAS[4]!]);
    expect(contador('Completadas')).toHaveTextContent(/^Completadas0—/);
    expect(contador('A tiempo')).toHaveTextContent('–');
    expect(contador('Tiempo de ciclo')).toHaveTextContent('–');
  });

  it('trabajado contra estimado por persona y proyecto, con el cociente y la leyenda', async () => {
    const con = [
      tareaDe(21, { proyectoId: 11, responsableId: 9, estadoId: 12, cerradaEl: '2026-10-19T14:00:00Z', estimacionHoras: 2, horasReales: 3 }),
      tareaDe(22, { proyectoId: 11, responsableId: 9, estadoId: 12, cerradaEl: '2026-10-19T15:00:00Z', estimacionHoras: 4, horasReales: 4 }),
    ];
    const { usuario } = await abrir('/metricas', con);
    const real = tarjeta('Trabajado contra estimado');
    expect(within(real).getByRole('img', { name: /Ana Pereyra: 7 h trabajadas de 6 h estimadas, ×1,17/ })).toBeInTheDocument();
    expect(within(real).getByText('×1,17')).toBeInTheDocument();
    // La leyenda explica los tres colores de las barras y el cociente.
    const leyenda = real.querySelector<HTMLElement>('.real-estimado__leyenda')!;
    expect(leyenda).toHaveTextContent('Estimado');
    expect(leyenda).toHaveTextContent('Trabajado');
    expect(leyenda).toHaveTextContent('Se pasó');
    expect(leyenda).toHaveTextContent('× = trabajado ÷ estimado');
    // Real mayor que lo estimado: la barra real y el cociente llevan la marca de «pasado».
    const grafico = within(real).getByRole('img', { name: /Ana Pereyra/ });
    expect(grafico.querySelector('.real-estimado__real')).toHaveAttribute('data-pasado', 'true');
    expect(within(real).getByText('×1,17')).toHaveAttribute('data-pasado', 'true');
    await usuario.click(within(real).getByRole('radio', { name: 'Por proyecto' }));
    expect(within(real).getByRole('img', { name: /Portal de clientes: 7 h trabajadas de 6 h estimadas, ×1,17/ })).toBeInTheDocument();
  });

  it('trabajado contra estimado sin tareas con estimación y horas dice que no hay datos', async () => {
    await abrir();
    expect(tarjeta('Trabajado contra estimado').querySelector('.real-estimado__leyenda')).toBeNull();
    expect(within(tarjeta('Trabajado contra estimado')).getByText('Ninguna tarea cerrada del período tiene horas estimadas y trabajadas.')).toBeInTheDocument();
  });
});
