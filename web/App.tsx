import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { crearClienteConsultas } from './api/consultas.js';
import { DialogoTokenNuevo } from './ingreso/DialogoTokenNuevo.js';
import { PantallaIngreso } from './ingreso/PantallaIngreso.js';
import { RUTA_INGRESO, RUTA_INICIAL, VigilanteSesion } from './ingreso/sesion.js';
import { LimiteDeErrores } from './marco/LimiteDeErrores.js';
import { Marco } from './marco/Marco.js';
import { PantallaProximamente } from './marco/PantallaProvisoria.js';
import { SECCIONES } from './marco/secciones.js';
import { EscuchaNuevaTarea } from './tareas/EscuchaNuevaTarea.js';

const PROXIMAS = SECCIONES.filter((s) => !s.disponible);

// Las pantallas pesadas se cargan al entrar en su ruta, no con el resto de la app.
const cargarInicio: RouteObject['lazy'] = () =>
  import('./inicio/PantallaInicio.js').then((m) => ({ Component: m.PantallaInicio }));
const cargarTareas: RouteObject['lazy'] = () =>
  import('./tareas/PantallaTareas.js').then((m) => ({ Component: m.PantallaTareas }));

const cargarOrdenar: RouteObject['lazy'] = () =>
  import('./ordenar/PantallaParaOrdenar.js').then((m) => ({ Component: m.PantallaParaOrdenar }));
const cargarProblemas: RouteObject['lazy'] = () =>
  import('./avisos-problema/PantallaProblemas.js').then((m) => ({ Component: m.PantallaProblemas }));
const cargarCalendario: RouteObject['lazy'] = () =>
  import('./calendario/PantallaCalendario.js').then((m) => ({ Component: m.PantallaCalendario }));
const cargarProyectos: RouteObject['lazy'] = () =>
  import('./proyectos/PantallaProyectos.js').then((m) => ({ Component: m.PantallaProyectos }));
const cargarProyecto: RouteObject['lazy'] = () =>
  import('./proyectos/PantallaProyecto.js').then((m) => ({ Component: m.PantallaProyecto }));
const cargarLinea: RouteObject['lazy'] = () =>
  import('./linea/PantallaLinea.js').then((m) => ({ Component: m.PantallaLinea }));
const cargarEquipo:RouteObject['lazy'] = () =>
  import('./equipo/PantallaEquipo.js').then((m) => ({ Component: m.PantallaEquipo }));
const cargarPersona: RouteObject['lazy'] = () =>
  import('./equipo/PantallaPersona.js').then((m) => ({ Component: m.PantallaPersona }));
const cargarMetricas: RouteObject['lazy'] = () =>
  import('./metricas/PantallaMetricas.js').then((m) => ({ Component: m.PantallaMetricas }));
const cargarConfiguracion: RouteObject['lazy'] = () =>
  import('./configuracion/PantallaConfiguracion.js').then((m) => ({ Component: m.PantallaConfiguracion }));

// Página de muestras de las piezas: solo existe en desarrollo (el build la descarta).
const RUTA_MUESTRAS: RouteObject[] = import.meta.env.DEV
  ? [{ path: '/muestras', lazy: () => import('./muestras/PantallaMuestras.js').then((m) => ({ Component: m.PantallaMuestras })) }]
  : [];

/** Raíz de diseño: lo que escucha la sesión y los pedidos globales tiene que vivir dentro del router. */
function Raiz() {
  return (
    <>
      <Outlet />
      <VigilanteSesion />
      <EscuchaNuevaTarea />
      <DialogoTokenNuevo />
    </>
  );
}

// Espera de la primera carga: solo el fondo, sin nada que parpadee.
const Espera = () => <div className="min-h-screen" aria-hidden="true" />;

function crearRouter() {
  return createBrowserRouter([
    {
      element: <Raiz />,
      hydrateFallbackElement: <Espera />,
      children: [
        { path: RUTA_INGRESO, element: <PantallaIngreso /> },
        ...RUTA_MUESTRAS,
        { path: '/', element: <Navigate to={RUTA_INICIAL} replace /> },
        {
          element: <LimiteDeErrores completo><Marco /></LimiteDeErrores>,
          children: [
            { path: '/inicio', lazy: cargarInicio },
            { path: '/calendario', lazy: cargarCalendario },
            { path: '/tareas', lazy: cargarTareas },
            { path: '/tareas/:id', lazy: cargarTareas },
            { path: '/para-ordenar', lazy: cargarOrdenar },
            { path: '/para-ordenar/tareas/:tareaId', lazy: cargarOrdenar },
            { path: '/problemas-avisados', lazy: cargarProblemas },
            { path: '/proyectos', lazy: cargarProyectos },
            { path: '/proyectos/:id', lazy: cargarProyecto },
            { path: '/proyectos/:id/tareas/:tareaId', lazy: cargarProyecto },
            { path: '/linea-de-tiempo', lazy: cargarLinea },
            { path: '/linea-de-tiempo/tareas/:tareaId', lazy: cargarLinea },
            { path: '/metricas', lazy: cargarMetricas },
            { path: '/configuracion', lazy: cargarConfiguracion },
            { path: '/equipo', lazy: cargarEquipo },
            { path: '/equipo/:id', lazy: cargarPersona },
            { path: '/equipo/:id/tareas/:tareaId', lazy: cargarPersona },
            ...PROXIMAS.map((s): RouteObject => ({ path: s.ruta, element: <PantallaProximamente seccion={s} /> })),
            { path: '*', element: <Navigate to={RUTA_INICIAL} replace /> },
          ],
        },
      ],
    },
  ]);
}

export function App() {
  const [cliente] = useState(crearClienteConsultas);
  // Un router por montaje: lee la dirección actual al crearse (las pruebas la fijan antes de montar).
  const [router] = useState(crearRouter);
  return (
    <QueryClientProvider client={cliente}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
