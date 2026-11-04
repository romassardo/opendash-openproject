import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import { falla, limpiarEntorno, ok, prepararEntorno, simularApi, type Llamada, type Manejador } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { CLAVES, type ListaTareas } from '../api/consultas.js';
import { MSG_CONFLICTO } from '../tareas/acciones.js';
import { MS_AVISO, ProveedorAvisos, useAvisoActual } from '../ui/avisos.js';
import { calendarioDe } from '../../compartido/calendarioOp.js';
import { finConPausa, finSinPausa, type Pausa } from '../../compartido/pausas.js';
import { MSG_SIN_PERMISO_CREAR } from './aplicar.js';
import { useCambiosLinea } from './useCambiosLinea.js';

// Un servidor simulado con memoria: lo que se guarda es lo que vuelve a pedir la web.
interface Servidor {
  tareas: Map<number, Tarea>;
  dependencias: Dependencia[];
  orden: Record<string, number[]>;
  /** Para simular lo que hace OpenProject al guardar (reprogramar automáticas, por ejemplo). */
  trasGuardar?: (servidor: Servidor, id: number) => void;
  patch?: Map<number, Manejador>;
  /** Respuesta forzada del alta (`POST /api/tareas`); sin ella, crea la tarea 900. */
  alta?: ReturnType<typeof falla>;
  /** Pausas guardadas, como en la base de OpenDash. */
  pausas?: Pausa[];
}

function montar(tareas: Tarea[], dependencias: Dependencia[] = [], extra: Partial<Servidor> = {}) {
  const servidor: Servidor = { tareas: new Map(tareas.map((t) => [t.id, t])), dependencias: [...dependencias], orden: {}, ...extra };
  const rutas: Record<string, Manejador> = {
    'GET /api/tareas': () => ok({ tareas: [...servidor.tareas.values()], dependencias: servidor.dependencias }),
    'GET /api/linea/orden': () => ok(servidor.orden),
  };
  for (const t of tareas) {
    rutas[`PATCH /api/tareas/${t.id}`] = (cuerpo) => {
      const forzada = servidor.patch?.get(t.id);
      if (forzada) return typeof forzada === 'function' ? forzada(cuerpo) : forzada;
      const { cambios } = cuerpo as { lockVersion: number; cambios: Record<string, unknown> };
      const actual = servidor.tareas.get(t.id)!;
      const fecha = cambios.fecha as string | null | undefined;
      const nueva: Tarea = {
        ...actual,
        ...(fecha !== undefined && { inicio: fecha, fin: fecha }),
        ...('inicio' in cambios && { inicio: cambios.inicio as string | null }),
        ...('fin' in cambios && { fin: cambios.fin as string | null }),
        ...('programacionManual' in cambios && { programacionManual: cambios.programacionManual as boolean }),
        lockVersion: actual.lockVersion + 1,
      };
      servidor.tareas.set(t.id, nueva);
      servidor.trasGuardar?.(servidor, t.id);
      return ok(servidor.tareas.get(t.id));
    };
    rutas[`POST /api/tareas/${t.id}/dependencias`] = (cuerpo) => {
      const { esperaA, retraso } = cuerpo as { esperaA: number; retraso?: number };
      const dep: Dependencia = { id: 100 + servidor.dependencias.length, sucesoraId: t.id, predecesoraId: esperaA, lag: retraso ?? 0 };
      servidor.dependencias = [...servidor.dependencias, dep];
      // Como OpenProject: la sucesora pasa a automática.
      servidor.tareas.set(t.id, { ...servidor.tareas.get(t.id)!, programacionManual: false });
      return ok(dep);
    };
  }
  for (const d of dependencias) {
    rutas[`DELETE /api/dependencias/${d.id}`] = () => {
      servidor.dependencias = servidor.dependencias.filter((x) => x.id !== d.id);
      return ok(null);
    };
  }
  for (const id of [100, 101, 102]) {
    rutas[`DELETE /api/dependencias/${id}`] = () => {
      servidor.dependencias = servidor.dependencias.filter((x) => x.id !== id);
      return ok(null);
    };
  }
  rutas['POST /api/tareas'] = (cuerpo) => {
    if (servidor.alta) return servidor.alta;
    const nueva = tareaDe(900, { ...(cuerpo as Partial<Tarea>), lockVersion: 0 });
    servidor.tareas.set(nueva.id, nueva);
    return ok(nueva);
  };
  // Pausas: el servidor corre el fin los días hábiles de la pausa (y al quitarla lo devuelve).
  const cal = calendarioDe({ semanaNoLaborable: [0, 6], diasNoLaborables: [] });
  for (const t of tareas) {
    rutas[`POST /api/tareas/${t.id}/pausas`] = (cuerpo) => {
      const { despues, dias } = cuerpo as { lockVersion: number; despues: number; dias: number };
      const actual = servidor.tareas.get(t.id)!;
      const tarea: Tarea = { ...actual, fin: finConPausa(actual.fin!, dias, cal), lockVersion: actual.lockVersion + 1 };
      const pausa: Pausa = { id: 500 + (servidor.pausas?.length ?? 0), tareaId: t.id, despues, dias };
      servidor.tareas.set(t.id, tarea);
      servidor.pausas = [...(servidor.pausas ?? []), pausa];
      return ok({ tarea, pausa });
    };
  }
  for (const id of [500, 501]) {
    rutas[`DELETE /api/pausas/${id}`] = () => {
      const pausa = servidor.pausas?.find((p) => p.id === id);
      if (!pausa) return falla(404, 'no-encontrado', 'Esa pausa ya no existe');
      const actual = servidor.tareas.get(pausa.tareaId)!;
      const fin = finSinPausa(actual.inicio!, actual.fin!, servidor.pausas!.filter((p) => p.tareaId === pausa.tareaId), id, cal);
      const tarea: Tarea = { ...actual, fin: fin ?? actual.fin, lockVersion: actual.lockVersion + 1 };
      servidor.tareas.set(tarea.id, tarea);
      servidor.pausas = servidor.pausas!.filter((p) => p.id !== id);
      return ok({ tarea });
    };
  }
  rutas['DELETE /api/tareas/900'] = () => {
    servidor.tareas.delete(900);
    return ok(null);
  };
  for (const c of ['11:0', '11:50']) {
    rutas[`PUT /api/linea/orden/${c}`] = (cuerpo) => {
      servidor.orden = { ...servidor.orden, [c]: (cuerpo as { ids: number[] }).ids };
      return ok({ contenedor: c, ids: (cuerpo as { ids: number[] }).ids });
    };
  }
  const api = simularApi(rutas);
  return { servidor, api };
}

const patches = (api: { llamadas: Llamada[] }) => api.llamadas.filter((l) => l.metodo === 'PATCH');
const llamadas = (api: { llamadas: Llamada[] }, metodo: string, ruta: string) => api.llamadas.filter((l) => l.metodo === metodo && l.ruta === ruta);

let cliente: QueryClient;
const envoltura = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={cliente}><ProveedorAvisos>{children}</ProveedorAvisos></QueryClientProvider>
);

/** Los gestos de la línea más el aviso flotante que dejaron publicado (con la forma que tenía antes). */
function useLineaConAviso(vacacionesDe: (t: Tarea) => string | null) {
  const cambios = useCambiosLinea(vacacionesDe);
  const actual = useAvisoActual();
  const aviso = actual === null ? null : {
    id: actual.id, texto: actual.texto, error: actual.error ?? false, vacaciones: actual.detalle ?? null, deshacible: actual.accion !== undefined,
  };
  return { ...cambios, aviso };
}

async function cargar(servidor: Servidor, vacacionesDe: (t: Tarea) => string | null = () => null) {
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cliente.setQueryData<ListaTareas>(CLAVES.tareas, { tareas: [...servidor.tareas.values()], dependencias: servidor.dependencias });
  const vista = renderHook(() => useLineaConAviso(vacacionesDe), { wrapper: envoltura });
  // El catálogo llega por la API simulada.
  await waitFor(() => expect(cliente.getQueryData(CLAVES.catalogo)).toBeDefined());
  return vista;
}

beforeEach(() => prepararEntorno('/linea-de-tiempo'));
afterEach(() => {
  cleanup();
  limpiarEntorno();
  vi.useRealTimers();
});

// Cadena A -> B -> C de lunes a viernes: mover A un día pisa a B y C (todas manuales).
const A = tareaDe(1, { titulo: 'A', inicio: '2026-10-20', fin: '2026-10-21' });
const B = tareaDe(2, { titulo: 'B', inicio: '2026-10-22', fin: '2026-10-23' });
const C = tareaDe(3, { titulo: 'C', inicio: '2026-10-26', fin: '2026-10-27' });
const D1: Dependencia = { id: 1, predecesoraId: 1, sucesoraId: 2, lag: 0 };
const D2: Dependencia = { id: 2, predecesoraId: 2, sucesoraId: 3, lag: 0 };
const A_UN_DIA = { inicio: '2026-10-21', fin: '2026-10-22' };

const mover = (vista: { result: { current: ReturnType<typeof useLineaConAviso> } }, tarea: Tarea, fechas = A_UN_DIA) =>
  act(async () => { await vista.result.current.guardar(tarea, fechas, false); });

describe('mover con cascada', () => {
  it('manda el PATCH de la movida y el de la sucesora manual, sin diálogo', async () => {
    const { servidor, api } = montar([A, B, tareaDe(3, { ...C, titulo: 'C suelta' })], [D1]);
    const vista = await cargar(servidor);
    await mover(vista, A);
    expect(patches(api).map((p) => p.ruta)).toEqual(['/api/tareas/1', '/api/tareas/2']);
    expect(patches(api)[1]?.cuerpo).toMatchObject({ lockVersion: 1, cambios: { inicio: '2026-10-23', fin: '2026-10-26' } });
    expect(vista.result.current.aviso).toMatchObject({ texto: 'Movida. Se corrió 1 tarea que la espera.', error: false, deshacible: true });
  });

  it('sin sucesoras pisadas avisa las fechas nuevas', async () => {
    const { servidor } = montar([A, tareaDe(3, { ...C })], []);
    const vista = await cargar(servidor);
    await mover(vista, A);
    expect(vista.result.current.aviso?.texto).toBe('Movida: ahora va del 21 oct al 22 oct.');
  });

  it('cadena manual, automática, manual: usa la lista fresca con la automática ya corrida', async () => {
    const auto = { ...B, programacionManual: false };
    const { servidor, api } = montar([A, auto, C], [D1, D2], {
      trasGuardar: (s, id) => {
        if (id === 1) s.tareas.set(2, { ...s.tareas.get(2)!, inicio: '2026-10-23', fin: '2026-10-26' });
      },
    });
    const vista = await cargar(servidor);
    await mover(vista, A);
    expect(patches(api).map((p) => p.ruta)).toEqual(['/api/tareas/1', '/api/tareas/3']);
    expect(patches(api)[1]?.cuerpo).toMatchObject({ cambios: { inicio: '2026-10-27', fin: '2026-10-28' } });
    // La automática que corrió OpenProject también cuenta.
    expect(vista.result.current.aviso?.texto).toBe('Movida. Se corrieron 2 tareas que la esperan.');
  });

  it('cadena manual, automática, manual: vuelve a planificar cuando OpenProject corre la automática', async () => {
    // A -> M1 (manual) -> AU (automática) -> M2 (manual): AU recién se corre cuando se guarda M1.
    const m1 = tareaDe(2, { titulo: 'M1', inicio: '2026-10-22', fin: '2026-10-23' });
    const au = tareaDe(3, { titulo: 'AU', inicio: '2026-10-26', fin: '2026-10-27', programacionManual: false });
    const m2 = tareaDe(4, { titulo: 'M2', inicio: '2026-10-28', fin: '2026-10-29' });
    const deps: Dependencia[] = [D1, D2, { id: 3, predecesoraId: 3, sucesoraId: 4, lag: 0 }];
    const { servidor, api } = montar([A, m1, au, m2], deps, {
      trasGuardar: (s, id) => {
        if (id === 2) s.tareas.set(3, { ...s.tareas.get(3)!, inicio: '2026-10-27', fin: '2026-10-28' });
      },
    });
    const vista = await cargar(servidor);
    await mover(vista, A);
    expect(patches(api).map((p) => p.ruta)).toEqual(['/api/tareas/1', '/api/tareas/2', '/api/tareas/4']);
    expect(patches(api)[2]?.cuerpo).toMatchObject({ cambios: { inicio: '2026-10-29', fin: '2026-10-30' } });
    expect(servidor.tareas.get(4)).toMatchObject({ inicio: '2026-10-29', fin: '2026-10-30' });
  });

  it('Deshacer devuelve la movida y la corrida a sus fechas de antes', async () => {
    const { servidor, api } = montar([A, B], [D1]);
    const vista = await cargar(servidor);
    await mover(vista, A);
    await act(async () => { await vista.result.current.deshacer(); });
    const ps = patches(api);
    expect(ps).toHaveLength(4);
    expect(ps[2]).toMatchObject({ ruta: '/api/tareas/2', cuerpo: { cambios: { inicio: '2026-10-22', fin: '2026-10-23' } } });
    expect(ps[3]).toMatchObject({ ruta: '/api/tareas/1', cuerpo: { cambios: { inicio: '2026-10-20', fin: '2026-10-21' } } });
    expect(vista.result.current.aviso?.texto).toBe('Listo, quedó como estaba.');
    expect(vista.result.current.aviso?.deshacible).toBe(false);
  });

  it('Deshacer no toca una tarea que un compañero cambió mientras tanto y la nombra', async () => {
    const { servidor, api } = montar([A, B], [D1]);
    const vista = await cargar(servidor);
    await mover(vista, A);
    // El refresco trae a B cambiada por otra persona.
    servidor.tareas.set(2, { ...servidor.tareas.get(2)!, inicio: '2026-10-30', fin: '2026-10-30', lockVersion: 9 });
    await act(async () => { await vista.result.current.deshacer(); });
    const ps = patches(api);
    expect(ps).toHaveLength(3);
    expect(ps[2]?.ruta).toBe('/api/tareas/1');
    expect(vista.result.current.aviso?.texto).toBe('Se deshizo lo demás; «B» cambió mientras tanto y quedó como está.');
  });

  it('si la escritura de una corrida da 500 frena, avisa cuántas y Deshacer devuelve lo movido', async () => {
    const { servidor, api } = montar([A, B, C], [D1, D2]);
    servidor.patch = new Map([[3, falla(500, 'interno', 'Falló OpenProject')]]);
    const vista = await cargar(servidor);
    await mover(vista, A);
    expect(vista.result.current.aviso).toMatchObject({ error: true, deshacible: true });
    expect(vista.result.current.aviso?.texto).toContain('Se movieron 1 de 2.');
    expect(vista.result.current.aviso?.texto).toContain('«C» no se pudo mover');
    servidor.patch = undefined;
    await act(async () => { await vista.result.current.deshacer(); });
    expect(patches(api).slice(3).map((p) => p.ruta)).toEqual(['/api/tareas/2', '/api/tareas/1']);
  });

  it('un 409 al mover avisa el conflicto y no deja nada para deshacer', async () => {
    const { servidor } = montar([A, B], [D1]);
    servidor.patch = new Map([[1, falla(409, 'conflicto', 'Cambió')]]);
    const vista = await cargar(servidor);
    await mover(vista, A);
    expect(vista.result.current.aviso).toMatchObject({ texto: MSG_CONFLICTO, error: true, deshacible: false });
  });

  it('mientras se aplica un cambio, otro gesto no manda nada', async () => {
    const { servidor, api } = montar([A, B, tareaDe(3, { ...C })], [D1]);
    let soltar: () => void = () => {};
    const compuerta = new Promise<void>((r) => { soltar = r; });
    const real = fetch;
    const vista = await cargar(servidor);
    vi.stubGlobal('fetch', (e: RequestInfo | URL, init?: RequestInit) => (init?.method === 'PATCH' ? compuerta.then(() => real(e, init)) : real(e, init)));
    let primero: Promise<unknown> = Promise.resolve();
    act(() => { primero = vista.result.current.guardar(A, A_UN_DIA, false); });
    await waitFor(() => expect(vista.result.current.ocupado).toBe(true));
    await act(async () => {
      await vista.result.current.guardar(C, { inicio: '2026-10-27', fin: '2026-10-28' }, false);
      await vista.result.current.unir(1, 3);
      await vista.result.current.ordenar('11:0', [3, 2, 1]);
      await vista.result.current.soltar(D1);
    });
    expect(api.llamadas.filter((l) => l.metodo !== 'GET')).toHaveLength(0);
    soltar();
    await act(async () => { await primero; });
    expect(vista.result.current.ocupado).toBe(false);
  });

  it('la línea de vacaciones del aviso nombra a la primera tarea abierta que cae en vacaciones', async () => {
    const { servidor } = montar([A, B], [D1]);
    const vista = await cargar(servidor, (t) => (t.id === 1 ? 'Ana está de vacaciones del 26/10 al 28/10' : null));
    await mover(vista, A);
    expect(vista.result.current.aviso?.vacaciones).toBe('«A» cae en vacaciones: Ana está de vacaciones del 26/10 al 28/10.');
  });
});

describe('Deshacer que falla a mitad de camino', () => {
  it('conserva los pasos que no se llegaron a deshacer para poder reintentar', async () => {
    const { servidor, api } = montar([A, B, C], [D1, D2]);
    const vista = await cargar(servidor);
    await mover(vista, A);
    const movidas = new Map([...servidor.tareas].map(([id, t]) => [id, { inicio: t.inicio, fin: t.fin }]));
    expect(movidas.get(3)).not.toEqual({ inicio: C.inicio, fin: C.fin });
    // Se deshace C, B falla con un 500.
    servidor.patch = new Map([[2, falla(500, 'interno', 'Falló OpenProject')]]);
    await act(async () => { await vista.result.current.deshacer(); });
    expect(servidor.tareas.get(3)).toMatchObject({ inicio: C.inicio, fin: C.fin });
    expect(vista.result.current.aviso).toMatchObject({ error: true, deshacible: true });
    // Reintento: ya no falla y se deshace lo que faltaba, sin tocar C otra vez.
    servidor.patch = undefined;
    const antes = patches(api).filter((p) => p.ruta === '/api/tareas/3').length;
    await act(async () => { await vista.result.current.deshacer(); });
    expect(servidor.tareas.get(2)).toMatchObject({ inicio: B.inicio, fin: B.fin });
    expect(servidor.tareas.get(1)).toMatchObject({ inicio: A.inicio, fin: A.fin });
    expect(patches(api).filter((p) => p.ruta === '/api/tareas/3')).toHaveLength(antes);
  });
});

describe('Deshacer dura 7 segundos', () => {
  it('se apaga solo, y un cambio nuevo reemplaza al anterior', async () => {
    const { servidor } = montar([A, tareaDe(3, { ...C })], []);
    const vista = await cargar(servidor);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(MS_AVISO).toBe(7000);
    await mover(vista, A);
    const primero = vista.result.current.aviso!.id;
    act(() => { vi.advanceTimersByTime(MS_AVISO - 1); });
    expect(vista.result.current.aviso?.deshacible).toBe(true);
    // Un cambio nuevo reemplaza el aviso y reinicia el reloj.
    await mover(vista, cliente.getQueryData<ListaTareas>(CLAVES.tareas)!.tareas.find((t) => t.id === 3)!, { inicio: '2026-10-27', fin: '2026-10-28' });
    expect(vista.result.current.aviso!.id).toBeGreaterThan(primero);
    act(() => { vi.advanceTimersByTime(MS_AVISO - 1); });
    expect(vista.result.current.aviso).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(vista.result.current.aviso).toBeNull();
  });

  it('si Deshacer no llega a arrancar (sin catálogo), el reloj sigue y el aviso se apaga solo', async () => {
    const { servidor } = montar([A, tareaDe(3, { ...C })], []);
    const vista = await cargar(servidor);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mover(vista, A);
    expect(vista.result.current.aviso?.deshacible).toBe(true);
    // El catálogo se pierde justo antes de apretar «Deshacer», sin que se vuelva a pedir.
    act(() => { cliente.getQueryCache().find({ queryKey: CLAVES.catalogo })!.setState({ data: undefined, status: 'pending' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vista.result.current.deshacer(); });
    expect(vista.result.current.aviso).not.toBeNull();
    act(() => { vi.advanceTimersByTime(MS_AVISO); });
    expect(vista.result.current.aviso).toBeNull();
  });

  it('con el aviso vencido o cerrado, deshacer() ya no deshace lo que no se ve', async () => {
    const { servidor, api } = montar([A], []);
    const vista = await cargar(servidor);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mover(vista, A);
    act(() => { vi.advanceTimersByTime(MS_AVISO); });
    expect(vista.result.current.aviso).toBeNull();
    await act(async () => { await vista.result.current.deshacer(); });
    expect(patches(api)).toHaveLength(1);
  });

  it('el Deshacer sobrevive a desmontar la pantalla', async () => {
    const { servidor, api } = montar([A], []);
    const vista = await cargar(servidor);
    await mover(vista, A);
    const { deshacer } = vista.result.current;
    vista.unmount();
    await act(async () => { await deshacer(); });
    expect(patches(api)).toHaveLength(2);
  });
});

describe('unir, soltar y ordenar', () => {
  const E = tareaDe(5, { titulo: 'E', inicio: '2026-10-20', fin: '2026-10-21' });
  const F = tareaDe(6, { titulo: 'F', inicio: '2026-10-22', fin: '2026-10-23' });

  it('unir manda la dependencia, pone a la sucesora debajo en el mismo contenedor y Deshacer lo revierte', async () => {
    // F está arriba de E en la lista; al unir F espera a E y baja justo debajo.
    const { servidor, api } = montar([F, E], []);
    servidor.orden = { '11:0': [6, 5] };
    const vista = await cargar(servidor);
    cliente.setQueryData(CLAVES.ordenLinea, { '11:0': [6, 5] });
    await act(async () => { await vista.result.current.unir(5, 6); });
    expect(llamadas(api, 'POST', '/api/tareas/6/dependencias')[0]?.cuerpo).toEqual({ esperaA: 5 });
    expect(llamadas(api, 'PUT', '/api/linea/orden/11:0')[0]?.cuerpo).toEqual({ ids: [5, 6] });
    expect(vista.result.current.aviso?.texto).toBe('Unidas: «F» ahora va detrás de «E».');
    const antesDePatches = patches(api).length;
    await act(async () => { await vista.result.current.deshacer(); });
    expect(llamadas(api, 'DELETE', '/api/dependencias/100')).toHaveLength(1);
    // La sucesora vuelve a manual con sus fechas de antes.
    const ps = patches(api).slice(antesDePatches);
    expect(ps[0]).toMatchObject({ ruta: '/api/tareas/6', cuerpo: { cambios: { programacionManual: true } } });
    // Y el orden vuelve al de antes.
    expect(llamadas(api, 'PUT', '/api/linea/orden/11:0').at(-1)?.cuerpo).toEqual({ ids: [6, 5] });
  });

  it('unir no cambia el modo de la sucesora manual: OpenProject la pasa a automática y se la devuelve a manual', async () => {
    const { servidor, api } = montar([E, F], []);
    const vista = await cargar(servidor);
    await act(async () => { await vista.result.current.unir(5, 6); });
    expect(servidor.tareas.get(6)).toMatchObject({ programacionManual: true, inicio: F.inicio, fin: F.fin });
    expect(patches(api)).toHaveLength(1);
    expect(patches(api)[0]).toMatchObject({ ruta: '/api/tareas/6', cuerpo: { cambios: { programacionManual: true } } });
  });

  it('si devolver la sucesora a manual da 409, la unión igual queda para deshacer', async () => {
    // La unión ya existe en OpenProject aunque falle el PATCH siguiente: «Deshacer» tiene que poder borrarla.
    let primero = true;
    const conflictoUnaVez: Manejador = () => {
      if (!primero) return ok({ ...F, lockVersion: F.lockVersion + 2 });
      primero = false;
      return falla(409, 'conflicto', 'cambió');
    };
    const { servidor, api } = montar([E, F], [], { patch: new Map([[6, conflictoUnaVez]]) });
    const vista = await cargar(servidor);
    await act(async () => { await vista.result.current.unir(5, 6); });
    expect(llamadas(api, 'POST', '/api/tareas/6/dependencias')).toHaveLength(1);
    expect(vista.result.current.aviso).toMatchObject({ texto: MSG_CONFLICTO, error: true, deshacible: true });
    await act(async () => { await vista.result.current.deshacer(); });
    expect(llamadas(api, 'DELETE', '/api/dependencias/100')).toHaveLength(1);
  });

  it('unir con la sucesora manual encimada la corre justo detrás y la deja en manual', async () => {
    const pisada = tareaDe(6, { titulo: 'F', inicio: '2026-10-21', fin: '2026-10-22' });
    const { servidor, api } = montar([E, pisada], []);
    const vista = await cargar(servidor);
    await act(async () => { await vista.result.current.unir(5, 6); });
    expect(patches(api)[0]?.cuerpo).toMatchObject({ cambios: { inicio: '2026-10-22', fin: '2026-10-23', programacionManual: true } });
    expect(servidor.tareas.get(6)).toMatchObject({ programacionManual: true, inicio: '2026-10-22', fin: '2026-10-23' });
  });

  it('unir con la sucesora automática no la toca', async () => {
    const auto = tareaDe(6, { titulo: 'F', inicio: '2026-10-22', fin: '2026-10-23', programacionManual: false });
    const { servidor, api } = montar([E, auto], []);
    const vista = await cargar(servidor);
    await act(async () => { await vista.result.current.unir(5, 6); });
    expect(patches(api)).toHaveLength(0);
  });

  it('Deshacer de soltar una unión deja a la sucesora manual en manual y en sus fechas', async () => {
    const dep: Dependencia = { id: 1, predecesoraId: 5, sucesoraId: 6, lag: 0 };
    const { servidor, api } = montar([E, F], [dep]);
    const vista = await cargar(servidor);
    await act(async () => { await vista.result.current.soltar(dep); });
    await act(async () => { await vista.result.current.deshacer(); });
    expect(llamadas(api, 'POST', '/api/tareas/6/dependencias')).toHaveLength(1);
    expect(patches(api)[0]).toMatchObject({ ruta: '/api/tareas/6', cuerpo: { cambios: { programacionManual: true } } });
    expect(servidor.tareas.get(6)).toMatchObject({ programacionManual: true, inicio: F.inicio, fin: F.fin });
    expect(vista.result.current.aviso?.texto).toBe('Listo, quedó como estaba.');
  });

  it('soltar borra la unión y Deshacer la vuelve a crear con su retraso', async () => {
    const dep: Dependencia = { id: 1, predecesoraId: 5, sucesoraId: 6, lag: 2 };
    const { servidor, api } = montar([E, F], [dep]);
    const vista = await cargar(servidor);
    await act(async () => { await vista.result.current.soltar(dep); });
    expect(llamadas(api, 'DELETE', '/api/dependencias/1')).toHaveLength(1);
    expect(vista.result.current.aviso?.texto).toBe('Listo: «F» ya no espera a «E». Se queda en sus fechas y ahora la podés mover.');
    await act(async () => { await vista.result.current.deshacer(); });
    expect(llamadas(api, 'POST', '/api/tareas/6/dependencias')[0]?.cuerpo).toEqual({ esperaA: 5, retraso: 2 });
  });

  it('ordenar manda el PUT y Deshacer manda el orden anterior', async () => {
    const { servidor, api } = montar([E, F], []);
    const vista = await cargar(servidor);
    cliente.setQueryData(CLAVES.ordenLinea, { '11:0': [5, 6] });
    await act(async () => { await vista.result.current.ordenar('11:0', [6, 5]); });
    expect(llamadas(api, 'PUT', '/api/linea/orden/11:0')[0]?.cuerpo).toEqual({ ids: [6, 5] });
    expect(vista.result.current.aviso?.texto).toBe('Orden cambiado: lo ven así todos.');
    await act(async () => { await vista.result.current.deshacer(); });
    expect(llamadas(api, 'PUT', '/api/linea/orden/11:0')[1]?.cuerpo).toEqual({ ids: [5, 6] });
  });

  it('Deshacer del orden no lo toca si alguien lo cambió mientras tanto', async () => {
    const { servidor, api } = montar([E, F], []);
    const vista = await cargar(servidor);
    cliente.setQueryData(CLAVES.ordenLinea, { '11:0': [5, 6] });
    await act(async () => { await vista.result.current.ordenar('11:0', [6, 5]); });
    cliente.setQueryData(CLAVES.ordenLinea, { '11:0': [6, 5, 7] });
    await act(async () => { await vista.result.current.deshacer(); });
    expect(llamadas(api, 'PUT', '/api/linea/orden/11:0')).toHaveLength(1);
    expect(vista.result.current.aviso?.texto).toContain('el orden de la lista');
  });
});

describe('correr detrás de la anterior', () => {
  // A termina el viernes 23; B (jueves 22 a viernes 23) la pisa y debería empezar el lunes 26.
  const A2 = tareaDe(1, { titulo: 'A', inicio: '2026-10-20', fin: '2026-10-23' });
  const B2 = tareaDe(2, { titulo: 'B', inicio: '2026-10-22', fin: '2026-10-23' });
  const correr = (vista: { result: { current: ReturnType<typeof useLineaConAviso> } }, id: number) =>
    act(async () => { await vista.result.current.correrDetras(id); });

  it('una manual pisada escribe sus fechas, sigue manual y ofrece Deshacer', async () => {
    const { servidor, api } = montar([A2, B2], [D1]);
    const vista = await cargar(servidor);
    await correr(vista, 2);
    expect(patches(api)).toHaveLength(1);
    expect(patches(api)[0]?.cuerpo).toMatchObject({ cambios: { inicio: '2026-10-26', fin: '2026-10-27', programacionManual: true } });
    expect(vista.result.current.aviso).toMatchObject({ texto: 'Corrida detrás de «A»: del 26 oct al 27 oct.', error: false, deshacible: true });
  });

  it('un hito pisado queda en un solo día y el aviso dice «el d mes», no un rango', async () => {
    const hito = tareaDe(2, { titulo: 'Hito', tipoId: 2, inicio: '2026-10-22', fin: '2026-10-22' });
    const { servidor } = montar([A2, hito], [D1]);
    const vista = await cargar(servidor);
    await correr(vista, 2);
    expect(vista.result.current.aviso).toMatchObject({ texto: 'Corrida detrás de «A»: el 26 oct.', error: false });
  });

  it('corre en cascada la manual siguiente', async () => {
    const C2 = tareaDe(3, { titulo: 'C', inicio: '2026-10-27', fin: '2026-10-28' });
    const { servidor, api } = montar([A2, B2, C2], [D1, D2]);
    const vista = await cargar(servidor);
    await correr(vista, 2);
    expect(patches(api).map((p) => p.ruta)).toEqual(['/api/tareas/2', '/api/tareas/3']);
    expect(patches(api)[1]?.cuerpo).toMatchObject({ cambios: { inicio: '2026-10-28', fin: '2026-10-29' } });
    expect(vista.result.current.aviso?.texto).toBe('Corrida detrás de «A»: del 26 oct al 27 oct. Se corrió 1 tarea que la espera.');
  });

  it('una automática que OpenProject no corre avisa y ofrece Abrir', async () => {
    const auto = { ...B2, programacionManual: false };
    const { servidor, api } = montar([A2, auto], [D1], {
      // OpenProject ignora las fechas que se le mandan a una automática.
      trasGuardar: (s, id) => { if (id === 2) s.tareas.set(2, { ...s.tareas.get(2)!, inicio: auto.inicio, fin: auto.fin }); },
    });
    const abrir = vi.fn();
    cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cliente.setQueryData<ListaTareas>(CLAVES.tareas, { tareas: [...servidor.tareas.values()], dependencias: servidor.dependencias });
    const vista = renderHook(() => {
      const cambios = useCambiosLinea(() => null, abrir);
      return { cambios, actual: useAvisoActual() };
    }, { wrapper: envoltura });
    await waitFor(() => expect(cliente.getQueryData(CLAVES.catalogo)).toBeDefined());
    await act(async () => { await vista.result.current.cambios.correrDetras(2); });
    // Conserva su duración hábil (22 y 23 de oct = 2 días): sin mandarla OpenProject puede dejarla de un día.
    expect(patches(api)[0]?.cuerpo).toEqual({ lockVersion: 1, cambios: { programacionManual: false, duracionDias: 2 } });
    const aviso = vista.result.current.actual;
    expect(aviso).toMatchObject({ texto: 'OpenProject no la corrió; abrila para revisarla', error: true });
    expect(aviso?.accion?.etiqueta).toBe('Abrir');
    await act(async () => { await aviso?.accion?.alHacer(); });
    expect(abrir).toHaveBeenCalledWith(2);
  });

  it('una automática que OpenProject sí corre queda corrida (sin Deshacer: no se puede volver a pisar)', async () => {
    const auto = { ...B2, programacionManual: false };
    const { servidor } = montar([A2, auto], [D1], {
      trasGuardar: (s, id) => { if (id === 2) s.tareas.set(2, { ...s.tareas.get(2)!, inicio: '2026-10-26', fin: '2026-10-27' }); },
    });
    const vista = await cargar(servidor);
    await correr(vista, 2);
    expect(vista.result.current.aviso).toMatchObject({ texto: 'Corrida detrás de «A»: del 26 oct al 27 oct.', error: false, deshacible: false });
  });

  it('si ya no está pisada avisa y no escribe nada', async () => {
    const { servidor, api } = montar([A2, tareaDe(2, { titulo: 'B', inicio: '2026-10-26', fin: '2026-10-27' })], [D1]);
    const vista = await cargar(servidor);
    await correr(vista, 2);
    expect(patches(api)).toHaveLength(0);
    expect(vista.result.current.aviso).toMatchObject({ texto: 'Ya no se pisa con la anterior.', error: false, deshacible: false });
  });

  it('Deshacer vuelve las fechas de antes', async () => {
    const { servidor, api } = montar([A2, B2], [D1]);
    const vista = await cargar(servidor);
    await correr(vista, 2);
    await act(async () => { await vista.result.current.deshacer(); });
    expect(patches(api)[1]).toMatchObject({ ruta: '/api/tareas/2', cuerpo: { cambios: { inicio: '2026-10-22', fin: '2026-10-23' } } });
    expect(vista.result.current.aviso?.texto).toBe('Listo, quedó como estaba.');
  });
});

describe('crear una tarea desde la línea', () => {
  const NUEVA = {
    titulo: 'Relevar requerimientos', proyectoId: 11, estadoId: 1, responsableId: 4, madreId: null,
    inicio: '2026-10-26', fin: '2026-10-30', programacionManual: true,
  };
  const lista = () => cliente.getQueryData<ListaTareas>(CLAVES.tareas)?.tareas.map((t) => t.id);

  it('manda el alta, suma la tarea a la lista, avisa las fechas y ofrece Deshacer', async () => {
    const { servidor, api } = montar([A]);
    const vista = await cargar(servidor);
    let creada: Tarea | null = null;
    await act(async () => { creada = await vista.result.current.crear(NUEVA); });
    expect(llamadas(api, 'POST', '/api/tareas')[0]?.cuerpo).toEqual(NUEVA);
    expect(creada).toMatchObject({ id: 900, titulo: 'Relevar requerimientos' });
    expect(lista()).toContain(900);
    expect(vista.result.current.aviso).toMatchObject({
      texto: 'Creada «Relevar requerimientos» del 26 oct al 30 oct. Movela, unila o abrila para completarla.', error: false, deshacible: true,
    });
  });

  it('Deshacer la borra y la saca de la lista', async () => {
    const { servidor, api } = montar([A]);
    const vista = await cargar(servidor);
    await act(async () => { await vista.result.current.crear(NUEVA); });
    await act(async () => { await vista.result.current.deshacer(); });
    expect(llamadas(api, 'DELETE', '/api/tareas/900')).toHaveLength(1);
    expect(lista()).not.toContain(900);
    expect(vista.result.current.aviso?.texto).toBe('Listo, quedó como estaba.');
  });

  it('si OpenProject no la deja crear, avisa por qué, devuelve null y no deja nada para deshacer', async () => {
    const { servidor, api } = montar([A], [], { alta: falla(403, 'prohibido', 'No tenés permiso para crear tareas en este proyecto.') });
    const vista = await cargar(servidor);
    let creada: Tarea | null | undefined;
    await act(async () => { creada = await vista.result.current.crear(NUEVA); });
    expect(creada).toBeNull();
    expect(vista.result.current.aviso).toMatchObject({ texto: MSG_SIN_PERMISO_CREAR, error: true, deshacible: false });
    expect(lista()).not.toContain(900);
    await act(async () => { await vista.result.current.deshacer(); });
    expect(llamadas(api, 'DELETE', '/api/tareas/900')).toHaveLength(0);
  });
});

describe('pausar y quitar pausas', () => {
  // A (manual) va del martes 20 al miércoles 21 y B la espera del jueves 22 al viernes 23.
  // Pausar A un día después de uno de trabajo corre su fin al jueves 22 y pisa a B, que se corre detrás.
  const pausas = () => cliente.getQueryData<Record<number, Pausa[]>>(CLAVES.pausas);

  it('pausar manda la pausa, corre a la manual que espera y avisa las fechas', async () => {
    const { servidor, api } = montar([A, B], [D1]);
    const vista = await cargar(servidor);
    let pausada = false;
    await act(async () => { pausada = await vista.result.current.pausar(A, { despues: 1, dias: 1 }, { desde: '2026-10-21', hasta: '2026-10-21' }); });
    expect(pausada).toBe(true);
    expect(llamadas(api, 'POST', '/api/tareas/1/pausas')[0]?.cuerpo).toEqual({ lockVersion: 1, despues: 1, dias: 1 });
    expect(patches(api)[0]).toMatchObject({ ruta: '/api/tareas/2', cuerpo: { cambios: { inicio: '2026-10-23', fin: '2026-10-26' } } });
    expect(pausas()).toEqual({ 1: [{ id: 500, tareaId: 1, despues: 1, dias: 1 }] });
    expect(vista.result.current.aviso).toMatchObject({
      texto: 'En pausa el 21 oct: ahora termina el 22 oct. Se corrió 1 tarea que la espera.', error: false, deshacible: true,
    });
  });

  it('Deshacer devuelve a la que se corrió y quita la pausa', async () => {
    const { servidor, api } = montar([A, B], [D1]);
    const vista = await cargar(servidor);
    await act(async () => { await vista.result.current.pausar(A, { despues: 1, dias: 1 }, { desde: '2026-10-21', hasta: '2026-10-21' }); });
    await act(async () => { await vista.result.current.deshacer(); });
    expect(patches(api).at(-1)).toMatchObject({ ruta: '/api/tareas/2', cuerpo: { cambios: { inicio: '2026-10-22', fin: '2026-10-23' } } });
    expect(llamadas(api, 'DELETE', '/api/pausas/500')).toHaveLength(1);
    expect(servidor.tareas.get(1)?.fin).toBe('2026-10-21');
    expect(pausas()).toEqual({ 1: [] });
    expect(vista.result.current.aviso?.texto).toBe('Listo, quedó como estaba.');
  });

  it('si el servidor no la deja pausar, avisa y no deja nada para deshacer', async () => {
    const { servidor, api } = montar([A, B], [D1]);
    const vista = await cargar(servidor);
    // La 77 no está en el servidor simulado: el alta de la pausa responde 404.
    let pausada = true;
    await act(async () => { pausada = await vista.result.current.pausar({ ...A, id: 77 }, { despues: 1, dias: 1 }, { desde: '2026-10-21', hasta: '2026-10-21' }); });
    expect(pausada).toBe(false);
    expect(vista.result.current.aviso).toMatchObject({ error: true, deshacible: false });
    await act(async () => { await vista.result.current.deshacer(); });
    expect(api.llamadas.filter((l) => l.metodo === 'DELETE')).toHaveLength(0);
  });

  it('quitar una pausa devuelve el fin y Deshacer la vuelve a poner en el mismo lugar del trabajo', async () => {
    const pausada = { ...A, fin: '2026-10-22' };
    const pausa: Pausa = { id: 500, tareaId: 1, despues: 1, dias: 1 };
    const { servidor, api } = montar([pausada, B], [], { pausas: [pausa] });
    const vista = await cargar(servidor);
    cliente.setQueryData(CLAVES.pausas, { 1: [pausa] });
    await act(async () => { await vista.result.current.quitarPausa(pausa, 'A'); });
    expect(llamadas(api, 'DELETE', '/api/pausas/500')).toHaveLength(1);
    expect(vista.result.current.aviso).toMatchObject({ texto: 'Pausa quitada: «A» ahora termina el 21 oct.', deshacible: true });
    expect(pausas()).toEqual({ 1: [] });
    await act(async () => { await vista.result.current.deshacer(); });
    expect(llamadas(api, 'POST', '/api/tareas/1/pausas')[0]?.cuerpo).toEqual({ lockVersion: 2, despues: 1, dias: 1 });
    expect(servidor.tareas.get(1)?.fin).toBe('2026-10-22');
  });
});
