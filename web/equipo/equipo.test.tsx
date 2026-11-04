import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Catalogo, Feriado, MiembroEquipo } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { CATALOGO, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  limpiarEntorno();
});

// 9 Ana (vos), 5 Martín y 6 Lucía entraron a OpenDash; 7 Bruno tiene tareas pero no entró; 8 Zoe no figura en ningún lado.
const CAT: Catalogo = {
  ...CATALOGO,
  personas: [
    { id: 9, nombre: 'Ana Pereyra', login: 'apereyra', email: null, avatarUrl: null },
    { id: 5, nombre: 'Martín Gómez', login: 'mgomez', email: 'martin+gomez@ejemplo.test', avatarUrl: null },
    { id: 6, nombre: 'Lucía Ferrer', login: 'lferrer', email: null, avatarUrl: null },
    { id: 7, nombre: 'Bruno Paz', login: 'bpaz', email: null, avatarUrl: null },
    { id: 8, nombre: 'Zoe Ruiz', login: 'zruiz', email: null, avatarUrl: null },
  ],
  asignables: { 11: [9, 5], 12: [9, 5, 6] },
};
const MIEMBROS: MiembroEquipo[] = [
  { personaId: 9, presencia: 'conectado', rol: 'Líder de producto', capacidadHoras: 40, trabajandoEn: [], vacaciones: [], reunionesPorSemana: null },
  { personaId: 5, presencia: 'trabajando', rol: '', capacidadHoras: 20, trabajandoEn: [2], vacaciones: [], reunionesPorSemana: null },
  { personaId: 6, presencia: 'ausente', rol: 'Diseño', capacidadHoras: 30, trabajandoEn: [], vacaciones: [], reunionesPorSemana: null },
];
// En curso, así que suman esta semana: Ana 10 h de 40, Martín 8 h de 20 y Bruno 4 h (por defecto) de 40.
const TAREAS = [
  tareaDe(1, { proyectoId: 11, responsableId: 9, estadoId: 7, estimacionHoras: 10 }),
  tareaDe(2, { proyectoId: 11, responsableId: 5, estadoId: 7, estimacionHoras: 8, titulo: 'Armar el informe' }),
  tareaDe(3, { proyectoId: 12, responsableId: 7, estadoId: 7 }),
];

async function abrir(ruta = '/equipo', miembros = MIEMBROS, feriados: Feriado[] = []) {
  prepararEntorno(ruta);
  const api = simularApi({
    'GET /api/catalogo': ok(CAT),
    'GET /api/tareas': ok({ tareas: TAREAS, dependencias: [] }),
    'GET /api/equipo': ok(miembros),
    'GET /api/feriados': ok({ feriados, actualizado: null }),
  });
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Equipo' });
  return { api, usuario: userEvent.setup() };
}

const tarjeta = async (nombre: string) => (await screen.findByRole('heading', { level: 2, name: new RegExp(nombre) })).closest('article')!;
const contador = (etiqueta: string) => screen.getByText(etiqueta, { selector: 'dt' }).closest('dl')!;
const nombres = () => screen.queryAllByRole('article').map((a) => within(a).getByRole('heading', { level: 2 }).textContent ?? '');

describe('Pantalla Equipo', () => {
  it('una persona sin OpenDash aparece con la capacidad por defecto', async () => {
    await abrir();
    const bruno = await tarjeta('Bruno Paz');
    expect(within(bruno).getByText('Sin OpenDash')).toBeInTheDocument();
    // Sin rol cargado se muestra el login.
    expect(within(bruno).getByText('bpaz')).toBeInTheDocument();
    expect(within(bruno).getByText('Carga').parentElement).toHaveTextContent(/4 h\s*\/\s*40 h/);
    // Quien no tiene tareas ni entró a OpenDash no figura.
    expect(screen.queryByRole('heading', { level: 2, name: /Zoe Ruiz/ })).not.toBeInTheDocument();
    // Vos primero; después, por nombre.
    expect(nombres().map((n) => n.replace('Vos', ''))).toEqual(['Ana Pereyra', 'Bruno Paz', 'Lucía Ferrer', 'Martín Gómez']);
    expect(await screen.findByText('4 personas · 3 con OpenDash')).toBeInTheDocument();
  });

  it('muestra la presencia, el rol, la carga y las tareas abiertas de cada tarjeta', async () => {
    await abrir();
    const yo = await tarjeta('Ana Pereyra');
    expect(within(yo).getByText('Vos')).toBeInTheDocument();
    expect(within(yo).getByText('Líder de producto')).toBeInTheDocument();
    expect(within(yo).getByText('Conectado')).toBeInTheDocument();
    expect(within(yo).getByText('Carga').parentElement).toHaveTextContent(/10 h\s*\/\s*40 h/);
    expect(within(yo).getByRole('meter', { name: '10 h de 40 h' })).toBeInTheDocument();
    expect(within(yo).getByText('1 tarea abierta')).toBeInTheDocument();
    const martin = await tarjeta('Martín Gómez');
    expect(within(martin).getByText('Trabajando en «Armar el informe»')).toBeInTheDocument();
    expect(within(martin).getByText('mgomez')).toBeInTheDocument();
    expect(within(await tarjeta('Lucía Ferrer')).getByText('Ausente')).toBeInTheDocument();
    expect(within(await tarjeta('Lucía Ferrer')).getByText('0 tareas abiertas')).toBeInTheDocument();
  });

  it('Equipo muestra Trabajando en «X» + 1 con más de una tarea en marcha', async () => {
    const dosTareas = MIEMBROS.map((m): MiembroEquipo => (m.personaId === 5 ? { ...m, trabajandoEn: [2, 3] } : m));
    await abrir('/equipo', dosTareas);
    expect(within(await tarjeta('Martín Gómez')).getByText('Trabajando en «Armar el informe» + 1')).toBeInTheDocument();
  });

  it('el «+ N» sale de lo que el servidor dijo, aunque la lista local no tenga esas tareas', async () => {
    const tres = MIEMBROS.map((m): MiembroEquipo => (m.personaId === 5 ? { ...m, trabajandoEn: [2, 9998, 9999] } : m));
    await abrir('/equipo', tres);
    expect(within(await tarjeta('Martín Gómez')).getByText('Trabajando en «Armar el informe» + 2')).toBeInTheDocument();
  });

  it('contador Trabajando', async () => {
    await abrir();
    await tarjeta('Bruno Paz');
    expect(contador('Trabajando')).toHaveTextContent('1');
  });

  it('los contadores cuentan conectados, trabajando y carga', async () => {
    await abrir();
    await tarjeta('Bruno Paz');
    expect(contador('Conectados ahora')).toHaveTextContent(/2\s*\/\s*3/);
    expect(contador('Trabajando')).toHaveTextContent('1');
  });

  it('quien está en reunión cuenta como conectado ahora', async () => {
    const conLuciaEnReunion = MIEMBROS.map((m): MiembroEquipo => (m.personaId === 6 ? { ...m, presencia: 'reunion' } : m));
    await abrir('/equipo', conLuciaEnReunion);
    await tarjeta('Bruno Paz');
    expect(contador('Conectados ahora')).toHaveTextContent(/3\s*\/\s*3/);
  });

  it('la carga promedio promedia horas sobre capacidad', async () => {
    await abrir();
    await tarjeta('Bruno Paz');
    // 10/40 = 25 %, 8/20 = 40 %, 0/30 = 0 % y 4/40 = 10 %: promedio 18,75 %.
    expect(contador('Carga promedio')).toHaveTextContent('19%');
  });

  it('filtrar por proyecto deja a quienes tienen tareas o pueden tenerlas ahí', async () => {
    const { usuario } = await abrir();
    await tarjeta('Bruno Paz');
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Proyecto' }), 'Migración del ERP');
    // Bruno tiene una tarea en el ERP; Lucía puede recibirlas ahí.
    await waitFor(() => expect(nombres().map((n) => n.replace('Vos', ''))).toEqual(['Ana Pereyra', 'Bruno Paz', 'Lucía Ferrer', 'Martín Gómez']));
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Proyecto' }), 'Portal de clientes');
    await waitFor(() => expect(nombres().map((n) => n.replace('Vos', ''))).toEqual(['Ana Pereyra', 'Martín Gómez']));
    expect(window.location.search).toBe('?proyecto=11');
    expect(screen.getByText('2 personas · 2 con OpenDash')).toBeInTheDocument();
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Proyecto' }), 'Todos los proyectos');
    await waitFor(() => expect(nombres()).toHaveLength(4));
  });

  it('el botón de Teams solo aparece con correo', async () => {
    await abrir();
    const martin = await tarjeta('Martín Gómez');
    const enlace = within(martin).getByRole('link', { name: 'Escribirle a Martín Gómez en Teams' });
    expect(enlace).toHaveAttribute('href', `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent('martin+gomez@ejemplo.test')}`);
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(await tarjeta('Lucía Ferrer')).queryByRole('link', { name: /Teams/ })).not.toBeInTheDocument();
  });

  it('Perfil lleva a las tareas de esa persona', async () => {
    const { usuario } = await abrir();
    await usuario.click(within(await tarjeta('Martín Gómez')).getByRole('link', { name: 'Perfil' }));
    await waitFor(() => expect(window.location.pathname).toBe('/equipo/5'));
    expect(await screen.findByText('Armar el informe')).toBeInTheDocument();
  });

  it('Cómo sumar a alguien abre el diálogo y Escape lo cierra devolviendo el foco', async () => {
    const { usuario } = await abrir();
    const boton = await screen.findByRole('button', { name: 'Cómo sumar a alguien' });
    expect(screen.queryByRole('button', { name: /invitar/i })).not.toBeInTheDocument();
    await usuario.click(boton);
    const dialogo = await screen.findByRole('dialog', { name: 'Cómo sumar a alguien' });
    expect(dialogo).toHaveTextContent('Cada persona genera un token en OpenProject (Mi cuenta → Tokens de acceso → API) y entra a OpenDash con ese token. Las altas de personas se hacen en OpenProject.');
    await usuario.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(boton).toHaveFocus();
  });

  describe('con la capacidad ajustada', () => {
    // Martes 20 de octubre de 2026; el lunes 19 es feriado.
    const LUNES_FERIADO: Feriado[] = [{ fecha: '2026-10-19', nombre: 'Día de la Diversidad Cultural', puente: false, manual: false }];
    const enOctubre = () => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T15:00:00Z') });

    it('la tarjeta de Equipo dice En reunión y De vacaciones hasta cuándo', async () => {
      enOctubre();
      const miembros: MiembroEquipo[] = [
        MIEMBROS[0]!,
        { ...MIEMBROS[1]!, presencia: 'reunion' },
        { ...MIEMBROS[2]!, presencia: 'vacaciones', vacaciones: [{ desde: '2026-10-19', hasta: '2027-01-09' }] },
      ];
      await abrir('/equipo', miembros);
      expect(within(await tarjeta('Martín Gómez')).getByText('En reunión')).toBeInTheDocument();
      const lucia = await tarjeta('Lucía Ferrer');
      expect(within(lucia).getByText('De vacaciones · hasta el 9 ene')).toBeInTheDocument();
      // Toda la semana de vacaciones: capacidad 0.
      expect(within(lucia).getByText('Carga').parentElement).toHaveTextContent(/0 h\s*\/\s*0 h/);
    });

    it('la tarjeta encadena dos vacaciones pegadas', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T15:00:00Z') });
      const miembros: MiembroEquipo[] = [
        MIEMBROS[0]!,
        MIEMBROS[1]!,
        { ...MIEMBROS[2]!, presencia: 'vacaciones', vacaciones: [{ desde: '2026-10-01', hasta: '2026-10-10' }, { desde: '2026-10-11', hasta: '2026-10-20' }] },
      ];
      await abrir('/equipo', miembros);
      expect(within(await tarjeta('Lucía Ferrer')).getByText('De vacaciones · hasta el 20 oct')).toBeInTheDocument();
    });

    it('la barra de Equipo usa la capacidad ajustada', async () => {
      enOctubre();
      await abrir('/equipo', MIEMBROS, LUNES_FERIADO);
      const yo = await tarjeta('Ana Pereyra');
      await waitFor(() => expect(within(yo).getByText('Carga').parentElement).toHaveTextContent(/10 h\s*\/\s*32 h/));
      expect(within(yo).getByRole('meter', { name: '10 h de 32 h' })).toBeInTheDocument();
      // Quien no entró a OpenDash también descuenta el feriado.
      expect(within(await tarjeta('Bruno Paz')).getByText('Carga').parentElement).toHaveTextContent(/4 h\s*\/\s*32 h/);
    });

    it('la carga promedio usa la capacidad ajustada', async () => {
      enOctubre();
      await abrir('/equipo', MIEMBROS, LUNES_FERIADO);
      await tarjeta('Bruno Paz');
      // 10/32 = 31,25 %, 8/16 = 50 %, 0/24 = 0 % y 4/32 = 12,5 %: promedio 23,4 %.
      await waitFor(() => expect(contador('Carga promedio')).toHaveTextContent('23%'));
    });
  });
});
