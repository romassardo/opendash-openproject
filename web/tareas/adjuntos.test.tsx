import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Adjunto } from '../../compartido/tipos.js';
import { abrirDetalle, panel } from '../../pruebas/fabricas/detalle.js';
import { limpiarEntorno, ok } from '../../pruebas/fabricas/web.js';

const MB = 1024 * 1024;
const adjunto = (id: number, nombre: string, extra: Partial<Adjunto> = {}): Adjunto =>
  ({ id, nombre, bytes: 2048, tipo: 'text/plain', autorId: 5, creado: new Date().toISOString(), puedeBorrar: true, ...extra });

/** XMLHttpRequest de mentira: guarda los envíos para que la prueba avance el progreso y responda a mano. */
class XhrFalso {
  static todos: XhrFalso[] = [];
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  abortado = false;
  status = 0;
  responseText = '';
  metodo = '';
  url = '';
  cabeceras: Record<string, string> = {};
  enviado: Blob | null = null;
  withCredentials = false;
  open(metodo: string, url: string) { this.metodo = metodo; this.url = url; XhrFalso.todos.push(this); }
  setRequestHeader(nombre: string, valor: string) { this.cabeceras[nombre] = valor; }
  send(cuerpo: Blob) { this.enviado = cuerpo; }
  abort() { this.abortado = true; this.onabort?.(); }
  responder(estado: number, cuerpo: unknown) { this.status = estado; this.responseText = JSON.stringify(cuerpo); this.onload?.(); }
}

afterEach(() => {
  cleanup();
  limpiarEntorno();
  XhrFalso.todos = [];
});

const conLista = (adjuntos: Adjunto[], puedeAdjuntar = true) => ({
  'GET /api/tareas/8/adjuntos': ok({ adjuntos, puedeAdjuntar, maximoBytes: 5 * MB }),
});

describe('Adjuntos del detalle', () => {
  it('muestra «Sin adjuntos» y, sin permiso, no ofrece adjuntar', async () => {
    abrirDetalle('/tareas/8', conLista([], false));
    const dialogo = await panel();
    expect(await within(dialogo).findByText('Sin adjuntos')).toBeInTheDocument();
    expect(within(dialogo).queryByRole('button', { name: 'Adjuntar' })).toBeNull();
  });

  it('lista los adjuntos con tamaño y el tacho solo en los que se pueden borrar', async () => {
    abrirDetalle('/tareas/8', conLista([adjunto(1, 'a.txt'), adjunto(2, 'b.pdf', { puedeBorrar: false, tipo: 'application/pdf' })]));
    const dialogo = await panel();
    const lista = await within(dialogo).findByRole('list', { name: 'Adjuntos' });
    expect(within(lista).getByRole('link', { name: 'a.txt' })).toHaveAttribute('href', '/api/adjuntos/1/contenido');
    expect(within(lista).getAllByText(/^2 KB · /).length).toBeGreaterThan(0);
    expect(within(lista).getByRole('button', { name: 'Borrar a.txt' })).toBeInTheDocument();
    expect(within(lista).queryByRole('button', { name: 'Borrar b.pdf' })).toBeNull();
  });

  it('arrastrar dos archivos sube los dos con progreso', async () => {
    abrirDetalle('/tareas/8', conLista([]));
    vi.stubGlobal('XMLHttpRequest', XhrFalso);
    const dialogo = await panel();
    await within(dialogo).findByText('Sin adjuntos');
    const zona = within(dialogo).getByTestId('zona-adjuntos');
    const uno = new File(['hola'], 'uno ñ.txt', { type: 'text/plain' });
    const dos = new File(['mundo'], 'dos.png', { type: 'image/png' });
    fireEvent.drop(zona, { dataTransfer: { files: [uno, dos] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    expect(XhrFalso.todos.map((x) => x.url)).toEqual([
      `/api/tareas/8/adjuntos?nombre=${encodeURIComponent('uno ñ.txt')}`,
      '/api/tareas/8/adjuntos?nombre=dos.png',
    ]);
    expect(XhrFalso.todos[1]!.cabeceras['Content-Type']).toBe('image/png');
    act(() => XhrFalso.todos[0]!.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 }));
    expect(within(dialogo).getByRole('progressbar', { name: 'Subiendo uno ñ.txt' })).toHaveAttribute('value', '0.5');
    await act(async () => XhrFalso.todos[0]!.responder(200, { ok: true, datos: adjunto(3, 'uno_ñ.txt'), desactualizado: false }));
    await waitFor(() => expect(within(dialogo).queryByRole('progressbar', { name: 'Subiendo uno ñ.txt' })).toBeNull());
    expect(within(dialogo).getByRole('progressbar', { name: 'Subiendo dos.png' })).toBeInTheDocument();
  });

  it('un archivo de 7 MB muestra el texto del máximo y no sube', async () => {
    abrirDetalle('/tareas/8', conLista([]));
    vi.stubGlobal('XMLHttpRequest', XhrFalso);
    const dialogo = await panel();
    await within(dialogo).findByText('Sin adjuntos');
    const grande = new File([new Uint8Array(7 * MB)], 'x.zip');
    fireEvent.drop(within(dialogo).getByTestId('zona-adjuntos'), { dataTransfer: { files: [grande] } });
    expect(await within(dialogo).findByText('“x.zip” pesa 7 MB y el máximo es 5 MB')).toBeInTheDocument();
    expect(XhrFalso.todos).toHaveLength(0);
  });

  it('un error del servidor al subir queda a la vista en esa fila', async () => {
    abrirDetalle('/tareas/8', conLista([]));
    vi.stubGlobal('XMLHttpRequest', XhrFalso);
    const dialogo = await panel();
    await within(dialogo).findByText('Sin adjuntos');
    fireEvent.drop(within(dialogo).getByTestId('zona-adjuntos'), { dataTransfer: { files: [new File(['x'], 'y.txt')] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await act(async () => XhrFalso.todos[0]!.responder(403, { ok: false, codigo: 'prohibido', mensaje: 'No tenés permiso para hacer eso en OpenProject' }));
    expect(await within(dialogo).findByText('No tenés permiso para hacer eso en OpenProject')).toBeInTheDocument();
  });

  it('un corte de red al subir deja el error a la vista, no «Subiendo» para siempre', async () => {
    abrirDetalle('/tareas/8', conLista([]));
    vi.stubGlobal('XMLHttpRequest', XhrFalso);
    const dialogo = await panel();
    await within(dialogo).findByText('Sin adjuntos');
    fireEvent.drop(within(dialogo).getByTestId('zona-adjuntos'), { dataTransfer: { files: [new File(['x'], 'y.txt')] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => XhrFalso.todos[0]!.onerror?.());
    expect(await within(dialogo).findByText(/No hay conexión con OpenDash/)).toBeInTheDocument();
    expect(within(dialogo).queryByRole('progressbar', { name: 'Subiendo y.txt' })).toBeNull();
  });

  it('al cerrar el detalle se abortan las subidas en curso', async () => {
    abrirDetalle('/tareas/8', conLista([]));
    vi.stubGlobal('XMLHttpRequest', XhrFalso);
    const dialogo = await panel();
    await within(dialogo).findByText('Sin adjuntos');
    fireEvent.drop(within(dialogo).getByTestId('zona-adjuntos'), { dataTransfer: { files: [new File(['x'], 'y.txt')] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    cleanup();
    expect(XhrFalso.todos[0]!.abortado).toBe(true);
  });

  it('el tacho pide confirmación antes de borrar', async () => {
    const api = abrirDetalle('/tareas/8', { ...conLista([adjunto(1, 'a.txt')]), 'DELETE /api/adjuntos/1': ok({}) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar a.txt' }));
    expect(within(dialogo).getByText('¿Borrar “a.txt”? No se puede deshacer')).toBeInTheDocument();
    expect(api.llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(api.llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Borrar a.txt' }));
    await usuario.click(within(dialogo).getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(api.llamadas.filter((l) => l.metodo === 'DELETE')).toEqual([{ metodo: 'DELETE', ruta: '/api/adjuntos/1', cuerpo: undefined }]));
  });

  it('después de subir se vuelve a pedir la lista de adjuntos', async () => {
    const api = abrirDetalle('/tareas/8', conLista([]));
    vi.stubGlobal('XMLHttpRequest', XhrFalso);
    const dialogo = await panel();
    await within(dialogo).findByText('Sin adjuntos');
    const pedidas = () => api.llamadas.filter((l) => l.metodo === 'GET' && l.ruta === '/api/tareas/8/adjuntos').length;
    const antes = pedidas();
    fireEvent.drop(within(dialogo).getByTestId('zona-adjuntos'), { dataTransfer: { files: [new File(['x'], 'y.txt')] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await act(async () => XhrFalso.todos[0]!.responder(200, { ok: true, datos: adjunto(3, 'y.txt'), desactualizado: false }));
    await waitFor(() => expect(pedidas()).toBeGreaterThan(antes));
  });

  it('mientras no se conoce el máximo no se sube nada', async () => {
    abrirDetalle('/tareas/8', { 'GET /api/tareas/8/adjuntos': () => new Promise(() => {}) as never });
    vi.stubGlobal('XMLHttpRequest', XhrFalso);
    const dialogo = await panel();
    fireEvent.drop(within(dialogo).getByTestId('zona-adjuntos'), { dataTransfer: { files: [new File(['x'], 'y.txt')] } });
    await new Promise((r) => setTimeout(r, 30));
    expect(XhrFalso.todos).toHaveLength(0);
  });

  it('un archivo soltado fuera de la zona no lo abre el navegador', async () => {
    abrirDetalle('/tareas/8', conLista([], false));
    const dialogo = await panel();
    await within(dialogo).findByText('Sin adjuntos');
    const evento = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(evento, 'dataTransfer', { value: { types: ['Files'] } });
    dialogo.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
    const texto = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(texto, 'dataTransfer', { value: { types: ['text/plain'] } });
    dialogo.dispatchEvent(texto);
    expect(texto.defaultPrevented).toBe(false);
  });

  it('en la confirmación de borrar, Escape cancela sin cerrar el detalle y el foco vuelve al tacho', async () => {
    abrirDetalle('/tareas/8', { ...conLista([adjunto(1, 'a.txt')]), 'DELETE /api/adjuntos/1': ok({}) });
    const usuario = userEvent.setup();
    const dialogo = await panel();
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Borrar a.txt' }));
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await usuario.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Conciliación bancaria' })).toBeInTheDocument();
    expect(within(dialogo).queryByRole('group', { name: /Confirmar el borrado/ })).toBeNull();
    expect(within(dialogo).getByRole('button', { name: 'Borrar a.txt' })).toHaveFocus();
  });
});
