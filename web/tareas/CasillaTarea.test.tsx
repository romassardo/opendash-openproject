import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { App } from '../App.js';
import { CLAVES } from '../api/consultas.js';
import { restaurarEstado } from './acciones.js';
import { falla, limpiarEntorno, ok, prepararEntorno, simularApi } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const AHORA = new Date().toISOString();
// «En pausa» (estado 4) con la versión 7: al deshacer tiene que volver ahí, no a «Nuevo».
const PAUSADA = tareaDe(3, { titulo: 'Pausada', estadoId: 4, versionId: 7 });
const CERRADA = tareaDe(6, { titulo: 'Terminada', estadoId: 12, cerradaEl: AHORA, actualizada: AHORA });

type Rutas = Parameters<typeof simularApi>[0];

async function abrir(rutas: Rutas) {
  prepararEntorno('/tareas?persona=todas');
  localStorage.setItem('od:vista-tareas', 'lista');
  const api = simularApi({ 'GET /api/tareas': ok({ tareas: [PAUSADA, CERRADA], dependencias: [] }), ...rutas });
  render(<App />);
  await screen.findByRole('heading', { name: 'Todas las tareas' });
  return { api, usuario: userEvent.setup() };
}

const casilla = (titulo: string) => within(screen.getByText(titulo).closest('li')!).getByRole('checkbox');
const cerrarPausada = { 'POST /api/tareas/3/mover': ok({ ...PAUSADA, estadoId: 12, lockVersion: 2, cerradaEl: AHORA }) };

describe('Deshacer al cerrar o reabrir con el círculo', () => {
  it('cerrar con el círculo muestra «Cerraste «X».» con Deshacer', async () => {
    const { usuario } = await abrir(cerrarPausada);
    await usuario.click(casilla('Pausada'));
    expect(await screen.findByText('Cerraste «Pausada».')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeInTheDocument();
  });

  it('reabrir muestra «Reabriste «X».»', async () => {
    const { usuario } = await abrir({ 'POST /api/tareas/6/mover': ok({ ...CERRADA, estadoId: 1, lockVersion: 2, cerradaEl: null }) });
    await usuario.click(casilla('Terminada'));
    expect(await screen.findByText('Reabriste «Terminada».')).toBeInTheDocument();
  });

  it('Deshacer devuelve el estado y la versión de antes (no «Nuevo»)', async () => {
    const { api, usuario } = await abrir({
      ...cerrarPausada,
      'PATCH /api/tareas/3': ok({ ...PAUSADA, lockVersion: 3 }),
    });
    await usuario.click(casilla('Pausada'));
    await usuario.click(await screen.findByRole('button', { name: 'Deshacer' }));
    expect(await screen.findByText('Listo, quedó como estaba.')).toBeInTheDocument();
    expect(api.llamadas).toContainEqual({
      metodo: 'PATCH', ruta: '/api/tareas/3', cuerpo: { lockVersion: 2, cambios: { estadoId: 4, versionId: 7 } },
    });
    expect(casilla('Pausada')).toHaveAttribute('aria-checked', 'false');
  });

  it('Deshacer no pisa si el servidor responde 409', async () => {
    const { usuario } = await abrir({
      ...cerrarPausada,
      'PATCH /api/tareas/3': falla(409, 'conflicto', 'Conflicto'),
    });
    await usuario.click(casilla('Pausada'));
    await usuario.click(await screen.findByRole('button', { name: 'Deshacer' }));
    expect(await screen.findByText('Alguien cambió «Pausada» mientras tanto; quedó como está.')).toBeInTheDocument();
  });

  it('restaurarEstado no escribe si la tarea ya tiene otro estado', async () => {
    const api = simularApi({});
    const cliente = new QueryClient();
    cliente.setQueryData(CLAVES.tareas, { tareas: [{ ...PAUSADA, estadoId: 7 }], dependencias: [] });
    const resultado = await restaurarEstado(cliente, 3, { estadoId: 4, versionId: 7 }, 12);
    expect(resultado).toBe('cambio');
    expect(api.llamadas).toHaveLength(0);
  });
});
