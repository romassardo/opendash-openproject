import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../App.js';
import { CATALOGO, falla, limpiarEntorno, ok, prepararEntorno, simularApi, YO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const VISTA = 'od:vista-tareas';
const ORDEN = 'od:orden-lista';
const GRUPOS = 'od:grupos-lista';

const AHORA = new Date().toISOString();
const BETA = tareaDe(1, { titulo: 'Beta', fin: '2026-10-25', responsableId: 5 });
const CERRADA = tareaDe(6, { titulo: 'Terminada', estadoId: 12, cerradaEl: AHORA, actualizada: AHORA });

// Nuevo: Beta, Gamma (alta), Abeto y Delta sin fin; En curso: Alfa (alta); En pausa: Sin fecha; Cerrado: Terminada.
const TAREAS_LISTA = [
  BETA,
  tareaDe(2, { titulo: 'Alfa', fin: '2026-10-21', responsableId: 9, estadoId: 7, prioridadId: 9 }),
  tareaDe(3, { titulo: 'Sin fecha', estadoId: 4 }),
  tareaDe(4, { titulo: 'Gamma', fin: '2026-11-03', prioridadId: 9 }),
  tareaDe(5, { titulo: 'Hito', fin: '2026-10-20', tipoId: 2 }),
  CERRADA,
  tareaDe(7, { titulo: 'Delta' }),
  tareaDe(8, { titulo: 'Abeto' }),
];

type Rutas = Parameters<typeof simularApi>[0];

async function abrirLista(opciones: { almacenado?: Record<string, string>; rutas?: Rutas; tareas?: typeof TAREAS_LISTA } = {}) {
  prepararEntorno('/tareas?persona=todas');
  localStorage.setItem(VISTA, 'lista');
  Object.entries(opciones.almacenado ?? {}).forEach(([clave, valor]) => localStorage.setItem(clave, valor));
  const api = simularApi({
    'GET /api/tareas': ok({ tareas: opciones.tareas ?? TAREAS_LISTA, dependencias: [] }),
    ...opciones.rutas,
  });
  render(<App />);
  await screen.findByRole('heading', { name: 'Todas las tareas' });
  return { api, usuario: userEvent.setup() };
}

const botonGrupo = (nombre: string) => screen.getByRole('button', { name: new RegExp(`^${nombre}`) });
const grupo = (nombre: string) => botonGrupo(nombre).closest('section')!;
const titulosDe = (nombre: string) =>
  within(grupo(nombre)).queryAllByRole('listitem').map((fila) => fila.querySelector('.lista__texto')?.textContent);
const fila = (titulo: string) => screen.getByText(titulo).closest('li')!;
const casilla = (titulo: string) => within(fila(titulo)).getByRole('checkbox');

describe('Lista agrupada', () => {
  it('agrupa por columna en el orden del tablero, sin hitos, y cuenta lo que muestra', async () => {
    await abrirLista();
    const encabezados = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(encabezados).toEqual(['Nuevo4 tareas', 'En curso1 tarea', 'En pausa1 tarea', 'Cerrado1 tarea']);
    expect(screen.getByText('7 en el tablero')).toBeInTheDocument();
    expect(screen.queryByText('Hito')).not.toBeInTheDocument();
  });

  it('esconde los grupos vacíos', async () => {
    await abrirLista({ tareas: [BETA, tareaDe(3, { titulo: 'Sin fecha', estadoId: 4 })] });
    expect(screen.queryByRole('button', { name: /^En curso/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cerrado/ })).not.toBeInTheDocument();
    expect(screen.getByText('2 en el tablero')).toBeInTheDocument();
  });

  it('por vencimiento ordena por fin con vacíos al final y luego por título', async () => {
    await abrirLista();
    expect(screen.getByRole('radio', { name: 'Vencimiento' })).toHaveAttribute('aria-checked', 'true');
    expect(titulosDe('Nuevo')).toEqual(['Beta', 'Gamma', 'Abeto', 'Delta']);
  });

  it('por prioridad pone primero las altas y recuerda la elección', async () => {
    const { usuario } = await abrirLista();
    await usuario.click(screen.getByRole('radio', { name: 'Prioridad' }));
    expect(titulosDe('Nuevo')).toEqual(['Gamma', 'Beta', 'Abeto', 'Delta']);
    expect(localStorage.getItem(ORDEN)).toBe('prioridad');
  });

  it('abre con el orden guardado y un valor inválido vuelve a vencimiento', async () => {
    await abrirLista({ almacenado: { [ORDEN]: 'prioridad' } });
    expect(titulosDe('Nuevo')[0]).toBe('Gamma');
    cleanup();
    await abrirLista({ almacenado: { [ORDEN]: 'cualquiera' } });
    expect(screen.getByRole('radio', { name: 'Vencimiento' })).toHaveAttribute('aria-checked', 'true');
  });

  it('muestra prioridad alta solo en las altas, fecha vencida en rojo y avance de subtareas', async () => {
    await abrirLista({
      tareas: [
        tareaDe(1, { titulo: 'Madre', fin: '2026-10-01', prioridadId: 9 }),
        tareaDe(2, { titulo: 'Hija uno', madreId: 1, estadoId: 12, cerradaEl: AHORA }),
        tareaDe(3, { titulo: 'Hija dos', madreId: 1 }),
      ],
    });
    const madre = fila('Madre');
    expect(within(madre).getByText('Alta')).toBeInTheDocument();
    expect(within(madre).getByText('1/2')).toBeInTheDocument();
    expect(within(madre).getByText('1 oct').closest('.tarjeta__fecha')).toHaveClass('tarjeta__fecha--vencida');
    expect(within(fila('Hija dos')).queryByText('Alta')).not.toBeInTheDocument();
  });

  it('una prioridad de nivel inmediata se marca Urgente aunque OpenProject la nombre en castellano', async () => {
    const catalogo = { ...CATALOGO, prioridades: [...CATALOGO.prioridades, { id: 10, nombre: 'Inmediata', alta: true, nivel: 'inmediata' as const }] };
    await abrirLista({
      tareas: [tareaDe(1, { titulo: 'Apurada', prioridadId: 10 }), tareaDe(2, { titulo: 'Importante', prioridadId: 9 })],
      rutas: { 'GET /api/catalogo': ok(catalogo) },
    });
    expect(await within(fila('Apurada')).findByText('Urgente')).toBeInTheDocument();
    expect(within(fila('Importante')).getByText('Alta')).toBeInTheDocument();
  });
});

describe('Primera carga desde OpenProject', () => {
  it('mientras el servidor trae los datos por primera vez no dice «Sin tareas»', async () => {
    await abrirLista({ tareas: [], rutas: { 'GET /api/auth/yo': ok({ ...YO, cargaInicialLista: false }) } });
    const lista = screen.getByRole('region', { name: 'Todas las tareas' });
    expect(within(lista).getByText('Trayendo tus tareas de OpenProject…')).toBeInTheDocument();
    expect(screen.queryByText('Sin tareas')).not.toBeInTheDocument();
  });

  it('con la carga lista y sin tareas, dice que no hay', async () => {
    await abrirLista({ tareas: [] });
    expect(screen.getByText('Sin tareas')).toBeInTheDocument();
    expect(screen.queryByText('Trayendo tus tareas de OpenProject…')).not.toBeInTheDocument();
  });
});

describe('Grupos plegables', () => {
  it('plegar un grupo esconde sus filas y se recuerda', async () => {
    const { usuario } = await abrirLista();
    expect(botonGrupo('Nuevo')).toHaveAttribute('aria-expanded', 'true');
    await usuario.click(botonGrupo('Nuevo'));
    expect(botonGrupo('Nuevo')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    expect(screen.getByText('Alfa')).toBeInTheDocument();
    cleanup();
    await abrirLista({ almacenado: { [GRUPOS]: localStorage.getItem(GRUPOS) ?? '' } });
    expect(botonGrupo('Nuevo')).toHaveAttribute('aria-expanded', 'false');
    expect(botonGrupo('En curso')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Grupos con datos dañados', () => {
  it('un JSON inválido en el almacenamiento deja todos los grupos abiertos', async () => {
    await abrirLista({ almacenado: { [GRUPOS]: '{no es json' } });
    expect(botonGrupo('Nuevo')).toHaveAttribute('aria-expanded', 'true');
    expect(botonGrupo('Cerrado')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Casilla de completar', () => {
  it('cierra la tarea con mover a «cerrado» y la pasa al grupo Cerrado', async () => {
    const { api, usuario } = await abrirLista({
      rutas: { 'POST /api/tareas/1/mover': ok({ ...BETA, estadoId: 12, lockVersion: 2, cerradaEl: AHORA }) },
    });
    expect(casilla('Beta')).toHaveAttribute('aria-checked', 'false');
    expect(casilla('Beta')).toHaveAccessibleName('Completar «Beta»');
    await usuario.click(casilla('Beta'));
    expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas/1/mover', cuerpo: { lockVersion: 1, columna: 'cerrado' } });
    await waitFor(() => expect(within(grupo('Cerrado')).getByText('Beta')).toBeInTheDocument());
    expect(casilla('Beta')).toHaveAttribute('aria-checked', 'true');
    expect(window.location.pathname).toBe('/tareas');
  });

  it('en una tarea cerrada la reabre en «Nuevo»', async () => {
    const { api, usuario } = await abrirLista({
      rutas: { 'POST /api/tareas/6/mover': ok({ ...CERRADA, estadoId: 1, lockVersion: 2, cerradaEl: null }) },
    });
    expect(casilla('Terminada')).toHaveAttribute('aria-checked', 'true');
    expect(casilla('Terminada')).toHaveAccessibleName('Reabrir «Terminada»');
    await usuario.click(casilla('Terminada'));
    expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas/6/mover', cuerpo: { lockVersion: 1, columna: 'nuevo' } });
    await waitFor(() => expect(within(grupo('Nuevo')).getByText('Terminada')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Cerrado/ })).not.toBeInTheDocument();
  });

  it('si falla vuelve a su grupo y avisa el motivo', async () => {
    const { usuario } = await abrirLista({
      rutas: { 'POST /api/tareas/1/mover': falla(422, 'transicion-no-permitida', 'Estado no es válido') },
    });
    await usuario.click(casilla('Beta'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Estado no es válido');
    expect(within(grupo('Nuevo')).getByText('Beta')).toBeInTheDocument();
    expect(casilla('Beta')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Abrir una tarea', () => {
  it('clic en la fila abre la tarea', async () => {
    const { usuario } = await abrirLista();
    await usuario.click(screen.getByText('Beta'));
    expect(window.location.pathname).toBe('/tareas/1');
  });

  it('Enter en una fila enfocada abre la tarea', async () => {
    const { usuario } = await abrirLista();
    screen.getByRole('button', { name: 'Gamma' }).focus();
    await usuario.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/tareas/4');
  });

  it('la fila no es parada de tabulación y Enter en la casilla no abre la tarea', async () => {
    const { usuario } = await abrirLista({ rutas: { 'POST /api/tareas/4/mover': ok({ ...tareaDe(4), estadoId: 12 }) } });
    expect(fila('Gamma')).not.toHaveAttribute('tabindex');
    casilla('Gamma').focus();
    await usuario.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/tareas');
  });
});

describe('Vista elegida', () => {
  async function abrirTablero(almacenada?: string) {
    prepararEntorno('/tareas');
    if (almacenada !== undefined) localStorage.setItem(VISTA, almacenada);
    simularApi();
    render(<App />);
    await screen.findByRole('region', { name: 'Nuevo' });
    return userEvent.setup();
  }

  it('recuerda la vista elegida', async () => {
    const usuario = await abrirTablero();
    await usuario.click(screen.getByRole('radio', { name: 'Lista' }));
    expect(localStorage.getItem(VISTA)).toBe('lista');
    await usuario.click(screen.getByRole('radio', { name: 'Tablero' }));
    expect(localStorage.getItem(VISTA)).toBe('tablero');
  });

  it('una vista guardada inválida abre el tablero', async () => {
    await abrirTablero('cualquier-cosa');
    expect(screen.queryByRole('heading', { name: 'Todas las tareas' })).not.toBeInTheDocument();
  });
});

describe('Color del proyecto en la lista', () => {
  it('el color del proyecto sale de los ajustes', async () => {
    const proyectoId = BETA.proyectoId;
    await abrirLista({ rutas: { 'GET /api/ajustes': ok({ estilos: { [proyectoId]: { color: 'lima', icono: 'carpeta' } }, metricas: { horasPorDefecto: 4, horasSemanaLargas: 4, capacidadPorDefecto: 40, restarReuniones: false } }) } });
    await waitFor(() => expect(fila('Beta').getAttribute('style')).toContain('var(--tono-lima)'));
  });
});
