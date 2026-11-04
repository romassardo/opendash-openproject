import type { ContextoAviso } from '../../compartido/tipos.js';
import { errorReciente } from './ultimoError.js';

const versionDelBuild = (): string => (typeof __VERSION_OPENDASH__ === 'string' ? __VERSION_OPENDASH__ : 'sin-git');

/**
 * Lo que se adjunta solo a un aviso: pantalla, navegador, ventana, tema, versión y el error. Con `error` (el que ya tiene
 * quien avisa, por ejemplo el límite de errores) se usa ese; si no, el último error anotado de los 10 minutos anteriores.
 */
export function armarContexto(ubicacion: { pathname: string }, ahora: Date = new Date(), error?: string): ContextoAviso {
  const titulo = document.querySelector('h1')?.getAttribute('aria-label') ?? document.title;
  return {
    ruta: ubicacion.pathname.slice(0, 500),
    titulo: titulo.slice(0, 300),
    navegador: navigator.userAgent.slice(0, 500),
    ventana: `${window.innerWidth}x${window.innerHeight}`,
    tema: document.documentElement.dataset.tema === 'claro' ? 'claro' : 'oscuro',
    version: versionDelBuild().slice(0, 50),
    error: error !== undefined ? error.slice(0, 1500) : errorReciente(ahora),
  };
}
