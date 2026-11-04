import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { abrirDetalle as abrir, CONCILIACION, conLista, DEPENDENCIAS, LISTA, panel } from '../../pruebas/fabricas/detalle.js';
import { limpiarEntorno, ok } from '../../pruebas/fabricas/web.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

// «Conciliación bancaria» (8) va del martes 20 al viernes 30 de octubre, en manual: nueve días hábiles.
const PAUSA = { id: 500, tareaId: 8, despues: 3, dias: 2 };
const seccion = async () => {
  const dialogo = await panel();
  await conLista(dialogo);
  return within(dialogo).findByRole('region', { name: 'Pausas' });
};
const fechas = (zona: HTMLElement, desde: string, hasta: string) => {
  fireEvent.change(within(zona).getByLabelText('Sin trabajo desde'), { target: { value: desde } });
  fireEvent.change(within(zona).getByLabelText('Hasta'), { target: { value: hasta } });
};

describe('Pausas en el detalle', () => {
  it('pausar del viernes al lunes manda tres días de trabajo antes y dos de pausa, y la pausa queda en la lista', async () => {
    // Como el servidor real: después de pausar, la lista ya trae el fin nuevo.
    const pausada = { ...CONCILIACION, fin: '2026-11-03', lockVersion: 5 };
    let lista = LISTA;
    const api = abrir('/tareas/8', {
      'GET /api/tareas': () => ok({ tareas: lista, dependencias: DEPENDENCIAS }),
      'POST /api/tareas/8/pausas': () => {
        lista = LISTA.map((t) => (t.id === 8 ? pausada : t));
        return ok({ tarea: pausada, pausa: PAUSA });
      },
    });
    const usuario = userEvent.setup();
    const zona = await seccion();
    fechas(zona, '2026-10-23', '2026-10-26');
    await usuario.click(within(zona).getByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(api.llamadas.filter((l) => l.ruta === '/api/tareas/8/pausas').map((l) => l.cuerpo)).toEqual([{ lockVersion: 4, despues: 3, dias: 2 }]));
    expect(await screen.findByText('En pausa del 23 oct al 26 oct: ahora termina el 3 nov.')).toBeInTheDocument();
    expect(await within(zona).findByText('Del 23 oct al 26 oct · 2 días hábiles')).toBeInTheDocument();
    expect(within(zona).getByLabelText('Sin trabajo desde')).toHaveValue('');
  });

  it('dice por qué no se puede antes de mandar nada', async () => {
    const api = abrir('/tareas/8');
    const zona = await seccion();
    fechas(zona, '2026-10-20', '2026-10-21');
    expect(within(zona).getByRole('alert')).toHaveTextContent('La pausa tiene que empezar después del primer día de la tarea.');
    expect(within(zona).getByRole('button', { name: 'Pausar' })).toBeDisabled();
    expect(api.llamadas.some((l) => l.metodo === 'POST')).toBe(false);
  });

  it('quitar una pausa la borra y devuelve el fin', async () => {
    const api = abrir('/tareas/8', {
      'GET /api/pausas': ok({ 8: [PAUSA] }),
      'DELETE /api/pausas/500': ok({ tarea: { ...CONCILIACION, fin: '2026-10-28', lockVersion: 5 } }),
    });
    const usuario = userEvent.setup();
    const zona = await seccion();
    await usuario.click(await within(zona).findByRole('button', { name: 'Quitar la pausa: del 23 oct al 26 oct' }));
    await waitFor(() => expect(api.llamadas.filter((l) => l.metodo === 'DELETE' && l.ruta === '/api/pausas/500')).toHaveLength(1));
    expect(await screen.findByText('Pausa quitada: «Conciliación bancaria» ahora termina el 28 oct.')).toBeInTheDocument();
    await waitFor(() => expect(within(zona).queryByText(/días hábiles/)).toBeNull());
  });

  it('una tarea sin fechas no tiene sección de pausas', async () => {
    abrir('/tareas/1');
    const dialogo = await panel('T1');
    await conLista(dialogo);
    expect(within(dialogo).queryByRole('region', { name: 'Pausas' })).toBeNull();
  });
});
