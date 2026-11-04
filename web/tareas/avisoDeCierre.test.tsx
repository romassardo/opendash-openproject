import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CLAVES } from '../api/consultas.js';
import { ProveedorAvisos } from '../ui/avisos.js';
import { useAvisoDeCierre } from './acciones.js';
import { falla, limpiarEntorno, ok, simularApi } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const ANTES = tareaDe(3, { titulo: 'Pausada', estadoId: 4, versionId: 7, inicio: '2026-10-12', fin: '2026-10-30', restanteHoras: 6 });
// Cerrar corre el fin al día del cierre y deja el trabajo restante en 0.
const GUARDADA = { ...ANTES, estadoId: 12, lockVersion: 2, fin: '2026-10-19', restanteHoras: 0 };

function Cierre() {
  const publicar = useAvisoDeCierre();
  return <button type="button" onClick={() => publicar(ANTES, false, GUARDADA)}>Cerrar ya</button>;
}

async function montar(estadoActual: number, rutas: Parameters<typeof simularApi>[0]) {
  const api = simularApi(rutas);
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cliente.setQueryData(CLAVES.tareas, { tareas: [{ ...GUARDADA, estadoId: estadoActual }], dependencias: [] });
  render(
    <QueryClientProvider client={cliente}>
      <ProveedorAvisos><Cierre /></ProveedorAvisos>
    </QueryClientProvider>,
  );
  const usuario = userEvent.setup();
  await usuario.click(screen.getByRole('button', { name: 'Cerrar ya' }));
  await usuario.click(await screen.findByRole('button', { name: 'Deshacer' }));
  return api;
}

describe('Deshacer un cierre: qué avisa cuando no sale', () => {
  it('si la tarea cambió de estado entre el cierre y el Deshacer, avisa que alguien la cambió y no escribe', async () => {
    const api = await montar(7, {});
    expect(await screen.findByText('Alguien cambió «Pausada» mientras tanto; quedó como está.')).toBeInTheDocument();
    expect(api.llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(0);
  });

  it('si el servidor responde 500, dice «No se pudo deshacer» con el motivo real', async () => {
    await montar(12, { 'PATCH /api/tareas/3': falla(500, 'interno', 'El servidor se cayó') });
    const aviso = await screen.findByText('No se pudo deshacer: El servidor se cayó');
    expect(aviso.closest('[data-aviso]')?.className).toContain('aviso-flotante--error');
  });

  it('vuelve el estado, la versión, el fin y el restante de antes, sin mandar el inicio que no cambió', async () => {
    const api = await montar(12, { 'PATCH /api/tareas/3': ok({ ...ANTES, lockVersion: 3 }) });
    expect(await screen.findByText('Listo, quedó como estaba.')).toBeInTheDocument();
    expect(api.llamadas.find((l) => l.metodo === 'PATCH')?.cuerpo).toEqual({
      lockVersion: 2, cambios: { estadoId: 4, versionId: 7, fin: '2026-10-30', restanteHoras: 6 },
    });
  });

  it('un segundo toque mientras se deshace no manda otro PATCH', async () => {
    const api = await montar(12, { 'PATCH /api/tareas/3': ok({ ...ANTES, lockVersion: 3 }) });
    expect(await screen.findByText('Listo, quedó como estaba.')).toBeInTheDocument();
    expect(api.llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(1);
  });
});
