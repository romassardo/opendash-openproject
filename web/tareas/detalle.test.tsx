import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Actividad } from '../../compartido/tipos.js';
import { App } from '../App.js';
import { EVENTO_TOKEN_VENCIDO } from '../api/cliente.js';
import {
  abrirDetalle as abrir, ACTIVIDADES, CONCILIACION, conLista, EXTRACTOS, hace, lecturas, panel, patches,
} from '../../pruebas/fabricas/detalle.js';
import { CATALOGO, falla, limpiarEntorno, ok, prepararEntorno, simularApi, TAREAS } from '../../pruebas/fabricas/web.js';
import { DEPENDENCIAS, LISTA } from '../../pruebas/fabricas/detalle.js';
import { MSG_COMENTARIO_SIN_RELEER } from './accionesDetalle.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

describe('Panel de detalle', () => {
  it('se abre sobre el tablero, que sigue atrás', async () => {
    abrir('/tareas/8');
    const dialogo = await panel();
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(within(dialogo).getByRole('textbox', { name: 'Título' })).toHaveValue('Conciliación bancaria');
    expect(await screen.findByRole('region', { name: 'Nuevo' })).toBeInTheDocument();
  });

  it('editar el título manda PATCH con el lockVersion vigente', async () => {
    const api = abrir('/tareas/1');
    const usuario = userEvent.setup();
    const dialogo = await panel('T1');
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Revisar contrato{Enter}');
    await waitFor(() => expect(patches(api)).toEqual([{ lockVersion: 3, cambios: { titulo: 'Revisar contrato' } }]));
    // La tarjeta del tablero también se actualiza con la respuesta.
    expect(await within(screen.getByRole('region', { name: 'Nuevo' })).findByText('Revisar contrato')).toBeInTheDocument();
    // El cambio siguiente usa el lockVersion que devolvió el servidor.
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Firmar contrato');
    await usuario.tab();
    await waitFor(() => expect(patches(api)[1]).toEqual({ lockVersion: 4, cambios: { titulo: 'Firmar contrato' } }));
    // Después de guardar se relee la tarea: el historial muestra los cambios.
    const historial = await within(dialogo).findByRole('list', { name: 'Historial' });
    await waitFor(() => expect(within(historial).getAllByText('Cambió titulo')).toHaveLength(2));
    expect(lecturas(api, '/api/tareas/1')).toBeGreaterThanOrEqual(3);
  });

  it('muestra el aviso de conflicto y recarga', async () => {
    const api = abrir('/tareas/1', { 'PATCH /api/tareas/1': falla(409, 'conflicto', 'Alguien modificó la tarea antes que vos') });
    const usuario = userEvent.setup();
    const dialogo = await panel('T1');
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    expect(lecturas(api, '/api/tareas/1')).toBe(1);
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Revisar contrato{Enter}');
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      /^Alguien cambió esta tarea recién\. Ya ves la versión nueva; volvé a aplicar tu cambio\.$/,
    );
    await waitFor(() => expect(lecturas(api, '/api/tareas/1')).toBe(2));
    await waitFor(() => expect(titulo).toHaveValue('T1'));
  });

  it('otro error muestra el motivo del servidor y el campo vuelve a su valor', async () => {
    const api = abrir('/tareas/8', { 'PATCH /api/tareas/8': falla(422, 'validacion', 'Prioridad no es válida.') });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const prioridad = within(dialogo).getByRole('combobox', { name: 'Prioridad' });
    await usuario.selectOptions(prioridad, 'Alta');
    await waitFor(() => expect(patches(api)).toEqual([{ lockVersion: 4, cambios: { prioridadId: 9 } }]));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Prioridad no es válida.');
    expect(prioridad).toHaveValue('8');
  });

  it('solo manda el campo que cambió', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    // Pasar por el título sin cambiarlo no escribe nada.
    await usuario.click(within(dialogo).getByRole('textbox', { name: 'Título' }));
    await usuario.tab();
    expect(patches(api)).toEqual([]);
    await usuario.selectOptions(within(dialogo).getByRole('combobox', { name: 'Responsable' }), 'Martín Gómez');
    await waitFor(() => expect(patches(api)).toEqual([{ lockVersion: 4, cambios: { responsableId: 5 } }]));
  });

  it('el responsable se elige solo entre quienes el proyecto permite asignar', async () => {
    const extra = { id: 3, nombre: 'Beto Ruiz', login: 'bruiz', email: null, avatarUrl: null };
    abrir('/tareas/8', {
      'GET /api/catalogo': ok({ ...CATALOGO, personas: [...CATALOGO.personas, extra], asignables: { 11: [9], 12: [9, 5, 3] } }),
    });
    const dialogo = await panel();
    const campo = within(dialogo).getByRole('combobox', { name: 'Responsable' });
    await waitFor(() => expect(within(campo).queryByRole('option', { name: 'Martín Gómez' })).not.toBeInTheDocument());
    expect(within(campo).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sin asignar', 'Ana Pereyra']);
  });

  it('dos cambios seguidos salen en orden, cada uno con el lockVersion de la respuesta anterior', async () => {
    const api = abrir('/tareas/8');
    // Los PATCH quedan retenidos hasta soltarlos a mano.
    const simulado = globalThis.fetch;
    const retenidos: (() => void)[] = [];
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) => (init?.method === 'PATCH'
      ? new Promise<Response>((listo) => retenidos.push(() => void simulado(entrada, init).then(listo)))
      : simulado(entrada, init)));
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.selectOptions(within(dialogo).getByRole('combobox', { name: 'Responsable' }), 'Martín Gómez');
    await usuario.selectOptions(within(dialogo).getByRole('combobox', { name: 'Prioridad' }), 'Alta');
    expect(within(dialogo).getByRole('combobox', { name: 'Prioridad' })).toHaveValue('9');
    expect(retenidos).toHaveLength(1);
    await act(async () => retenidos.shift()!());
    await waitFor(() => expect(retenidos).toHaveLength(1));
    await act(async () => retenidos.shift()!());
    await waitFor(() => expect(patches(api)).toEqual([
      { lockVersion: 4, cambios: { responsableId: 5 } },
      { lockVersion: 5, cambios: { prioridadId: 9 } },
    ]));
  });

  it('cambiar el proyecto pide confirmación y no guarda si se cancela', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const proyecto = within(dialogo).getByRole('combobox', { name: 'Proyecto' });
    await usuario.selectOptions(proyecto, 'Migración del ERP');
    const pregunta = await within(dialogo).findByRole('alertdialog', { name: '¿Mover la tarea a «Migración del ERP»?' });
    expect(pregunta).toHaveTextContent('Puede perder su versión y su tarea madre si no existen en ese proyecto.');
    expect(patches(api)).toEqual([]);
    await usuario.click(within(pregunta).getByRole('button', { name: 'Cancelar' }));
    expect(within(dialogo).queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(proyecto).toHaveValue('11');
    expect(patches(api)).toEqual([]);
  });

  it('confirmar el cambio de proyecto guarda proyectoId', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.selectOptions(within(dialogo).getByRole('combobox', { name: 'Proyecto' }), 'Migración del ERP');
    const pregunta = await within(dialogo).findByRole('alertdialog');
    await usuario.click(within(pregunta).getByRole('button', { name: 'Mover' }));
    await waitFor(() => expect(patches(api)).toEqual([{ lockVersion: 4, cambios: { proyectoId: 12 } }]));
    expect(within(dialogo).queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('proyecto e inicio mandan solo su campo', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.selectOptions(within(dialogo).getByRole('combobox', { name: 'Proyecto' }), 'Migración del ERP');
    await usuario.click(within(await within(dialogo).findByRole('alertdialog')).getByRole('button', { name: 'Mover' }));
    await waitFor(() => expect(patches(api)).toHaveLength(1));
    fireEvent.change(within(dialogo).getByLabelText('Inicio'), { target: { value: '2026-10-21' } });
    await waitFor(() => expect(patches(api)).toHaveLength(2));
    expect(patches(api)).toEqual([
      { lockVersion: 4, cambios: { proyectoId: 12 } },
      { lockVersion: 5, cambios: { inicio: '2026-10-21' } },
    ]);
  });

  it('vaciar un campo manda null explícito', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.selectOptions(within(dialogo).getByRole('combobox', { name: 'Responsable' }), 'Sin asignar');
    await waitFor(() => expect(patches(api)).toHaveLength(1));
    fireEvent.change(within(dialogo).getByLabelText('Fin'), { target: { value: '' } });
    await waitFor(() => expect(patches(api)).toHaveLength(2));
    const estimacion = within(dialogo).getByRole('textbox', { name: 'Estimado (horas)' });
    await usuario.clear(estimacion);
    await usuario.keyboard('{Enter}');
    await waitFor(() => expect(patches(api)).toHaveLength(3));
    expect(patches(api)).toEqual([
      { lockVersion: 4, cambios: { responsableId: null } },
      { lockVersion: 5, cambios: { fin: null } },
      { lockVersion: 6, cambios: { estimacionHoras: null } },
    ]);
  });

  it('la estimación acepta coma decimal y rechaza lo que no es un número', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const estimacion = within(dialogo).getByRole('textbox', { name: 'Estimado (horas)' });
    expect(estimacion).toHaveValue('6');
    await usuario.clear(estimacion);
    await usuario.type(estimacion, 'mucho{Enter}');
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Escribí las horas como un número, por ejemplo 2 o 1,5.');
    expect(estimacion).toHaveValue('6');
    await usuario.clear(estimacion);
    await usuario.type(estimacion, '1,5{Enter}');
    await waitFor(() => expect(patches(api)).toEqual([{ lockVersion: 4, cambios: { estimacionHoras: 1.5 } }]));
    await waitFor(() => expect(estimacion).toHaveValue('1,5'));
  });

  it('no deja que el fin quede antes del inicio', async () => {
    const api = abrir('/tareas/8');
    const dialogo = await panel();
    const fin = within(dialogo).getByLabelText('Fin');
    fireEvent.change(fin, { target: { value: '2026-10-10' } });
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('La fecha de fin no puede ser anterior a la de inicio.');
    expect(fin).toHaveValue('2026-10-30');
    fireEvent.change(within(dialogo).getByLabelText('Inicio'), { target: { value: '2026-11-05' } });
    expect(within(dialogo).getByLabelText('Inicio')).toHaveValue('2026-10-20');
    expect(patches(api)).toEqual([]);
  });

  it('una fecha tecleada se guarda al confirmar, no con cada número', async () => {
    const api = abrir('/tareas/8');
    const dialogo = await panel();
    const fin = within(dialogo).getByLabelText('Fin');
    fireEvent.keyDown(fin, { key: '2' });
    fireEvent.change(fin, { target: { value: '0002-11-02' } });
    fireEvent.keyDown(fin, { key: '0' });
    fireEvent.change(fin, { target: { value: '2026-11-02' } });
    expect(patches(api)).toEqual([]);
    fireEvent.blur(fin);
    await waitFor(() => expect(patches(api)).toEqual([{ lockVersion: 4, cambios: { fin: '2026-11-02' } }]));
  });

  it('el estado se cambia con mover, no con PATCH', async () => {
    const api = abrir('/tareas/8', {
      'POST /api/tareas/8/mover': () => {
        const movida = { ...CONCILIACION, estadoId: 7, lockVersion: 5 };
        api.servidor.tareas.set(8, movida);
        return ok(movida);
      },
    });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const estado = within(dialogo).getByRole('radiogroup', { name: 'Estado' });
    expect(within(estado).getByRole('radio', { name: 'Nuevo' })).toBeChecked();
    await usuario.click(within(estado).getByRole('radio', { name: 'En curso' }));
    await waitFor(() =>
      expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas/8/mover', cuerpo: { lockVersion: 4, columna: 'curso' } }));
    await waitFor(() => expect(within(estado).getByRole('radio', { name: 'En curso' })).toBeChecked());
    expect(patches(api)).toEqual([]);
  });

  it('edita la descripción en markdown con vista previa', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    expect(within(dialogo).getByText('todos').tagName).toBe('STRONG');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Editar descripción' }));
    const texto = within(dialogo).getByRole('textbox', { name: 'Descripción' });
    expect(texto).toHaveValue('Revisar **todos** los extractos');
    await usuario.type(texto, '{Enter}{Enter}- Galicia');
    expect(within(within(dialogo).getByRole('region', { name: 'Vista previa' })).getByRole('listitem')).toHaveTextContent('Galicia');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar descripción' }));
    await waitFor(() =>
      expect(patches(api)).toEqual([{ lockVersion: 4, cambios: { descripcion: 'Revisar **todos** los extractos\n\n- Galicia' } }]));
    await waitFor(() => expect(within(dialogo).queryByRole('textbox', { name: 'Descripción' })).not.toBeInTheDocument());
  });

  it('tarea madre: se busca entre las visibles y se puede dejar sin madre', async () => {
    const api = abrir('/tareas/21');
    const usuario = userEvent.setup();
    const dialogo = await panel('Cargar extractos');
    await conLista(dialogo);
    expect(within(dialogo).getByText('Conciliación bancaria')).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Quitar tarea madre' }));
    await waitFor(() => expect(patches(api)).toEqual([{ lockVersion: 1, cambios: { madreId: null } }]));
    expect(await within(dialogo).findByText('Sin madre')).toBeInTheDocument();
    const buscador = within(dialogo).getByRole('combobox', { name: 'Buscar tarea madre' });
    await usuario.type(buscador, 'cargar');
    expect(within(dialogo).queryByRole('option', { name: /Cargar extractos/ })).not.toBeInTheDocument();
    await usuario.clear(buscador);
    await usuario.type(buscador, 'integ');
    await usuario.click(await within(dialogo).findByRole('option', { name: /Integración API banco/ }));
    await waitFor(() => expect(patches(api)[1]).toEqual({ lockVersion: 2, cambios: { madreId: 7 } }));
  });
});

describe('Cerrar el panel', () => {
  it('Escape cierra y conserva los filtros', async () => {
    abrir('/tareas/8?persona=mias');
    const usuario = userEvent.setup();
    await panel();
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/tareas');
    expect(window.location.search).toBe('?persona=mias');
  });

  it('tocar afuera (el velo) o la X también cierran', async () => {
    abrir('/tareas/8?proyecto=11');
    const usuario = userEvent.setup();
    await panel();
    await usuario.click(document.querySelector<HTMLElement>('.detalle__velo')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.pathname + window.location.search).toBe('/tareas?proyecto=11');
    window.history.pushState({}, '', '/tareas/8?proyecto=11');
    window.dispatchEvent(new PopStateEvent('popstate'));
    const dialogo = await panel();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.pathname + window.location.search).toBe('/tareas?proyecto=11');
  });

  it('Escape en un buscador abierto solo cierra el buscador', async () => {
    abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await conLista(dialogo);
    await usuario.type(within(dialogo).getByRole('combobox', { name: 'Agregar a «Espera a…»' }), 'integ');
    expect(await within(dialogo).findByRole('option', { name: /Integración API banco/ })).toBeInTheDocument();
    await usuario.keyboard('{Escape}');
    expect(within(dialogo).queryByRole('listbox', { name: 'Agregar a «Espera a…»' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('el foco entra al panel y al cerrar vuelve a la tarjeta', async () => {
    prepararEntorno('/tareas');
    simularApi({ 'GET /api/tareas/1': ok({ tarea: TAREAS[0], actividades: [] }) });
    const usuario = userEvent.setup();
    render(<App />);
    const region = await screen.findByRole('region', { name: 'Nuevo' });
    const tarjeta = await within(region).findByRole('button', { name: /^Tarea T1,/ });
    await usuario.click(tarjeta);
    const dialogo = await panel('T1');
    expect(dialogo).toContainElement(document.activeElement as HTMLElement);
    // Tab no se escapa del panel.
    for (let i = 0; i < 40; i += 1) await usuario.tab();
    expect(dialogo).toContainElement(document.activeElement as HTMLElement);
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(tarjeta).toHaveFocus();
  });

  it('mientras está abierto el fondo queda inerte, y al cerrar se libera', async () => {
    abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    expect(screen.getByRole('region', { name: 'Nuevo' }).closest('[inert]')).not.toBeNull();
    expect(dialogo.closest('[inert]')).toBeNull();
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('con el token vencido cede el fondo al diálogo del token y lo retoma al volver', async () => {
    abrir('/tareas/8', { 'PUT /api/auth/token': ok({}) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const cerrarPanel = within(dialogo).getByRole('button', { name: 'Cerrar' });
    cerrarPanel.focus();
    act(() => {
      window.dispatchEvent(new Event(EVENTO_TOKEN_VENCIDO));
    });
    const token = await screen.findByRole('dialog', { name: 'Tu token de OpenProject venció' });
    expect(token.closest('[inert]')).toBeNull();
    expect(dialogo.closest('[inert]')).not.toBeNull();
    const campo = within(token).getByLabelText('Token nuevo');
    expect(campo).toHaveFocus();
    // Escape es del diálogo del token: el panel no se cierra por debajo.
    await usuario.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Conciliación bancaria' })).toBeInTheDocument();
    await usuario.type(campo, 'token-nuevo{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tu token de OpenProject venció' })).not.toBeInTheDocument());
    await waitFor(() => expect(cerrarPanel).toHaveFocus());
    expect(dialogo.closest('[inert]')).toBeNull();
    expect(screen.getByRole('region', { name: 'Nuevo' }).closest('[inert]')).not.toBeNull();
  });

  it('abierto desde la paleta, el panel toma el bloqueo y al cerrarlo no queda nada inerte', async () => {
    abrir('/tareas');
    const usuario = userEvent.setup();
    await within(await screen.findByRole('region', { name: 'Nuevo' })).findByText('T1');
    await usuario.keyboard('{Control>}k{/Control}');
    const paleta = await screen.findByRole('dialog', { name: 'Buscar' });
    await usuario.keyboard('conciliacion{Enter}');
    const dialogo = await panel();
    expect(paleta).not.toBeInTheDocument();
    expect(dialogo.closest('[inert]')).toBeNull();
    expect(screen.getByRole('region', { name: 'Nuevo' }).closest('[inert]')).not.toBeNull();
    // Con el panel abierto la paleta no se le pone encima.
    await usuario.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog', { name: 'Buscar' })).not.toBeInTheDocument();
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('una tarea que no existe muestra «No se encontró la tarea»', async () => {
    abrir('/tareas/99', { 'GET /api/tareas/99': falla(404, 'no-encontrado', 'No se encontró en OpenProject') });
    const usuario = userEvent.setup();
    const dialogo = await panel('No se encontró la tarea');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/tareas');
  });

  it('un id inválido no consulta al servidor', async () => {
    const api = abrir('/tareas/abc');
    await panel('No se encontró la tarea');
    expect(api.llamadas.some((l) => l.ruta.startsWith('/api/tareas/'))).toBe(false);
  });
});

describe('Subtareas', () => {
  it('cerrar una subtarea la mueve a cerrado', async () => {
    const api = abrir('/tareas/8', { 'POST /api/tareas/21/mover': ok({ ...EXTRACTOS, estadoId: 12, lockVersion: 2, cerradaEl: hace(0) }) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const casilla = await within(dialogo).findByRole('checkbox', { name: 'Completar «Cargar extractos»' });
    expect(casilla).not.toBeChecked();
    expect(within(dialogo).getByText('0/1')).toBeInTheDocument();
    await usuario.click(casilla);
    await waitFor(() =>
      expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas/21/mover', cuerpo: { lockVersion: 1, columna: 'cerrado' } }));
    await waitFor(() => expect(casilla).toBeChecked());
    expect(casilla).toHaveAccessibleName('Reabrir «Cargar extractos»');
    expect(within(dialogo).getByText('1/1')).toBeInTheDocument();
    // La madre puede cambiar con su hija: se relee.
    await waitFor(() => expect(lecturas(api, '/api/tareas/8')).toBe(2));
  });

  it('cerrar una subtarea avisa «Cerraste «X».» con un Deshacer que se puede tocar con el detalle abierto', async () => {
    const api = abrir('/tareas/8', {
      'POST /api/tareas/21/mover': ok({ ...EXTRACTOS, estadoId: 12, lockVersion: 2, cerradaEl: hace(0) }),
      'PATCH /api/tareas/21': ok({ ...EXTRACTOS, lockVersion: 3 }),
    });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('checkbox', { name: 'Completar «Cargar extractos»' }));
    expect(await screen.findByText('Cerraste «Cargar extractos».')).toBeInTheDocument();
    const deshacer = screen.getByRole('button', { name: 'Deshacer' });
    expect(deshacer.closest('[inert]')).toBeNull();
    await usuario.click(deshacer);
    expect(await screen.findByText('Listo, quedó como estaba.')).toBeInTheDocument();
    expect(api.llamadas.find((l) => l.metodo === 'PATCH' && l.ruta === '/api/tareas/21')?.cuerpo).toMatchObject({
      lockVersion: 2, cambios: { estadoId: EXTRACTOS.estadoId },
    });
  });

  it('reabrir una subtarea avisa «Reabriste «X».»', async () => {
    abrir('/tareas/8', {
      'GET /api/tareas': ok({ tareas: LISTA.map((t) => (t.id === 21 ? { ...t, estadoId: 12, cerradaEl: hace(0) } : t)), dependencias: DEPENDENCIAS }),
      'POST /api/tareas/21/mover': ok({ ...EXTRACTOS, estadoId: 1, lockVersion: 2 }),
    });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('checkbox', { name: 'Reabrir «Cargar extractos»' }));
    expect(await screen.findByText('Reabriste «Cargar extractos».')).toBeInTheDocument();
  });

  it('un conflicto al cerrar una subtarea habla de la subtarea', async () => {
    abrir('/tareas/8', { 'POST /api/tareas/21/mover': falla(409, 'conflicto', 'Alguien modificó la tarea antes que vos') });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('checkbox', { name: 'Completar «Cargar extractos»' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      /^Alguien cambió esa subtarea recién\. Ya ves la versión nueva\.$/,
    );
  });

  it('«Agregar subtarea» la crea con la madre y su proyecto', async () => {
    const api = abrir('/tareas/8', { 'POST /api/tareas': ok(tareaDe(30, { titulo: 'Revisar saldos', madreId: 8 })) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const subtareas = await conLista(dialogo);
    const boton = within(dialogo).getByRole('button', { name: 'Agregar subtarea' });
    expect(boton).toBeDisabled();
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Nueva subtarea' }), 'Revisar saldos{Enter}');
    await waitFor(() =>
      expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas', cuerpo: { titulo: 'Revisar saldos', proyectoId: 11, madreId: 8 } }));
    expect(await within(subtareas).findByText('Revisar saldos')).toBeInTheDocument();
    expect(within(dialogo).getByRole('textbox', { name: 'Nueva subtarea' })).toHaveValue('');
  });
});

describe('Espera a…', () => {
  it('agregar «Espera a» crea la dependencia', async () => {
    const api = abrir('/tareas/8', { 'POST /api/tareas/8/dependencias': ok({ id: 60, sucesoraId: 8, predecesoraId: 7, lag: 0 }) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await conLista(dialogo);
    const espera = within(dialogo).getByRole('list', { name: 'Espera a…' });
    expect(within(espera).getByText('T3')).toBeInTheDocument();
    const buscador = within(dialogo).getByRole('combobox', { name: 'Agregar a «Espera a…»' });
    // Ni ella misma ni las que ya espera aparecen.
    await usuario.type(buscador, 'conciliación');
    const sugerencias = within(dialogo).getByRole('listbox', { name: 'Agregar a «Espera a…»' });
    expect(within(sugerencias).queryAllByRole('option')).toHaveLength(0);
    expect(within(dialogo).getByText('Ninguna tarea coincide')).toBeInTheDocument();
    await usuario.clear(buscador);
    await usuario.type(buscador, 'T3');
    expect(within(dialogo).queryByRole('option', { name: /^T3/ })).not.toBeInTheDocument();
    await usuario.clear(buscador);
    await usuario.type(buscador, 'integ');
    await usuario.click(await within(dialogo).findByRole('option', { name: /Integración API banco/ }));
    await waitFor(() =>
      expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas/8/dependencias', cuerpo: { esperaA: 7 } }));
    expect(await within(espera).findByText('Integración API banco')).toBeInTheDocument();
  });

  it('no ofrece sucesoras (directas o indirectas), ancestros ni descendientes', async () => {
    abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await conLista(dialogo);
    const buscador = within(dialogo).getByRole('combobox', { name: 'Agregar a «Espera a…»' });
    const opciones = () => within(within(dialogo).getByRole('listbox', { name: 'Agregar a «Espera a…»' })).queryAllByRole('option');
    // T2 espera a esta tarea y T5 espera a T2: elegirlas haría un ciclo.
    for (const texto of ['T2', 'T5', 'cargar extractos']) {
      await usuario.clear(buscador);
      await usuario.type(buscador, texto);
      expect(opciones().map((o) => o.textContent)).toEqual([]);
    }
    await usuario.clear(buscador);
    await usuario.type(buscador, 'T6');
    expect(opciones()).toHaveLength(1);
  });

  it('desde una subtarea no ofrece a su madre', async () => {
    abrir('/tareas/21');
    const usuario = userEvent.setup();
    const dialogo = await panel('Cargar extractos');
    await conLista(dialogo);
    await usuario.type(within(dialogo).getByRole('combobox', { name: 'Agregar a «Espera a…»' }), 'concil');
    expect(within(within(dialogo).getByRole('listbox', { name: 'Agregar a «Espera a…»' })).queryAllByRole('option')).toHaveLength(0);
  });

  it('mientras se agrega una, no se puede elegir de nuevo (no hay doble POST)', async () => {
    const api = abrir('/tareas/8', { 'POST /api/tareas/8/dependencias': ok({ id: 62, sucesoraId: 8, predecesoraId: 7, lag: 0 }) });
    const simulado = globalThis.fetch;
    const retenidos: (() => void)[] = [];
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) => (String(entrada).endsWith('/dependencias')
      ? new Promise<Response>((listo) => retenidos.push(() => void simulado(entrada, init).then(listo)))
      : simulado(entrada, init)));
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await conLista(dialogo);
    const buscador = within(dialogo).getByRole('combobox', { name: 'Agregar a «Espera a…»' });
    await usuario.type(buscador, 'integ');
    await usuario.click(await within(dialogo).findByRole('option', { name: /Integración API banco/ }));
    await usuario.type(buscador, 'integ');
    expect(within(dialogo).queryByRole('option', { name: /Integración API banco/ })).not.toBeInTheDocument();
    await waitFor(() => expect(retenidos).toHaveLength(1));
    await act(async () => retenidos.shift()!());
    const espera = within(dialogo).getByRole('list', { name: 'Espera a…' });
    expect(await within(espera).findByText('Integración API banco')).toBeInTheDocument();
    expect(api.llamadas.filter((l) => l.ruta.endsWith('/dependencias'))).toHaveLength(1);
  });

  it('se elige con el teclado', async () => {
    const api = abrir('/tareas/8', { 'POST /api/tareas/8/dependencias': ok({ id: 61, sucesoraId: 8, predecesoraId: 7, lag: 0 }) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await conLista(dialogo);
    await usuario.type(within(dialogo).getByRole('combobox', { name: 'Agregar a «Espera a…»' }), 'integ');
    await usuario.keyboard('{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas/8/dependencias', cuerpo: { esperaA: 7 } }));
  });

  it('quitar una predecesora borra la dependencia', async () => {
    const api = abrir('/tareas/8', { 'DELETE /api/dependencias/50': ok(null) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await conLista(dialogo);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Quitar «T3» de Espera a…' }));
    await waitFor(() => expect(api.llamadas).toContainEqual({ metodo: 'DELETE', ruta: '/api/dependencias/50', cuerpo: undefined }));
    await waitFor(() => expect(within(dialogo).queryByText('T3')).not.toBeInTheDocument());
  });
});

describe('Espera a… con fechas que se pisan', () => {
  it('muestra el aviso y «Correr detrás» solo para la anterior en conflicto', async () => {
    // T3 termina el viernes 23 y la tarea 8 empieza el 20; T1 terminó antes y no la pisa.
    const lista = LISTA.map((t) => (t.id === 3 ? { ...t, inicio: '2026-10-19', fin: '2026-10-23' } : t.id === 1 ? { ...t, inicio: '2026-10-05', fin: '2026-10-09' } : t));
    const dependencias = [...DEPENDENCIAS, { id: 53, sucesoraId: 8, predecesoraId: 1, lag: 0 }];
    const api = abrir('/tareas/8', {
      'GET /api/tareas': ok({ tareas: lista, dependencias }),
      'PATCH /api/tareas/8': ok({ ...CONCILIACION, inicio: '2026-10-26', fin: '2026-11-05', lockVersion: 5 }),
    });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await conLista(dialogo);
    const espera = within(dialogo).getByRole('list', { name: 'Espera a…' });
    expect(await within(espera).findByText('Empieza antes de que termine «T3».')).toBeInTheDocument();
    expect(within(espera).getAllByRole('button', { name: 'Correr detrás' })).toHaveLength(1);
    expect(within(espera).queryByText('Empieza antes de que termine «T1».')).not.toBeInTheDocument();
    await usuario.click(within(espera).getByRole('button', { name: 'Correr detrás' }));
    await waitFor(() => expect(api.llamadas.some((l) => l.metodo === 'PATCH' && l.ruta === '/api/tareas/8')).toBe(true));
    const cuerpo = api.llamadas.find((l) => l.metodo === 'PATCH' && l.ruta === '/api/tareas/8')!.cuerpo as { cambios: Record<string, unknown> };
    expect(cuerpo.cambios).toMatchObject({ inicio: '2026-10-26', programacionManual: true });
    // El aviso con su botón (Deshacer o Abrir) se puede tocar: no queda dentro del fondo inerte del detalle.
    const accion = await screen.findByRole('button', { name: /^(Deshacer|Abrir)$/ });
    expect(accion.closest('[inert]')).toBeNull();
  });

  it('«Correr detrás» queda deshabilitado mientras hay una escritura de la tarea en camino', async () => {
    const lista = LISTA.map((t) => (t.id === 3 ? { ...t, inicio: '2026-10-19', fin: '2026-10-23' } : t));
    abrir('/tareas/8', { 'GET /api/tareas': ok({ tareas: lista, dependencias: DEPENDENCIAS }) });
    // El PATCH de la tarea no responde nunca: la cola del detalle queda ocupada.
    const fetchSimulado = globalThis.fetch;
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) =>
      (init?.method === 'PATCH' ? new Promise<Response>(() => undefined) : fetchSimulado(entrada, init)));
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await conLista(dialogo);
    const espera = within(dialogo).getByRole('list', { name: 'Espera a…' });
    const boton = await within(espera).findByRole('button', { name: 'Correr detrás' });
    expect(boton).toBeEnabled();
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Otro título{Enter}');
    await waitFor(() => expect(boton).toBeDisabled());
  });
});

describe('Comentarios e historial', () => {
  it('muestra autor, fecha relativa y markdown saneado', async () => {
    abrir('/tareas/8');
    const dialogo = await panel();
    const comentarios = within(dialogo).getByRole('list', { name: 'Comentarios' });
    const [comentario] = within(comentarios).getAllByRole('listitem');
    expect(comentario).toHaveTextContent('Martín Gómez');
    expect(comentario).toHaveTextContent('ayer');
    expect(within(comentario!).getByText('mañana').tagName).toBe('STRONG');
    expect(comentario!.querySelector('img')).toBeNull();
    expect(comentario).toHaveTextContent('Imagen: sin descripción');
    expect((window as { __xss?: unknown }).__xss).toBeUndefined();
  });

  it('comentar agrega el comentario a la lista', async () => {
    const nuevo: Actividad = { id: 4, creada: hace(0), autorId: 9, comentario: 'Listo, lo **reviso** hoy', detalles: [] };
    const api = abrir('/tareas/8', { 'POST /api/tareas/8/comentarios': ok({ actividades: [...ACTIVIDADES, nuevo], sinReleer: null }) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const caja = within(dialogo).getByRole('textbox', { name: 'Nuevo comentario' });
    const boton = within(dialogo).getByRole('button', { name: 'Comentar' });
    expect(boton).toBeDisabled();
    await usuario.type(caja, '   ');
    expect(boton).toBeDisabled();
    await usuario.clear(caja);
    await usuario.type(caja, 'Listo, lo **reviso** hoy');
    await usuario.click(boton);
    await waitFor(() =>
      expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/tareas/8/comentarios', cuerpo: { texto: 'Listo, lo **reviso** hoy' } }));
    const comentarios = within(dialogo).getByRole('list', { name: 'Comentarios' });
    await waitFor(() => expect(within(comentarios).getAllByRole('listitem')).toHaveLength(2));
    const ultimo = within(comentarios).getAllByRole('listitem')[1]!;
    expect(ultimo).toHaveTextContent('Ana Pereyra');
    expect(ultimo).toHaveTextContent('Listo, lo reviso hoy');
    expect(caja).toHaveValue('');
    // Comentar no cambia el lockVersion: no se relee la tarea.
    expect(lecturas(api, '/api/tareas/8')).toBe(1);
  });

  const escribirComentario = async (dialogo: HTMLElement, usuario: ReturnType<typeof userEvent.setup>) => {
    const caja = within(dialogo).getByRole('textbox', { name: 'Nuevo comentario' });
    await usuario.type(caja, 'Lo reviso mañana');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Comentar' }));
    return caja;
  };

  it('un comentario guardado sin poder releer por 403 muestra el aviso de acceso', async () => {
    abrir('/tareas/8', { 'POST /api/tareas/8/comentarios': ok({ actividades: [], sinReleer: 'sin-acceso' }, true) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const caja = await escribirComentario(dialogo, usuario);
    expect(await within(dialogo).findByText('Tu comentario se guardó, pero ya no podés ver esta tarea.')).toBeInTheDocument();
    expect(caja).toHaveValue('');
  });

  it('un comentario guardado con el token vencido avisa que hay que cargar uno nuevo', async () => {
    abrir('/tareas/8', { 'POST /api/tareas/8/comentarios': ok({ actividades: [], sinReleer: 'token-vencido' }, true) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await escribirComentario(dialogo, usuario);
    expect(await within(dialogo).findByText('Tu comentario se guardó. Para verlo, cargá un token nuevo de OpenProject.')).toBeInTheDocument();
  });

  it('un comentario guardado sin conexión para releer conserva el aviso de siempre', async () => {
    abrir('/tareas/8', { 'POST /api/tareas/8/comentarios': ok({ actividades: [], sinReleer: 'sin-conexion' }, true) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await escribirComentario(dialogo, usuario);
    expect(await within(dialogo).findByText(MSG_COMENTARIO_SIN_RELEER)).toBeInTheDocument();
  });

  it('si el comentario se guarda pero falla actualizar la lista, no invita a reenviar', async () => {
    const api = abrir('/tareas/8', { 'POST /api/tareas/8/comentarios': ok({ actividades: ACTIVIDADES, sinReleer: null }) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    // Recién cuando el comentario ya salió, actualizar la lista de tareas falla.
    const original = QueryClient.prototype.cancelQueries;
    const espia = vi.spyOn(QueryClient.prototype, 'cancelQueries').mockImplementation(function (this: QueryClient, ...args) {
      if (api.llamadas.some((l) => l.ruta.endsWith('/comentarios'))) return Promise.reject(new Error('lista rota'));
      return original.apply(this, args);
    });
    try {
      const caja = await escribirComentario(dialogo, usuario);
      await waitFor(() => expect(caja).toHaveValue(''));
      expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument();
      expect(api.llamadas.filter((l) => l.ruta.endsWith('/comentarios'))).toHaveLength(1);
    } finally {
      espia.mockRestore();
    }
  });

  it('el historial muestra los últimos 5 cambios como texto', async () => {
    abrir('/tareas/8');
    const dialogo = await panel();
    const historial = within(dialogo).getByRole('list', { name: 'Historial' });
    const lineas = within(historial).getAllByRole('listitem');
    expect(lineas).toHaveLength(5);
    expect(lineas[0]).toHaveTextContent('Assignee set to Ana Pereyra');
    expect(lineas[4]).toHaveTextContent('Subject changed');
    expect(lineas[3]).toHaveTextContent('<b>Priority</b> changed');
    expect(historial.querySelector('b')).toBeNull();
  });

  it('la prioridad Immediate se muestra como Urgente en el selector', async () => {
    const catalogo = { ...CATALOGO, prioridades: [...CATALOGO.prioridades, { id: 10, nombre: 'Immediate', alta: true, nivel: 'inmediata' as const }] };
    abrir('/tareas/8', { 'GET /api/catalogo': ok(catalogo) });
    const dialogo = await panel();
    const prioridad = within(dialogo).getByRole('combobox', { name: 'Prioridad' });
    await waitFor(() => expect(within(prioridad).getByRole('option', { name: 'Urgente' })).toHaveValue('10'));
    expect(within(prioridad).queryByRole('option', { name: 'Immediate' })).toBeNull();
  });

  it('el encabezado del detalle usa el nivel: Urgente para inmediata y Baja en castellano para las no altas', async () => {
    const catalogo = {
      ...CATALOGO,
      prioridades: [
        ...CATALOGO.prioridades,
        { id: 10, nombre: 'Inmediata', alta: true, nivel: 'inmediata' as const },
        { id: 11, nombre: 'Low', alta: false, nivel: 'baja' as const },
      ],
    };
    abrir('/tareas/31', {
      'GET /api/catalogo': ok(catalogo),
      'GET /api/tareas/31': ok({ tarea: tareaDe(31, { titulo: 'Apurada', prioridadId: 10 }), actividades: [] }),
    });
    const urgente = await panel('Apurada');
    expect(await within(urgente).findByText('Urgente', { selector: '.etiqueta-prioridad' })).toBeInTheDocument();
    cleanup();
    abrir('/tareas/32', {
      'GET /api/catalogo': ok(catalogo),
      'GET /api/tareas/32': ok({ tarea: tareaDe(32, { titulo: 'Tranquila', prioridadId: 11 }), actividades: [] }),
    });
    const baja = await panel('Tranquila');
    expect(await within(baja).findByText('Baja', { selector: '.detalle__prioridad' })).toBeInTheDocument();
    expect(within(baja).queryByText('Low', { selector: '.detalle__prioridad' })).toBeNull();
  });

  it('el detalle de un hito muestra un solo campo Fecha', async () => {
    const hito = tareaDe(30, { titulo: 'Entrega final', tipoId: 2, inicio: '2026-10-30', fin: '2026-10-30', lockVersion: 2 });
    const api = abrir('/tareas/30', {
      'GET /api/tareas/30': ok({ tarea: hito, actividades: [] }),
      'PATCH /api/tareas/30': ok({ ...hito, inicio: '2026-11-04', fin: '2026-11-04', lockVersion: 3 }),
    });
    const dialogo = await panel('Entrega final');
    expect(within(dialogo).queryByLabelText('Inicio')).toBeNull();
    expect(within(dialogo).queryByLabelText('Fin')).toBeNull();
    const fecha = within(dialogo).getByLabelText('Fecha');
    expect(fecha).toHaveValue('2026-10-30');
    fireEvent.change(fecha, { target: { value: '2026-11-04' } });
    await waitFor(() => expect(patches(api)).toEqual([{ lockVersion: 2, cambios: { fecha: '2026-11-04' } }]));
  });
});
