import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

// Yo soy la persona 9. Fechas lejanas en el futuro para lo que pisa; en el pasado para lo vencido.
const TAREAS: Tarea[] = [
  tareaDe(1, { titulo: 'Relevamiento', responsableId: 5, inicio: '2999-01-05', fin: '2999-01-20' }),
  tareaDe(2, { titulo: 'Diseño', responsableId: 9, inicio: '2999-01-10', fin: '2999-01-25' }),
  tareaDe(3, { titulo: 'Atrasada mía', responsableId: 9, fin: '2020-01-01', inicio: '2019-12-20' }),
  tareaDe(4, { titulo: 'Atrasada de Martín', responsableId: 5, fin: '2020-01-02', inicio: '2020-01-01' }),
  tareaDe(5, { titulo: 'Sin fechas mía', responsableId: 9 }),
  tareaDe(6, { titulo: 'Huérfana', responsableId: null, inicio: '2999-02-01', fin: '2999-02-02' }),
];
const DEPENDENCIAS: Dependencia[] = [{ id: 1, predecesoraId: 1, sucesoraId: 2, lag: 0 }];

type Rutas = Parameters<typeof simularApi>[0];

async function abrir(ruta = '/para-ordenar', rutas: Rutas = {}, tareas: Tarea[] = TAREAS, dependencias: Dependencia[] = DEPENDENCIAS) {
  prepararEntorno(ruta);
  const api = simularApi({ 'GET /api/tareas': ok({ tareas, dependencias }), ...rutas });
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Para ordenar' });
  return { api, usuario: userEvent.setup() };
}

const seccion = (nombre: string) => screen.getByRole('region', { name: new RegExp(nombre) });

describe('Para ordenar', () => {
  it('muestra las secciones con su cantidad y oculta las vacías', async () => {
    await abrir();
    const pisan = await screen.findByRole('region', { name: /Fechas que se pisan/ });
    expect(pisan).toHaveTextContent('1');
    expect(within(pisan).getByText('Diseño')).toBeInTheDocument();
    expect(within(pisan).getByText('empieza antes de que termine «Relevamiento»')).toBeInTheDocument();
    expect(within(seccion('Vencidas')).getByText('Atrasada mía')).toBeInTheDocument();
    expect(within(seccion('Vencidas')).getByText('venció el 1/1')).toBeInTheDocument();
    expect(within(seccion('Sin fechas')).getByText('Sin fechas mía')).toBeInTheDocument();
    expect(within(seccion('Sin asignar')).getByText('Huérfana')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Más trabajo del que entra/ })).not.toBeInTheDocument();
  });

  it('«Correr detrás» corre la tarea, avisa con «Deshacer» y la fila se va de «Fechas que se pisan»', async () => {
    // Servidor con memoria: el PATCH cambia las fechas y la relectura de la lista las ve.
    const guardadas = new Map(TAREAS.map((t) => [t.id, t]));
    const { api, usuario } = await abrir('/para-ordenar', {
      'GET /api/tareas': () => ok({ tareas: [...guardadas.values()], dependencias: DEPENDENCIAS }),
      'PATCH /api/tareas/2': (cuerpo) => {
        const { cambios } = cuerpo as { cambios: Partial<Tarea> };
        const actual = guardadas.get(2)!;
        const nueva = { ...actual, ...cambios, lockVersion: actual.lockVersion + 1 };
        guardadas.set(2, nueva);
        return ok(nueva);
      },
    });
    const pisan = await screen.findByRole('region', { name: /Fechas que se pisan/ });
    await usuario.click(within(pisan).getByRole('button', { name: 'Correr detrás' }));
    await waitFor(() => expect(api.llamadas.some((l) => l.metodo === 'PATCH' && l.ruta === '/api/tareas/2')).toBe(true));
    expect(await screen.findByText(/Corrida detrás de «Relevamiento»/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: /Fechas que se pisan/ })).not.toBeInTheDocument());
  });

  it('el globito de fechas no deja guardar un fin anterior al inicio, y al cancelar el foco vuelve a su botón', async () => {
    const { usuario } = await abrir();
    const vencidas = await screen.findByRole('region', { name: /Vencidas/ });
    await usuario.click(within(vencidas).getByRole('button', { name: 'Cambiar fechas' }));
    const globo = await screen.findByRole('dialog', { name: /Fechas de «Atrasada mía»/ });
    const guardar = within(globo).getByRole('button', { name: 'Guardar' });
    // Una tarea sin anterior solo valida que el fin no sea anterior al inicio.
    const fin = within(globo).getByLabelText('Fin');
    await usuario.clear(fin);
    await usuario.type(fin, '2019-01-01');
    expect(within(globo).getByText('La fecha de fin no puede ser anterior a la de inicio.')).toBeInTheDocument();
    expect(guardar).toBeDisabled();
    const boton = within(vencidas).getByRole('button', { name: 'Cambiar fechas' });
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    expect(boton).toHaveAttribute('aria-controls', globo.id);
    await usuario.click(within(globo).getByRole('button', { name: 'Cancelar' }));
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(boton).toHaveFocus();
  });

  it('una sucesora manual no puede empezar antes de que termine la anterior', async () => {
    const tareas = [
      tareaDe(1, { titulo: 'Relevamiento', responsableId: 5, inicio: '2999-01-05', fin: '2999-01-20' }),
      tareaDe(2, { titulo: 'Diseño', responsableId: 9, inicio: '2020-01-06', fin: '2020-01-07' }),
    ];
    const { usuario } = await abrir('/para-ordenar', {}, tareas, DEPENDENCIAS);
    const vencidas = await screen.findByRole('region', { name: /Vencidas/ });
    await usuario.click(within(vencidas).getByRole('button', { name: 'Cambiar fechas' }));
    const globo = await screen.findByRole('dialog', { name: /Fechas de «Diseño»/ });
    const inicio = within(globo).getByLabelText('Inicio');
    await usuario.clear(inicio);
    await usuario.type(inicio, '2999-01-10');
    expect(within(globo).getByText(/No puede empezar antes del \d+\/1, cuando termina «Relevamiento»/)).toBeInTheDocument();
    expect(within(globo).getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('elegir responsable guarda y la fila se va de «Sin asignar»', async () => {
    const { api, usuario } = await abrir('/para-ordenar', {
      'PATCH /api/tareas/6': ok({ ...TAREAS[5], responsableId: 5, lockVersion: 2 }),
    });
    const sin = await screen.findByRole('region', { name: /Sin asignar/ });
    await usuario.click(within(sin).getByRole('button', { name: 'Elegir responsable' }));
    const globo = await screen.findByRole('dialog', { name: /Responsable de «Huérfana»/ });
    await usuario.selectOptions(within(globo).getByLabelText('Responsable'), 'Martín Gómez');
    // Elegir en la lista no asigna: falta confirmar con «Asignar».
    expect(api.llamadas.some((l) => l.metodo === 'PATCH')).toBe(false);
    await usuario.click(within(globo).getByRole('button', { name: 'Asignar' }));
    await waitFor(() => expect(api.llamadas.some((l) => l.metodo === 'PATCH')).toBe(true));
    expect(api.llamadas).toContainEqual({ metodo: 'PATCH', ruta: '/api/tareas/6', cuerpo: { lockVersion: 1, cambios: { responsableId: 5 } } });
    await waitFor(() => expect(screen.queryByRole('region', { name: /Sin asignar/ })).not.toBeInTheDocument());
  });

  it('filtro Mías / Todo el equipo / persona', async () => {
    const { usuario } = await abrir();
    const vencidas = await screen.findByRole('region', { name: /Vencidas/ });
    expect(within(vencidas).queryByText('Atrasada de Martín')).not.toBeInTheDocument();
    const persona = screen.getByRole('combobox', { name: 'Persona' });
    await usuario.selectOptions(persona, 'Todo el equipo');
    expect(await within(seccion('Vencidas')).findByText('Atrasada de Martín')).toBeInTheDocument();
    await usuario.selectOptions(persona, 'Martín Gómez');
    await waitFor(() => expect(within(seccion('Vencidas')).queryByText('Atrasada mía')).not.toBeInTheDocument());
    expect(within(seccion('Vencidas')).getByText('Atrasada de Martín')).toBeInTheDocument();
  });

  it('«Todo en orden» sin filas', async () => {
    await abrir('/para-ordenar', {}, [tareaDe(1, { titulo: 'Bien', responsableId: 9, inicio: '2999-01-01', fin: '2999-01-02' })], []);
    expect(await screen.findByText('Todo en orden', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Vencidas|Sin fechas|Sin asignar|Fechas que se pisan/ })).not.toBeInTheDocument();
  });
});

describe('Para ordenar: filtros', () => {
  it('?persona=<mi id> se trata como «Mías»', async () => {
    await abrir('/para-ordenar?persona=9');
    const vencidas = await screen.findByRole('region', { name: /Vencidas/ });
    expect(within(vencidas).getByText('Atrasada mía')).toBeInTheDocument();
    expect(within(vencidas).queryByText('Atrasada de Martín')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Persona' })).toHaveValue('mias');
  });

  it('las filas que se van por cambiar el filtro no se animan como arregladas', async () => {
    const { usuario } = await abrir();
    await screen.findByRole('region', { name: /Vencidas/ });
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Persona' }), 'Martín Gómez');
    await waitFor(() => expect(within(seccion('Vencidas')).queryByText('Atrasada mía')).not.toBeInTheDocument());
    expect(document.querySelector('.ordenar__fila--sale')).toBeNull();
  });
});
