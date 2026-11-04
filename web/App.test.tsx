import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from './App.js';
import { falla, limpiarEntorno, prepararEntorno, simularApi } from '../pruebas/fabricas/web.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

it('muestra el nombre de la app', async () => {
  prepararEntorno('/');
  simularApi({ 'GET /api/auth/yo': falla(401, 'no-sesion', 'Tenés que iniciar sesión') });
  render(<App />);
  expect(await screen.findByText('OpenDash')).toBeInTheDocument();
});
