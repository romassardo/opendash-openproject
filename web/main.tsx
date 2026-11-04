import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { prepararTema } from './marco/tema.js';
import { registrar } from './pwa/registrar.js';
// Inter auto-alojada (ejes opsz y wght), sin pedir nada a servicios externos.
import '@fontsource-variable/inter/opsz.css';
import './estilos.css';

prepararTema();
if (import.meta.env.PROD) registrar();

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('No se encontró el nodo #raiz');
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
