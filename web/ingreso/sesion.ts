import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { EVENTO_SIN_SESION, olvidarEstadoDeSesion, pedir } from '../api/cliente.js';

export const RUTA_INGRESO = '/ingreso';
export const RUTA_INICIAL = '/inicio';

/** Estado que viaja a /ingreso para volver después adonde se quería ir. */
export interface EstadoIngreso { desde?: string }

/** Tras entrar: descarta lo cacheado (podía ser de otra sesión) y va adonde se quería ir. */
export function useAlEntrar(): () => void {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const { state } = useLocation();
  const desde = (state as EstadoIngreso | null)?.desde;
  // Solo rutas propias: nada de `//otro-sitio` ni volver al mismo ingreso.
  const interna = typeof desde === 'string' && desde.startsWith('/') && !desde.startsWith('//') && !desde.startsWith(RUTA_INGRESO);
  return () => {
    cliente.clear();
    olvidarEstadoDeSesion();
    navegar(interna ? desde : RUTA_INICIAL, { replace: true });
  };
}

export function useCerrarSesion() {
  const cliente = useQueryClient();
  const navegar = useNavigate();
  return useMutation({
    mutationFn: () => pedir<unknown>('POST', '/api/auth/salir'),
    onSuccess: () => {
      navegar(RUTA_INGRESO, { replace: true });
      cliente.clear();
      olvidarEstadoDeSesion();
    },
  });
}

/** Si el servidor dice que no hay sesión (venció o se cerró en otra pestaña), vuelve al ingreso. */
export function VigilanteSesion(): null {
  const navegar = useNavigate();
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (pathname === RUTA_INGRESO) return;
    const alPerderla = () => {
      const estado: EstadoIngreso = { desde: pathname + search };
      navegar(RUTA_INGRESO, { replace: true, state: estado });
    };
    window.addEventListener(EVENTO_SIN_SESION, alPerderla);
    return () => window.removeEventListener(EVENTO_SIN_SESION, alPerderla);
  }, [navegar, pathname, search]);
  return null;
}
