import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Reunion } from '../../compartido/tipos.js';
import { AvisadorReuniones } from './VigilanteReuniones.js';
import type { PermisoAvisos } from './usePermisoAvisos.js';

const reunionDe = (extra: Partial<Reunion> = {}): Reunion => ({
  id: 'r1', titulo: 'Semanal', lugar: null, inicio: '2026-10-26T13:00:00Z', fin: '2026-10-26T14:00:00Z',
  diaEntero: false, libre: false, enlace: 'https://teams.microsoft.com/l/x', plataforma: 'teams', ...extra,
});
const permisoDe = (extra: Partial<PermisoAvisos> = {}): PermisoAvisos => ({
  estado: 'granted', pedir: async () => undefined, ahoraNo: () => undefined, rechazado: false, preguntar: false, ...extra,
});

const notificaciones: { titulo: string; opciones: NotificationOptions }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-26T12:50:00Z'));
  notificaciones.length = 0;
  document.title = 'OpenDash';
  class NotificacionFalsa {
    static permission = 'granted';
    onclick: (() => void) | null = null;
    constructor(titulo: string, opciones: NotificationOptions) { notificaciones.push({ titulo, opciones }); }
    close(): void { /* nada */ }
  }
  vi.stubGlobal('Notification', NotificacionFalsa);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* sin almacenamiento */ }
});

const avanzar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('Aviso de reunión', () => {
  it('muestra el aviso a la hora y cambia el título', async () => {
    render(<AvisadorReuniones reuniones={[reunionDe()]} minutos={5} permiso={permisoDe()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await avanzar(5 * 60_000);
    expect(screen.getByRole('status')).toHaveTextContent('En 5 min');
    expect(screen.getByRole('status')).toHaveTextContent('Semanal');
    expect(screen.getByRole('link', { name: 'Unirse' })).toHaveAttribute('href', 'https://teams.microsoft.com/l/x');
    expect(document.title).toBe('🔔 Semanal en 5 min');
  });

  it('crea la Notification con la tag de la reunión', async () => {
    render(<AvisadorReuniones reuniones={[reunionDe()]} minutos={5} permiso={permisoDe()} />);
    await avanzar(5 * 60_000);
    expect(notificaciones).toHaveLength(1);
    expect(notificaciones[0]?.titulo).toBe('En 5 min: Semanal');
    expect(notificaciones[0]?.opciones.tag).toBe('r1@2026-10-26T13:00:00Z');
  });

  it('sin Notification, solo el aviso dentro de OpenDash', async () => {
    vi.stubGlobal('Notification', undefined);
    render(<AvisadorReuniones reuniones={[reunionDe()]} minutos={5} permiso={permisoDe({ estado: 'no-disponible' })} />);
    await avanzar(5 * 60_000);
    expect(screen.getByRole('status')).toHaveTextContent('Semanal');
    expect(notificaciones).toHaveLength(0);
  });

  it('la X lo cierra y no vuelve', async () => {
    render(<AvisadorReuniones reuniones={[reunionDe()]} minutos={5} permiso={permisoDe()} />);
    await avanzar(5 * 60_000);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await avanzar(60_000);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.title).toBe('OpenDash');
  });

  it('una reunión borrada en el calendario nuevo no avisa', async () => {
    const { rerender } = render(<AvisadorReuniones reuniones={[reunionDe()]} minutos={5} permiso={permisoDe()} />);
    await avanzar(60_000);
    rerender(<AvisadorReuniones reuniones={[]} minutos={5} permiso={permisoDe()} />);
    await avanzar(10 * 60_000);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(notificaciones).toHaveLength(0);
  });

  it('una reunión movida avisa a la hora nueva y no a la vieja', async () => {
    const { rerender } = render(<AvisadorReuniones reuniones={[reunionDe()]} minutos={5} permiso={permisoDe()} />);
    rerender(<AvisadorReuniones reuniones={[reunionDe({ inicio: '2026-10-26T13:30:00Z', fin: '2026-10-26T14:30:00Z' })]} minutos={5} permiso={permisoDe()} />);
    await avanzar(5 * 60_000);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await avanzar(30 * 60_000);
    expect(notificaciones).toHaveLength(1);
    expect(notificaciones[0]?.opciones.tag).toBe('r1@2026-10-26T13:30:00Z');
  });

  it('con una reunión ya cerca al llegar el calendario, avisa enseguida y una sola vez', async () => {
    vi.setSystemTime(new Date('2026-10-26T12:57:00Z'));
    const { rerender } = render(<AvisadorReuniones reuniones={[reunionDe()]} minutos={5} permiso={permisoDe()} />);
    await avanzar(0);
    expect(screen.getByRole('status')).toHaveTextContent('En 3 min');
    rerender(<AvisadorReuniones reuniones={[reunionDe()]} minutos={5} permiso={permisoDe()} />);
    await avanzar(0);
    expect(notificaciones).toHaveLength(1);
  });

  it('pide el permiso con el diálogo y respeta «Ahora no»', async () => {
    const pedir = vi.fn(async () => undefined);
    const ahoraNo = vi.fn();
    render(<AvisadorReuniones reuniones={[reunionDe()]} minutos={5} permiso={permisoDe({ estado: 'default', preguntar: true, pedir, ahoraNo })} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('¿Te avisamos de las reuniones?');
    fireEvent.click(screen.getByRole('button', { name: 'Permitir' }));
    expect(pedir).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(ahoraNo).toHaveBeenCalledOnce();
  });

  it('sin reuniones pendientes no pregunta el permiso', () => {
    render(<AvisadorReuniones reuniones={[]} minutos={5} permiso={permisoDe({ estado: 'default', preguntar: true })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
