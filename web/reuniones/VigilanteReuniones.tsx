import { useEffect, useMemo, useRef, useState } from 'react';
import { cuentaComoReunion } from '../../compartido/calendario.js';
import type { Reunion, Yo } from '../../compartido/tipos.js';
import { useCalendario } from '../api/consultas.js';
import { enlaceSeguro, horaTexto } from '../calendario/logica.js';
import { hoyArgentina } from '../fechas.js';
import { AvisoReunion } from './AvisoReunion.js';
import { DialogoPermisoAvisos } from './DialogoPermisoAvisos.js';
import { avisosPendientes, etiquetaAviso, textoFaltan } from './logica.js';
import { avisosDelNavegador, usePermisoAvisos, type PermisoAvisos } from './usePermisoAvisos.js';

const RELOJ_MS = 30_000;
const SIN_REUNIONES: Reunion[] = [];
const NOMBRE_PLATAFORMA = { teams: 'Teams', meet: 'Meet', zoom: 'Zoom' } as const;

/** Monta el vigilante de reuniones con las de hoy; no hace nada si la persona eligió «No» o no tiene calendario. */
export function VigilanteReuniones({ yo }: { yo: Yo }) {
  const minutos = yo.avisoReunionMin;
  const [hoy, setHoy] = useState(() => hoyArgentina());
  useEffect(() => {
    const reloj = setInterval(() => setHoy(hoyArgentina()), RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);
  const activo = minutos !== null && yo.tieneCalendario;
  const calendario = useCalendario(hoy, hoy, activo, false, true);
  if (minutos === null || !activo) return null;
  return <AvisadorReuniones reuniones={calendario.data?.reuniones ?? SIN_REUNIONES} minutos={minutos} />;
}

export interface AvisadorReunionesProps {
  reuniones: Reunion[];
  minutos: number;
  /** Para las pruebas: el permiso se puede dar hecho. */
  permiso?: PermisoAvisos;
}

/** `true` si la Notification se creó de verdad. */
function mostrarNotificacion(reunion: Reunion, cuando: string): boolean {
  const hasta = horaTexto(reunion.fin);
  const plataforma = reunion.plataforma === null ? null : NOMBRE_PLATAFORMA[reunion.plataforma];
  const enlace = enlaceSeguro(reunion.enlace);
  const detalle = [`${horaTexto(reunion.inicio)} – ${hasta}`, plataforma].filter((parte) => parte !== null).join(' · ');
  try {
    const aviso = new Notification(`${cuando}: ${reunion.titulo}`, { body: detalle, tag: etiquetaAviso(reunion) });
    aviso.onclick = () => {
      window.focus();
      if (enlace !== null) window.open(enlace, '_blank', 'noopener');
      aviso.close();
    };
    return true;
  } catch {
    // Algunos navegadores no dejan crearlo así (por ejemplo, en el celular): queda el aviso dentro de OpenDash.
    return false;
  }
}

/**
 * Programa un temporizador por cada reunión de hoy que todavía no empezó y, a la hora de avisar, muestra la pieza de
 * OpenDash, cambia el título de la pestaña y (con permiso) pide el aviso del navegador.
 */
export function AvisadorReuniones({ reuniones, minutos, permiso: permisoDado }: AvisadorReunionesProps) {
  const propio = usePermisoAvisos();
  const permiso = permisoDado ?? propio;
  const permisoRef = useRef(permiso);
  permisoRef.current = permiso;

  const [ahora, setAhora] = useState(() => new Date());
  const [disparados, setDisparados] = useState<ReadonlySet<string>>(new Set());
  const [descartados, setDescartados] = useState<ReadonlySet<string>>(new Set());
  const [ocultoPregunta, setOcultoPregunta] = useState(false);
  const notificados = useRef(new Set<string>());
  const reunionesRef = useRef(reuniones);
  reunionesRef.current = reuniones;

  /** Crea la Notification si hay permiso; la reunión se da por notificada solo cuando se creó de verdad. */
  const notificar = useRef((reunion: Reunion, momento: Date): void => {
    const clave = etiquetaAviso(reunion);
    if (notificados.current.has(clave)) return;
    const cuando = textoFaltan(new Date(reunion.inicio), momento);
    if (cuando === null || !avisosDelNavegador() || permisoRef.current.estado !== 'granted') return;
    if (mostrarNotificacion(reunion, cuando)) notificados.current.add(clave);
  }).current;

  useEffect(() => {
    const reloj = setInterval(() => setAhora(new Date()), RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);

  // Se reprograma cada vez que llega un calendario distinto o cambia la opción: lo viejo se limpia.
  useEffect(() => {
    const momento = new Date();
    setAhora(momento);
    const temporizadores = avisosPendientes(reuniones, momento, minutos).map(({ reunion, avisarEn }) =>
      setTimeout(() => {
        const llegada = new Date();
        const clave = etiquetaAviso(reunion);
        setAhora(llegada);
        setDisparados((previos) => (previos.has(clave) ? previos : new Set(previos).add(clave)));
        notificar(reunion, llegada);
      }, Math.max(0, avisarEn.getTime() - momento.getTime())));
    return () => temporizadores.forEach(clearTimeout);
  }, [reuniones, minutos, notificar]);

  // Si la persona da el permiso después de que sonó el aviso, lo que sigue vigente sale ahora.
  const concedido = permiso.estado === 'granted';
  useEffect(() => {
    if (!concedido) return;
    const momento = new Date();
    reunionesRef.current
      .filter((r) => cuentaComoReunion(r) && disparados.has(etiquetaAviso(r)))
      .forEach((r) => notificar(r, momento));
  }, [concedido, disparados, notificar]);

  // Lo que se ve sale de las reuniones actuales: una borrada o movida en Outlook deja de verse.
  const visible = useMemo(() => {
    const candidatas = reuniones
      .filter((r) => cuentaComoReunion(r) && disparados.has(etiquetaAviso(r)) && !descartados.has(etiquetaAviso(r)))
      .map((reunion) => ({ reunion, empieza: new Date(reunion.inicio) }))
      .map((c) => ({ ...c, cuando: textoFaltan(c.empieza, ahora) }))
      .filter((c): c is typeof c & { cuando: string } => c.cuando !== null)
      .sort((a, b) => a.empieza.getTime() - b.empieza.getTime());
    return candidatas[0] ?? null;
  }, [reuniones, disparados, descartados, ahora]);

  const tituloPestana = visible === null ? null
    : visible.cuando === 'Empezó' ? `🔔 ${visible.reunion.titulo} empezó`
      : `🔔 ${visible.reunion.titulo} ${visible.cuando.toLowerCase()}`;
  useEffect(() => {
    if (tituloPestana === null) return;
    const anterior = document.title;
    document.title = tituloPestana;
    return () => {
      // Si otra pantalla cambió el título mientras tanto, no se lo pisa.
      if (document.title === tituloPestana) document.title = anterior;
    };
  }, [tituloPestana]);

  const hayAvisoPendiente = visible !== null || avisosPendientes(reuniones, ahora, minutos).length > 0;
  return (
    <>
      {visible !== null && (
        <AvisoReunion
          cuando={visible.cuando}
          titulo={visible.reunion.titulo}
          enlace={enlaceSeguro(visible.reunion.enlace)}
          alCerrar={() => setDescartados((previos) => new Set(previos).add(etiquetaAviso(visible.reunion)))}
        />
      )}
      {hayAvisoPendiente && permiso.preguntar && !ocultoPregunta && (
        <DialogoPermisoAvisos alPermitir={() => void permiso.pedir()} alRechazar={permiso.ahoraNo} alCerrar={() => setOcultoPregunta(true)} />
      )}
    </>
  );
}
