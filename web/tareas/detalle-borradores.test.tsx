import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { abrirDetalle as abrir, CONCILIACION, EXTRACTOS, lecturas, panel, patches } from '../../pruebas/fabricas/detalle.js';
import { falla, limpiarEntorno, ok } from '../../pruebas/fabricas/web.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const CONFLICTO = 'Alguien cambió esta tarea recién.';
const cerrarSubtarea = { 'POST /api/tareas/21/mover': ok({ ...EXTRACTOS, estadoId: 12, lockVersion: 2 }) };

describe('No se pierde lo escrito (Ruling 28)', () => {
  it('título: si falla, lo escrito queda en el campo; Enter reintenta y Escape descarta', async () => {
    const api = abrir('/tareas/1', { 'PATCH /api/tareas/1': falla(422, 'validacion', 'El título no es válido.') });
    const usuario = userEvent.setup();
    const dialogo = await panel('T1');
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Revisar contrato{Enter}');
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('El título no es válido.');
    expect(titulo).toHaveValue('Revisar contrato');
    // Salir del campo no vuelve a mandar lo mismo que ya falló.
    await usuario.tab();
    expect(patches(api)).toHaveLength(1);
    expect(titulo).toHaveValue('Revisar contrato');
    await usuario.click(titulo);
    await usuario.keyboard('{Enter}');
    await waitFor(() => expect(patches(api)).toHaveLength(2));
    await waitFor(() => expect(titulo).toHaveValue('Revisar contrato'));
    await usuario.keyboard('{Escape}');
    expect(titulo).toHaveValue('T1');
    expect(screen.getByRole('dialog', { name: 'T1' })).toBeInTheDocument();
  });

  it('título: ante un conflicto se ve el del servidor y «Tu versión» se puede reaplicar', async () => {
    const api = abrir('/tareas/1');
    const usuario = userEvent.setup();
    const dialogo = await panel('T1');
    api.servidor.tareas.set(1, { ...api.servidor.tareas.get(1)!, titulo: 'Título de Martín', lockVersion: 4 });
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Revisar contrato{Enter}');
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(CONFLICTO);
    await waitFor(() => expect(titulo).toHaveValue('Título de Martín'));
    const version = within(dialogo).getByRole('group', { name: 'Tu versión del título' });
    expect(version).toHaveTextContent('Revisar contrato');
    await waitFor(() => expect(within(version).getByRole('button', { name: 'Reaplicar' })).toBeEnabled());
    await usuario.click(within(version).getByRole('button', { name: 'Reaplicar' }));
    await waitFor(() => expect(patches(api)[1]).toEqual({ lockVersion: 4, cambios: { titulo: 'Revisar contrato' } }));
    await waitFor(() => expect(titulo).toHaveValue('Revisar contrato'));
    expect(within(dialogo).queryByRole('group', { name: 'Tu versión del título' })).not.toBeInTheDocument();
  });

  it('título: «Descartar» deja la versión del servidor sin mandar nada', async () => {
    const api = abrir('/tareas/1');
    const usuario = userEvent.setup();
    const dialogo = await panel('T1');
    api.servidor.tareas.set(1, { ...api.servidor.tareas.get(1)!, titulo: 'Título de Martín', lockVersion: 4 });
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Revisar contrato{Enter}');
    const version = await within(dialogo).findByRole('group', { name: 'Tu versión del título' });
    await usuario.click(within(version).getByRole('button', { name: 'Descartar' }));
    expect(within(dialogo).queryByRole('group', { name: 'Tu versión del título' })).not.toBeInTheDocument();
    await waitFor(() => expect(titulo).toHaveValue('Título de Martín'));
    expect(patches(api)).toHaveLength(1);
  });

  it('descripción: si falla, sigue en edición con lo escrito y el aviso', async () => {
    abrir('/tareas/8', { 'PATCH /api/tareas/8': falla(422, 'validacion', 'La descripción no es válida.') });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Editar descripción' }));
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Descripción' }), ' y los cheques');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar descripción' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('La descripción no es válida.');
    expect(within(dialogo).getByRole('textbox', { name: 'Descripción' })).toHaveValue('Revisar **todos** los extractos y los cheques');
  });

  it('descripción: ante un conflicto se ve la del servidor y «Tu versión» se puede reaplicar', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    api.servidor.tareas.set(8, { ...CONCILIACION, descripcion: 'Versión de **Martín**', lockVersion: 5 });
    await usuario.click(within(dialogo).getByRole('button', { name: 'Editar descripción' }));
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Descripción' }), ' y los cheques');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar descripción' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(CONFLICTO);
    await waitFor(() => expect(within(dialogo).getByText('Martín').tagName).toBe('STRONG'));
    expect(within(dialogo).queryByRole('textbox', { name: 'Descripción' })).not.toBeInTheDocument();
    const version = within(dialogo).getByRole('group', { name: 'Tu versión de la descripción' });
    expect(version).toHaveTextContent('Revisar todos los extractos y los cheques');
    await waitFor(() => expect(within(version).getByRole('button', { name: 'Reaplicar' })).toBeEnabled());
    await usuario.click(within(version).getByRole('button', { name: 'Reaplicar' }));
    await waitFor(() =>
      expect(patches(api)[1]).toEqual({ lockVersion: 5, cambios: { descripcion: 'Revisar **todos** los extractos y los cheques' } }));
    await waitFor(() => expect(within(dialogo).queryByRole('group', { name: 'Tu versión de la descripción' })).not.toBeInTheDocument());
    await waitFor(() => expect(within(dialogo).getByText('todos').tagName).toBe('STRONG'));
  });

  it('descripción: si reaplicar falla por otro motivo, vuelve a la edición con lo escrito', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    api.servidor.tareas.set(8, { ...CONCILIACION, descripcion: 'Versión de Martín', lockVersion: 5 });
    await usuario.click(within(dialogo).getByRole('button', { name: 'Editar descripción' }));
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Descripción' }), ' y los cheques');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar descripción' }));
    const version = await within(dialogo).findByRole('group', { name: 'Tu versión de la descripción' });
    await waitFor(() => expect(within(version).getByRole('button', { name: 'Reaplicar' })).toBeEnabled());
    api.servidor.siguienteFalla = falla(422, 'validacion', 'La descripción no es válida.');
    await usuario.click(within(version).getByRole('button', { name: 'Reaplicar' }));
    expect(await within(dialogo).findByRole('textbox', { name: 'Descripción' })).toHaveValue('Revisar **todos** los extractos y los cheques');
    expect(within(dialogo).getByRole('alert')).toHaveTextContent('La descripción no es válida.');
  });
});

describe('Un cambio ajeno mientras se edita no se pisa (Ruling 29)', () => {
  it('título: si al guardar el servidor ya tiene otro, no se manda y queda en «Tu versión»', async () => {
    const api = abrir('/tareas/8', cerrarSubtarea);
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Conciliar con el banco');
    // Mientras se escribe, alguien cambia el título y el panel se relee (al cerrar una subtarea).
    api.servidor.tareas.set(8, { ...CONCILIACION, titulo: 'Conciliación de octubre', lockVersion: 5 });
    fireEvent.click(await within(dialogo).findByRole('checkbox', { name: 'Completar «Cargar extractos»' }));
    await waitFor(() => expect(lecturas(api, '/api/tareas/8')).toBe(2));
    expect(titulo).toHaveValue('Conciliar con el banco');
    await usuario.keyboard('{Enter}');
    const version = await within(dialogo).findByRole('group', { name: 'Tu versión del título' });
    expect(version).toHaveTextContent('Conciliar con el banco');
    expect(titulo).toHaveValue('Conciliación de octubre');
    expect(within(dialogo).getByRole('alert')).toHaveTextContent(CONFLICTO);
    expect(patches(api)).toEqual([]);
  });

  it('descripción: si al guardar el servidor ya tiene otra, no se manda y queda en «Tu versión»', async () => {
    const api = abrir('/tareas/8', cerrarSubtarea);
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Editar descripción' }));
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Descripción' }), ' y los cheques');
    api.servidor.tareas.set(8, { ...CONCILIACION, descripcion: 'Versión de Martín', lockVersion: 5 });
    await usuario.click(await within(dialogo).findByRole('checkbox', { name: 'Completar «Cargar extractos»' }));
    await waitFor(() => expect(lecturas(api, '/api/tareas/8')).toBe(2));
    await usuario.click(within(dialogo).getByRole('button', { name: 'Guardar descripción' }));
    const version = await within(dialogo).findByRole('group', { name: 'Tu versión de la descripción' });
    expect(version).toHaveTextContent('Revisar todos los extractos y los cheques');
    expect(within(dialogo).getByText('Versión de Martín')).toBeInTheDocument();
    expect(patches(api)).toEqual([]);
  });

  it('título: lo que se sigue escribiendo mientras se guarda conserva como base lo guardado', async () => {
    const api = abrir('/tareas/8', cerrarSubtarea);
    // Solo el primer PATCH queda retenido hasta soltarlo a mano.
    const simulado = globalThis.fetch;
    let retenido: (() => void) | null = null;
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PATCH' || retenido !== null) return simulado(entrada, init);
      return new Promise<Response>((listo) => { retenido = () => void simulado(entrada, init).then(listo); });
    });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Conciliar{Enter}');
    await waitFor(() => expect(retenido).not.toBeNull());
    // Mientras se guarda «Conciliar» se sigue escribiendo.
    await usuario.type(titulo, ' con el banco');
    await act(async () => retenido!());
    await waitFor(() => expect(patches(api)).toEqual([{ lockVersion: 4, cambios: { titulo: 'Conciliar' } }]));
    await waitFor(() => expect(lecturas(api, '/api/tareas/8')).toBe(2));
    // Después alguien cambia el título y el panel se relee (al cerrar una subtarea).
    api.servidor.tareas.set(8, { ...api.servidor.tareas.get(8)!, titulo: 'Conciliación de octubre', lockVersion: 6 });
    fireEvent.click(await within(dialogo).findByRole('checkbox', { name: 'Completar «Cargar extractos»' }));
    await waitFor(() => expect(lecturas(api, '/api/tareas/8')).toBe(3));
    expect(titulo).toHaveValue('Conciliar con el banco');
    await usuario.keyboard('{Enter}');
    const version = await within(dialogo).findByRole('group', { name: 'Tu versión del título' });
    expect(version).toHaveTextContent('Conciliar con el banco');
    expect(titulo).toHaveValue('Conciliación de octubre');
    expect(patches(api)).toHaveLength(1);
  });

  it('«Reaplicar» espera a que termine de releerse la tarea después de un conflicto', async () => {
    const api = abrir('/tareas/1');
    const simulado = globalThis.fetch;
    let retener = false;
    const retenidos: (() => void)[] = [];
    vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) => (retener && String(entrada).endsWith('/api/tareas/1') && (init?.method ?? 'GET') === 'GET'
      ? new Promise<Response>((listo) => retenidos.push(() => void simulado(entrada, init).then(listo)))
      : simulado(entrada, init)));
    const usuario = userEvent.setup();
    const dialogo = await panel('T1');
    api.servidor.tareas.set(1, { ...api.servidor.tareas.get(1)!, titulo: 'Título de Martín', lockVersion: 4 });
    retener = true;
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Revisar contrato{Enter}');
    const version = await within(dialogo).findByRole('group', { name: 'Tu versión del título' });
    expect(within(version).getByRole('button', { name: 'Reaplicar' })).toBeDisabled();
    await waitFor(() => expect(retenidos).toHaveLength(1));
    retener = false;
    await act(async () => retenidos.shift()!());
    await waitFor(() => expect(within(version).getByRole('button', { name: 'Reaplicar' })).toBeEnabled());
    expect(titulo).toHaveValue('Título de Martín');
  });
});

describe('Avisos por campo', () => {
  it('guardar otro campo no borra el aviso del anterior', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    api.servidor.siguienteFalla = falla(422, 'validacion', 'El título no es válido.');
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Otro título{Enter}');
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('El título no es válido.');
    await usuario.selectOptions(within(dialogo).getByRole('combobox', { name: 'Prioridad' }), 'Alta');
    await waitFor(() => expect(patches(api)).toHaveLength(2));
    await waitFor(() => expect(within(dialogo).getByRole('combobox', { name: 'Prioridad' })).toHaveValue('9'));
    expect(within(dialogo).getByRole('alert')).toHaveTextContent('El título no es válido.');
  });
});

describe('Cerrar con cambios sin guardar', () => {
  const pregunta = () => screen.findByRole('alertdialog', { name: 'Tenés cambios sin guardar' });

  it('la X con un título escrito pregunta; «Descartar» cierra sin mandar nada', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Conciliar con el banco');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    const caja = await pregunta();
    expect(patches(api)).toEqual([]);
    await usuario.click(within(caja).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patches(api)).toEqual([]);
  });

  it('tocar afuera con un título escrito pregunta; «Guardar» lo guarda y después cierra', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Conciliar con el banco');
    await usuario.click(document.querySelector<HTMLElement>('.detalle__velo')!);
    const caja = await pregunta();
    await usuario.click(within(caja).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patches(api)).toEqual([{ lockVersion: 4, cambios: { titulo: 'Conciliar con el banco' } }]);
  });

  it('si guardar desde la pregunta falla, el panel queda abierto con lo escrito', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    api.servidor.siguienteFalla = falla(422, 'validacion', 'El título no es válido.');
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Conciliar con el banco');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    await usuario.click(within(await pregunta()).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('El título no es válido.');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Conciliación bancaria' })).toBeInTheDocument();
    expect(titulo).toHaveValue('Conciliar con el banco');
  });

  it('Escape con un comentario escrito pregunta; «Seguir editando» lo conserva', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    const caja = within(dialogo).getByRole('textbox', { name: 'Nuevo comentario' });
    await usuario.type(caja, 'Lo reviso mañana');
    await usuario.keyboard('{Escape}');
    await usuario.click(within(await pregunta()).getByRole('button', { name: 'Seguir editando' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Conciliación bancaria' })).toBeInTheDocument();
    expect(caja).toHaveValue('Lo reviso mañana');
    expect(caja).toHaveFocus();
    expect(api.llamadas.some((l) => l.ruta.endsWith('/comentarios'))).toBe(false);
  });

  describe('un comentario en camino no se manda dos veces', () => {
    const comentarios = (api: ReturnType<typeof abrir>) => api.llamadas.filter((l) => l.ruta === '/api/tareas/8/comentarios');

    // El POST del comentario queda retenido hasta soltarlo a mano.
    function abrirConComentarioRetenido(respuesta = ok({ actividades: [], sinReleer: null })) {
      const api = abrir('/tareas/8', { 'POST /api/tareas/8/comentarios': respuesta });
      const simulado = globalThis.fetch;
      const retenidos: (() => void)[] = [];
      vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) => (String(entrada).endsWith('/comentarios')
        ? new Promise<Response>((listo) => retenidos.push(() => void simulado(entrada, init).then(listo)))
        : simulado(entrada, init)));
      return { api, retenidos };
    }

    it('«Comentar» y la X enseguida: espera el envío y cierra sin preguntar', async () => {
      const { api, retenidos } = abrirConComentarioRetenido();
      const usuario = userEvent.setup();
      const dialogo = await panel();
      await usuario.type(within(dialogo).getByRole('textbox', { name: 'Nuevo comentario' }), 'Lo reviso mañana');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Comentar' }));
      await waitFor(() => expect(retenidos).toHaveLength(1));
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      await act(async () => retenidos.shift()!());
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(retenidos).toHaveLength(0);
      expect(comentarios(api)).toHaveLength(1);
    });

    it('con la pregunta abierta, «Comentar» y después «Guardar» manda un solo POST', async () => {
      const { api, retenidos } = abrirConComentarioRetenido();
      const usuario = userEvent.setup();
      const dialogo = await panel();
      await usuario.type(within(dialogo).getByRole('textbox', { name: 'Nuevo comentario' }), 'Lo reviso mañana');
      await usuario.keyboard('{Escape}');
      const caja = await pregunta();
      await usuario.click(within(dialogo).getByRole('button', { name: 'Comentar' }));
      await waitFor(() => expect(retenidos).toHaveLength(1));
      await usuario.click(within(caja).getByRole('button', { name: 'Guardar' }));
      await act(async () => retenidos.shift()!());
      // «Guardar» esperó al envío en curso en lugar de mandar otro.
      expect(retenidos).toHaveLength(0);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(comentarios(api)).toHaveLength(1);
    });

    it('si el envío falla, cerrar no pierde lo escrito: pregunta', async () => {
      const { retenidos } = abrirConComentarioRetenido(falla(422, 'validacion', 'El comentario no es válido.'));
      const usuario = userEvent.setup();
      const dialogo = await panel();
      const caja = within(dialogo).getByRole('textbox', { name: 'Nuevo comentario' });
      await usuario.type(caja, 'Lo reviso mañana');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Comentar' }));
      await waitFor(() => expect(retenidos).toHaveLength(1));
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
      await act(async () => retenidos.shift()!());
      expect(await pregunta()).toBeInTheDocument();
      expect(caja).toHaveValue('Lo reviso mañana');
      expect(screen.getByRole('dialog', { name: 'Conciliación bancaria' })).toBeInTheDocument();
    });
  });

  it('Escape en el editor de la descripción con cambios pregunta; «Guardar» guarda sin cerrar el panel', async () => {
    const api = abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Editar descripción' }));
    await usuario.type(within(dialogo).getByRole('textbox', { name: 'Descripción' }), ' y los cheques');
    await usuario.keyboard('{Escape}');
    await usuario.click(within(await pregunta()).getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(patches(api)).toEqual([{ lockVersion: 4, cambios: { descripcion: 'Revisar **todos** los extractos y los cheques' } }]));
    await waitFor(() => expect(within(dialogo).queryByRole('textbox', { name: 'Descripción' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Conciliación bancaria' })).toBeInTheDocument();
  });

  it('Escape en el editor de la descripción sin cambios sale sin preguntar', async () => {
    abrir('/tareas/8');
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Editar descripción' }));
    expect(within(dialogo).getByRole('textbox', { name: 'Descripción' })).toHaveFocus();
    await usuario.keyboard('{Escape}');
    expect(within(dialogo).queryByRole('textbox', { name: 'Descripción' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Conciliación bancaria' })).toBeInTheDocument();
  });
});

describe('Salir navegando con cambios sin guardar', () => {
  const pregunta = () => screen.findByRole('alertdialog', { name: 'Tenés cambios sin guardar' });

  // Abre T1 desde el tablero (así hay una entrada anterior en el historial) y escribe en el título.
  async function abrirYEscribir() {
    const api = abrir('/tareas');
    const usuario = userEvent.setup();
    const tarjeta = await waitFor(() => {
      const nodo = document.querySelector<HTMLElement>('[data-tarea-id="1"]');
      if (!nodo) throw new Error('falta la tarjeta');
      return nodo;
    });
    await usuario.click(tarjeta);
    const dialogo = await panel('T1');
    const titulo = within(dialogo).getByRole('textbox', { name: 'Título' });
    await usuario.clear(titulo);
    await usuario.type(titulo, 'Revisar contrato');
    return { api, usuario, dialogo, titulo };
  }

  it('Atrás con un borrador sin guardar pregunta antes de salir; «Seguir editando» conserva el texto', async () => {
    const { api, usuario, titulo } = await abrirYEscribir();
    act(() => window.history.back());
    const caja = await pregunta();
    expect(window.location.pathname).toBe('/tareas/1');
    await usuario.click(within(caja).getByRole('button', { name: 'Seguir editando' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/tareas/1');
    expect(titulo).toHaveValue('Revisar contrato');
    expect(patches(api)).toEqual([]);
  });

  it('un enlace de la barra lateral con un borrador sin guardar pregunta antes de salir', async () => {
    const { api, usuario } = await abrirYEscribir();
    fireEvent.click(screen.getByRole('link', { name: 'Calendario' }));
    const caja = await pregunta();
    expect(window.location.pathname).toBe('/tareas/1');
    await usuario.click(within(caja).getByRole('button', { name: 'Seguir editando' }));
    expect(window.location.pathname).toBe('/tareas/1');
    expect(patches(api)).toEqual([]);
  });

  it('descartar el borrador deja seguir la navegación', async () => {
    const { api, usuario } = await abrirYEscribir();
    fireEvent.click(screen.getByRole('link', { name: 'Calendario' }));
    await usuario.click(within(await pregunta()).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(window.location.pathname).toBe('/calendario'));
    // La URL cambia antes de que React desmonte el panel: se espera a que se cierre.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patches(api)).toEqual([]);
  });

  it('guardar desde la pregunta guarda y después sigue la navegación', async () => {
    const { api, usuario } = await abrirYEscribir();
    fireEvent.click(screen.getByRole('link', { name: 'Calendario' }));
    await usuario.click(within(await pregunta()).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(window.location.pathname).toBe('/calendario'));
    expect(patches(api)).toEqual([{ lockVersion: 3, cambios: { titulo: 'Revisar contrato' } }]);
  });

  it('sin borradores la navegación sigue sin preguntar', async () => {
    abrir('/tareas/1');
    await panel('T1');
    fireEvent.click(screen.getByRole('link', { name: 'Calendario' }));
    await waitFor(() => expect(window.location.pathname).toBe('/calendario'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cerrar la pestaña con un borrador sin guardar pide confirmación', async () => {
    await abrirYEscribir();
    const evento = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
  });

  it('cerrar la pestaña sin borradores no frena nada', async () => {
    abrir('/tareas/1');
    await panel('T1');
    const evento = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(false);
  });
});
