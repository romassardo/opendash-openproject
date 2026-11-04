import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Version } from '../../compartido/tipos.js';
import { abrirDetalle, panel, patches } from '../../pruebas/fabricas/detalle.js';
import { CATALOGO, limpiarEntorno, ok } from '../../pruebas/fabricas/web.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const version = (id: number, nombre: string, extra: Partial<Version> = {}): Version =>
  ({ id, nombre, proyectoId: 11, estado: 'abierta', inicio: null, fin: null, ...extra });

const conVersiones = (versiones: Version[]) => ({ 'GET /api/catalogo': ok({ ...CATALOGO, versiones }) });

describe('Campo «Versión» del detalle', () => {
  it('el campo Versión no deja elegir una cerrada ni una bloqueada', async () => {
    abrirDetalle('/tareas/8', conVersiones([
      version(1, 'Sprint 1'), version(2, 'Sprint viejo', { estado: 'cerrada' }), version(3, 'Congelada', { estado: 'bloqueada' }),
      version(4, 'De otro proyecto', { proyectoId: 12 }),
    ]));
    const campo = await within(await panel()).findByRole('combobox', { name: 'Versión' });
    expect(within(campo).getByRole('option', { name: 'Sin versión' })).toBeEnabled();
    expect(within(campo).getByRole('option', { name: 'Sprint 1' })).toBeEnabled();
    expect(within(campo).getByRole('option', { name: 'Sprint viejo (cerrada)' })).toBeDisabled();
    expect(within(campo).getByRole('option', { name: 'Congelada (bloqueada)' })).toBeDisabled();
    expect(within(campo).queryByRole('option', { name: 'De otro proyecto' })).toBeNull();
  });

  it('elegir una versión abierta la guarda con versionId', async () => {
    const api = abrirDetalle('/tareas/8', conVersiones([version(1, 'Sprint 1')]));
    const campo = await within(await panel()).findByRole('combobox', { name: 'Versión' });
    await userEvent.setup().selectOptions(campo, 'Sprint 1');
    await waitFor(() => expect(patches(api)).toContainEqual({ lockVersion: 4, cambios: { versionId: 1 } }));
  });

  it('«Sin versión» manda versionId null', async () => {
    const api = abrirDetalle('/tareas/8', conVersiones([version(1, 'Sprint 1')]));
    // La tarea ya tiene versión: se parte de ella.
    api.servidor.tareas.set(8, { ...api.servidor.tareas.get(8)!, versionId: 1 });
    const campo = await within(await panel()).findByRole('combobox', { name: 'Versión' });
    await waitFor(() => expect(campo).toHaveValue('1'));
    await userEvent.setup().selectOptions(campo, 'Sin versión');
    await waitFor(() => expect(patches(api)).toContainEqual({ lockVersion: 4, cambios: { versionId: null } }));
  });

  it('una tarea con versión cerrada la sigue mostrando elegida', async () => {
    const api = abrirDetalle('/tareas/8', conVersiones([version(2, 'Sprint viejo', { estado: 'cerrada' })]));
    api.servidor.tareas.set(8, { ...api.servidor.tareas.get(8)!, versionId: 2 });
    const campo = await within(await panel()).findByRole('combobox', { name: 'Versión' });
    await waitFor(() => expect(campo).toHaveValue('2'));
  });
});
