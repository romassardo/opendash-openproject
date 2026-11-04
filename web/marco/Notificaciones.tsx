import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import type { Notificacion } from '../../compartido/tipos.js';
import { EVENTO_TOKEN_VENCIDO, ErrorApi, pedir } from '../api/cliente.js';
import { CLAVES, useCatalogo, useNotificaciones } from '../api/consultas.js';
import { Avatar } from '../ui/Avatar.js';
import { Aviso } from '../ui/Aviso.js';
import { unir } from '../ui/clases.js';
import { tiempoRelativo } from '../ui/tiempo.js';
import { Vidrio } from '../ui/Vidrio.js';
import { motivoEnCastellano } from './notificacionesLogica.js';
import { rutaDeTarea } from './busquedaLogica.js';

const ID_PANEL = 'panel-notificaciones';

interface ResultadoMarca { fallidas: number[]; mensaje: string | null }

const MENSAJE_FALLA = 'No se pudo marcar como leída.';
const mensajeDe = (error: unknown) => (error instanceof ErrorApi ? error.mensaje : MENSAJE_FALLA);

/**
 * Marca como leídas las notificaciones dadas: primero en pantalla, después en el servidor (una sola
 * llamada para todas). Devuelve las que el servidor rechazó (ya quedaron otra vez sin leer) y el mensaje.
 */
function useMarcarLeidas() {
  const cliente = useQueryClient();
  const cambiar = (ids: ReadonlySet<number>, leida: boolean) =>
    cliente.setQueryData<Notificacion[]>(CLAVES.notificaciones, (lista) =>
      lista?.map((n) => (ids.has(n.id) ? { ...n, leida } : n)));

  const enviar = async (ids: number[]): Promise<ResultadoMarca> => {
    try {
      if (ids.length === 1) {
        await pedir<unknown>('POST', `/api/notificaciones/${ids[0]}/leida`);
        return { fallidas: [], mensaje: null };
      }
      const { fallidas } = await pedir<{ fallidas: number[] }>('POST', '/api/notificaciones/leidas', { ids });
      return { fallidas, mensaje: fallidas.length > 0 ? MENSAJE_FALLA : null };
    } catch (error) {
      return { fallidas: ids, mensaje: mensajeDe(error) };
    }
  };

  return async (ids: number[]): Promise<ResultadoMarca> => {
    if (ids.length === 0) return { fallidas: [], mensaje: null };
    await cliente.cancelQueries({ queryKey: CLAVES.notificaciones });
    cambiar(new Set(ids), true);
    const resultado = await enviar(ids);
    if (resultado.fallidas.length > 0) cambiar(new Set(resultado.fallidas), false);
    void cliente.invalidateQueries({ queryKey: CLAVES.notificaciones });
    return resultado;
  };
}

/** La campanita de la barra y su panel de novedades de OpenProject. */
export function Notificaciones({ suspendida = false }: { suspendida?: boolean }) {
  const notificaciones = useNotificaciones();
  const catalogo = useCatalogo();
  const navegar = useNavigate();
  const marcar = useMarcarLeidas();
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  // El foco va a la parte que se desplaza: así las flechas y AvPág mueven la lista.
  const desplazable = useRef<HTMLDivElement>(null);
  const [lugar, setLugar] = useState<CSSProperties>({});
  // Al reabrir tras un error, el foco se queda en la pantalla a la que se navegó.
  const enfocarAlAbrir = useRef(true);

  const lista = notificaciones.data ?? [];
  const sinLeer = lista.filter((n) => !n.leida);
  const personas = new Map((catalogo.data?.personas ?? []).map((p) => [p.id, p]));

  // La paleta o el diálogo de token pasan por encima: el panel se aparta.
  useEffect(() => {
    if (suspendida) setAbierto(false);
  }, [suspendida]);

  useEffect(() => {
    const cerrarTodo = () => setAbierto(false);
    window.addEventListener(EVENTO_TOKEN_VENCIDO, cerrarTodo);
    return () => window.removeEventListener(EVENTO_TOKEN_VENCIDO, cerrarTodo);
  }, []);

  const cerrar = (devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  };

  // El panel va en el body (así su vidrio desenfoca la página) y se coloca bajo la campanita.
  useLayoutEffect(() => {
    if (!abierto) return;
    const colocar = () => {
      const rect = boton.current?.getBoundingClientRect();
      if (rect) setLugar({ top: rect.bottom + 14, right: Math.max(8, window.innerWidth - rect.right - 7) });
    };
    colocar();
    window.addEventListener('resize', colocar);
    window.addEventListener('scroll', colocar, true);
    return () => {
      window.removeEventListener('resize', colocar);
      window.removeEventListener('scroll', colocar, true);
    };
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    if (enfocarAlAbrir.current) desplazable.current?.focus();
    enfocarAlAbrir.current = true;
    const alTocar = (evento: PointerEvent) => {
      const destino = evento.target as Node;
      if (!caja.current?.contains(destino) && !panel.current?.contains(destino)) setAbierto(false);
    };
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', alTocar);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('pointerdown', alTocar);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);

  const abrirNotificacion = (n: Notificacion) => {
    cerrar(false);
    if (!n.leida) {
      void marcar([n.id]).then(({ mensaje }) => {
        if (mensaje === null) return;
        // Falló: la notificación vuelve a figurar sin leer y el panel se reabre con el motivo.
        setAviso(mensaje);
        enfocarAlAbrir.current = false;
        setAbierto(true);
      });
    }
    if (n.tareaId !== null) void navegar(rutaDeTarea(n.tareaId));
  };

  const marcarTodas = async () => {
    setAviso(null);
    const { fallidas } = await marcar(sinLeer.map((n) => n.id));
    if (fallidas.length > 0) {
      setAviso(fallidas.length === 1 ? 'No se pudo marcar una notificación como leída.' : `No se pudieron marcar ${fallidas.length} notificaciones como leídas.`);
    }
  };

  return (
    <div ref={caja} className="notificaciones">
      <button
        ref={boton}
        type="button"
        className="herramientas__boton"
        aria-label={sinLeer.length > 0 ? 'Notificaciones, hay sin leer' : 'Notificaciones'}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={abierto ? ID_PANEL : undefined}
        onClick={() => {
          enfocarAlAbrir.current = true;
          if (!abierto) setAviso(null);
          setAbierto(!abierto);
        }}
      >
        <Bell size={22} aria-hidden="true" />
        {sinLeer.length > 0 && <i className="herramientas__punto" aria-hidden="true" />}
      </button>
      {abierto && createPortal(
        <Vidrio
          ref={panel}
          variante="denso"
          id={ID_PANEL}
          role="dialog"
          aria-label="Notificaciones"
          className="notificaciones__panel"
          style={lugar}
        >
          <div ref={desplazable} tabIndex={-1} className="notificaciones__desplazable">
            <header className="notificaciones__cabecera">
              <h2>Notificaciones</h2>
              {sinLeer.length > 0 && (
                <button type="button" className="notificaciones__todas" onClick={() => void marcarTodas()}>
                  <CheckCheck size={16} aria-hidden="true" />
                  Marcar todas como leídas
                </button>
              )}
            </header>
            {aviso !== null && <Aviso tipo="error" className="notificaciones__aviso">{aviso}</Aviso>}
            {lista.length === 0 ? (
              <p className="notificaciones__vacio">{notificaciones.isPending ? 'Cargando…' : 'No tenés notificaciones.'}</p>
            ) : (
              <ul className="notificaciones__lista">
                {lista.map((n) => {
                  const actor = n.actorId === null ? null : (personas.get(n.actorId) ?? null);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={unir('notificaciones__item', !n.leida && 'notificaciones__item--nueva')}
                        onClick={() => abrirNotificacion(n)}
                      >
                        <Avatar persona={actor} tamano={36} />
                        <span className="notificaciones__texto">
                          <span className="notificaciones__quien">
                            {actor && <b>{actor.nombre}</b>}
                            <span>{motivoEnCastellano(n.motivo)}</span>
                          </span>
                          <span className="notificaciones__titulo">{n.titulo}</span>
                          <small>{tiempoRelativo(n.creada)}</small>
                        </span>
                        {!n.leida && <i className="notificaciones__marca" role="img" aria-label="Sin leer" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Vidrio>,
        document.body,
      )}
    </div>
  );
}
