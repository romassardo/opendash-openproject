import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../App.js';
import { falla, limpiarEntorno, ok, prepararEntorno, simularApi, YO } from '../../pruebas/fabricas/web.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

describe('Pantalla de ingreso', () => {
  it('sin sesión lleva a /ingreso', async () => {
    prepararEntorno('/');
    simularApi({ 'GET /api/auth/yo': falla(401, 'no-sesion', 'Tenés que iniciar sesión') });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/ingreso');
  });

  it('primera vez: registra y entra a Inicio', async () => {
    prepararEntorno('/ingreso');
    const api = simularApi({ 'POST /api/auth/registro': ok({ id: YO.id, login: YO.login, nombre: YO.nombre }) });
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(await screen.findByRole('radio', { name: 'Primera vez' }));
    expect(screen.getByText('En OpenProject: tu avatar → Mi cuenta → Tokens de acceso → API → Generar')).toBeInTheDocument();
    await usuario.type(screen.getByLabelText('Token de OpenProject'), 'token-de-prueba');
    await usuario.type(screen.getByLabelText('Contraseña'), 'clave-segura');
    await usuario.type(screen.getByLabelText('Repetir contraseña'), 'clave-segura');
    await usuario.click(screen.getByRole('button', { name: 'Crear cuenta y entrar' }));
    expect(await screen.findByRole('heading', { level: 1, name: /, Ana$/ })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/inicio');
    expect(api.llamadas).toContainEqual({
      metodo: 'POST',
      ruta: '/api/auth/registro',
      cuerpo: { token: 'token-de-prueba', contrasena: 'clave-segura' },
    });
  });

  it('avisa si las contraseñas no coinciden', async () => {
    prepararEntorno('/ingreso');
    const api = simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(await screen.findByRole('radio', { name: 'Primera vez' }));
    await usuario.type(screen.getByLabelText('Token de OpenProject'), 'token-de-prueba');
    await usuario.type(screen.getByLabelText('Contraseña'), 'clave-segura');
    await usuario.type(screen.getByLabelText('Repetir contraseña'), 'otra-clave');
    await usuario.click(screen.getByRole('button', { name: 'Crear cuenta y entrar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Las contraseñas no coinciden');
    expect(api.llamadas).toEqual([]);
  });

  it('entra con usuario y contraseña y vuelve adonde quería ir', async () => {
    prepararEntorno('/equipo');
    let conSesion = false;
    const api = simularApi({
      'GET /api/auth/yo': () => (conSesion ? ok(YO) : falla(401, 'no-sesion', 'Tenés que iniciar sesión')),
      'POST /api/auth/ingreso': () => {
        conSesion = true;
        return ok({ id: YO.id });
      },
    });
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.type(await screen.findByLabelText('Usuario de OpenProject'), 'apereyra');
    await usuario.type(screen.getByLabelText('Contraseña'), 'clave-segura');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { name: 'Equipo' })).toBeInTheDocument();
    expect(api.llamadas).toContainEqual({
      metodo: 'POST',
      ruta: '/api/auth/ingreso',
      cuerpo: { login: 'apereyra', contrasena: 'clave-segura' },
    });
  });

  it('muestra el mensaje del servidor cuando no puede entrar', async () => {
    prepararEntorno('/ingreso');
    simularApi({ 'POST /api/auth/ingreso': falla(429, 'demasiados-intentos', 'Demasiados intentos, probá de nuevo en unos minutos') });
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.type(await screen.findByLabelText('Usuario de OpenProject'), 'apereyra');
    await usuario.type(screen.getByLabelText('Contraseña'), 'clave');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos, probá de nuevo en unos minutos');
    expect(window.location.pathname).toBe('/ingreso');
  });

  it('pide al menos 8 caracteres de contraseña antes de registrar', async () => {
    prepararEntorno('/ingreso');
    const api = simularApi();
    const usuario = userEvent.setup();
    render(<App />);
    await usuario.click(await screen.findByRole('radio', { name: 'Primera vez' }));
    await usuario.type(screen.getByLabelText('Token de OpenProject'), 'token-de-prueba');
    await usuario.type(screen.getByLabelText('Contraseña'), 'corta');
    await usuario.type(screen.getByLabelText('Repetir contraseña'), 'corta');
    await usuario.click(screen.getByRole('button', { name: 'Crear cuenta y entrar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('La contraseña tiene que tener al menos 8 caracteres');
    expect(api.llamadas).toEqual([]);
  });
});
