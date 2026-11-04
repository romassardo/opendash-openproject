import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Catalogo, Proyecto } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { hoyArgentina, sumarDias } from '../fechas.js';
import { CATALOGO, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const HOY = hoyArgentina();
const proyecto = (id: number, nombre: string, extra: Partial<Proyecto> = {}): Proyecto =>
  ({ id, nombre, identificador: `p${id}`, activo: true, estadoOp: null, estadoOpClave: null, descripcion: '', ...extra });

// 11 Portal: 1 de 2 hechas, hito en 4 días. 12 ERP: terminado. 13 Intranet: sin hitos, con estado de OpenProject.
const CAT: Catalogo = {
  ...CATALOGO,
  proyectos: [
    proyecto(11, 'Portal de clientes', { descripcion: 'Un **portal** para [clientes](https://x.test) con `login`.\n\n- seguimiento' }),
    proyecto(12, 'Migración del ERP'),
    proyecto(13, 'Intranet', { estadoOp: 'At risk', estadoOpClave: 'at_risk' }),
  ],
};
const TAREAS = [
  tareaDe(1, { proyectoId: 11, estadoId: 12, responsableId: 9, fin: sumarDias(HOY, 10) }),
  tareaDe(2, { proyectoId: 11, estadoId: 7, responsableId: 5, fin: sumarDias(HOY, 12) }),
  tareaDe(3, { proyectoId: 11, tipoId: 2, estadoId: 1, titulo: 'Entrega beta', fin: sumarDias(HOY, 4) }),
  tareaDe(4, { proyectoId: 12, estadoId: 12, responsableId: 9, fin: '2026-01-10' }),
  tareaDe(5, { proyectoId: 13, estadoId: 1, responsableId: 9, fin: sumarDias(HOY, 30) }),
];

async function abrir(ruta = '/proyectos') {
  prepararEntorno(ruta);
  const api = simularApi({
    'GET /api/catalogo': ok(CAT),
    'GET /api/tareas': ok({ tareas: TAREAS, dependencias: [] }),
    'PUT /api/cuenta/fijados': (cuerpo) => ok({ fijados: (cuerpo as { fijado: boolean }).fijado ? [11, 13] : [] }),
  });
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Proyectos' });
  return { api, usuario: userEvent.setup() };
}

const tarjeta = async (nombre: string) => (await screen.findByRole('heading', { level: 2, name: nombre })).closest('article')!;

describe('Pantalla Proyectos', () => {
  it('muestra un proyecto por tarjeta con su avance', async () => {
    await abrir();
    expect(await screen.findByText('2 activos · 1 terminado')).toBeInTheDocument();
    const portal = await tarjeta('Portal de clientes');
    expect(within(portal).getByRole('img', { name: 'Avance: 50 %' })).toBeInTheDocument();
    expect(within(portal).getByText('1/2 tareas')).toBeInTheDocument();
    expect(within(portal).getByText('Activo')).toBeInTheDocument();
    expect(within(portal).getByText('Próximo hito')).toBeInTheDocument();
    expect(within(portal).getByText('Entrega beta')).toBeInTheDocument();
    expect(within(portal).getByText(/· en 4 días$/)).toBeInTheDocument();
    expect(within(portal).getByText('Un portal para clientes con login. seguimiento')).toBeInTheDocument();
    // Las personas son las de las tareas abiertas: la de Ana ya cerró la suya.
    expect(within(portal).queryByLabelText('Ana Pereyra')).not.toBeInTheDocument();
    expect(within(portal).getByLabelText('Martín Gómez')).toBeInTheDocument();
    const erp = await tarjeta('Migración del ERP');
    expect(within(erp).getByText('Terminado')).toBeInTheDocument();
    expect(within(erp).getByRole('img', { name: 'Avance: 100 %' })).toBeInTheDocument();
    const contador = (etiqueta: string) => screen.getByText(etiqueta, { selector: 'dt' }).closest('dl')!;
    expect(contador('Activos')).toHaveTextContent('2');
    expect(contador('Terminados')).toHaveTextContent('1');
    expect(contador('En fecha')).toHaveTextContent('100%');
    expect(contador('Vencen este mes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nuevo proyecto|crear/i })).not.toBeInTheDocument();
  });

  it('filtrar Terminados deja solo los terminados', async () => {
    const { usuario } = await abrir();
    await tarjeta('Portal de clientes');
    await usuario.click(screen.getByRole('radio', { name: 'Terminados' }));
    expect(window.location.search).toBe('?estado=terminados');
    expect(screen.queryByRole('heading', { level: 2, name: 'Portal de clientes' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Migración del ERP' })).toBeInTheDocument();
    await usuario.click(screen.getByRole('radio', { name: 'Todos' }));
    expect(window.location.search).toBe('');
    expect(await screen.findByRole('heading', { level: 2, name: 'Portal de clientes' })).toBeInTheDocument();
  });

  it('la dirección con ?estado=activos arranca filtrada', async () => {
    await abrir('/proyectos?estado=activos');
    expect(await screen.findByRole('heading', { level: 2, name: 'Intranet' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Migración del ERP' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Activos' })).toBeChecked();
  });

  it('la estrella fija el proyecto y aparece en la barra lateral', async () => {
    const { api, usuario } = await abrir();
    const intranet = await tarjeta('Intranet');
    const lateral = screen.getByRole('complementary', { name: 'Barra lateral' });
    expect(within(lateral).queryByRole('link', { name: 'Intranet' })).not.toBeInTheDocument();
    await usuario.click(within(intranet).getByRole('button', { name: 'Fijar Intranet' }));
    expect(api.llamadas).toContainEqual({ metodo: 'PUT', ruta: '/api/cuenta/fijados', cuerpo: { proyectoId: 13, fijado: true } });
    expect(await within(lateral).findByRole('link', { name: 'Intranet' })).toHaveAttribute('href', '/proyectos/13');
    expect(within(intranet).getByRole('button', { name: 'Fijar Intranet' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.pathname).toBe('/proyectos');
  });

  it('el punto de un fijado usa el color del estilo del proyecto', async () => {
    await abrir();
    const lateral = screen.getByRole('complementary', { name: 'Barra lateral' });
    const enlace = await within(lateral).findByRole('link', { name: 'Portal de clientes' });
    await waitFor(() => expect(enlace.querySelector('.lateral__punto')).toHaveStyle({ backgroundColor: 'var(--tono-azul)' }));
  });

  it('un proyecto sin hitos dice Sin hitos próximos', async () => {
    await abrir();
    expect(within(await tarjeta('Intranet')).getByText('Sin hitos próximos')).toBeInTheDocument();
  });

  it('la píldora usa el estado de OpenProject si existe', async () => {
    await abrir();
    const intranet = await tarjeta('Intranet');
    const pildora = within(intranet).getByText('At risk').closest('.pildora');
    expect(pildora).toHaveStyle({ '--pildora-color': 'var(--tono-naranja)' });
    expect(within(intranet).queryByText('Activo')).not.toBeInTheDocument();
  });

  it('tocar la tarjeta abre el proyecto', async () => {
    const { usuario } = await abrir();
    const portal = await tarjeta('Portal de clientes');
    await usuario.click(within(portal).getByText('1/2 tareas'));
    await waitFor(() => expect(window.location.pathname).toBe('/proyectos/11'));
  });
});
