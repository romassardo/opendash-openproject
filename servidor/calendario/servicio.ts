import type { Database } from 'better-sqlite3';
import { hoyArgentina, semanaDe, sumarDias } from '../../compartido/fechas.js';
import type { FallaCalendario, VentanaFechas } from '../../compartido/tipos.js';
import type { Config } from '../config.js';
import { REGISTRO_MUDO, type Registro } from '../registro.js';
import { cifrar, descifrar } from '../seguridad/cifrado.js';
import { ErrorIcs, leerIcs, type AvisoIcs } from './ics.js';
import { enlacePermitido, leerCalendario, type ResultadoLectura } from './lectura.js';
import { borrarCache, guardarFalla, guardarLectura, leerCache } from './repositorio.js';

export type ResultadoCalendario = { ok: true } | { ok: false; falla: FallaCalendario };

export interface ServicioCalendario {
  actualizar(usuarioId: number): Promise<ResultadoCalendario>;
  /** Lee y valida antes de guardar nada. */
  guardarEnlace(usuarioId: number, url: string): Promise<ResultadoCalendario>;
  quitarEnlace(usuarioId: number): void;
  iniciar(): void;
  detener(): void;
}

export interface DepsCalendario {
  db: Database;
  config: Pick<Config, 'claveCifrado' | 'icsOrigenesPrueba'>;
  ahora: () => Date;
  leer?: (url: string) => Promise<ResultadoLectura>;
  registro?: Registro;
  intervaloMs?: number;
}

const INTERVALO_MS = 300_000;
const SEMANAS_ATRAS = 13;
const DIAS_ADELANTE = 365;
/** Un calendario vacío con reuniones guardadas es sospechoso solo mientras la última lectura buena sea más reciente que esto. */
export const HORAS_VACIO_SOSPECHOSO = 24;

/** Del lunes de 13 semanas atrás a hoy + 365 días. */
export function ventanaGuardada(hoy: string): VentanaFechas {
  return { desde: sumarDias(semanaDe(hoy).lunes, -7 * SEMANAS_ATRAS), hasta: sumarDias(hoy, DIAS_ADELANTE) };
}

export function crearServicioCalendario(deps: DepsCalendario): ServicioCalendario {
  const { db, config } = deps;
  const registro = deps.registro ?? REGISTRO_MUDO;
  const leer = deps.leer ?? ((url: string) => leerCalendario(url, { origenesPrueba: config.icsOrigenesPrueba }));
  const clave = config.claveCifrado;
  const aadEnlace = (usuarioId: number): string => `ics:${usuarioId}`;

  // Al registro solo van el usuario y la falla: nunca el enlace ni el mensaje de la red.
  // Solo en las fallas internas se suma el `name` del error (nunca su mensaje, que puede traer el enlace).
  const avisar = (usuarioId: number, falla: string, texto: string, error?: unknown): void => {
    const nombre = error instanceof Error ? error.name : undefined;
    registro.warn(nombre === undefined ? { usuarioId, falla } : { usuarioId, falla, error: nombre }, `[calendario] ${texto} (usuario ${usuarioId}, ${falla})`);
  };

  // Una sola línea por lectura, solo con el usuario y las cantidades: nunca títulos ni el enlace.
  const resumirAvisos = (usuarioId: number, avisos: Record<AvisoIcs, number>): void => {
    const salteados = avisos['evento-salteado'];
    const cortadas = avisos['serie-cortada'];
    if (salteados === 0 && cortadas === 0) return;
    const partes = [
      salteados > 0 ? `${salteados} ${salteados === 1 ? 'evento salteado' : 'eventos salteados'}` : null,
      cortadas > 0 ? `${cortadas} ${cortadas === 1 ? 'serie cortada' : 'series cortadas'}` : null,
    ].filter((p) => p !== null);
    registro.warn({ usuarioId, salteados, cortadas }, `[calendario] ${partes.join(', ')} (usuario ${usuarioId})`);
  };

  const enlaceGuardado = (usuarioId: number): string | null =>
    (db.prepare('select ics_cifrado from usuarios where id = ?').pluck().get(usuarioId) as string | null | undefined) ?? null;

  type Lectura = { ok: true; reuniones: ReturnType<typeof leerIcs> } | { ok: false; falla: FallaCalendario };

  async function traer(usuarioId: number, url: string, ventana: VentanaFechas): Promise<Lectura> {
    const lectura = await leer(url);
    if (!lectura.ok) return { ok: false, falla: lectura.falla };
    try {
      const avisos: Record<AvisoIcs, number> = { 'evento-salteado': 0, 'serie-cortada': 0 };
      const reuniones = leerIcs(lectura.texto, ventana, (aviso) => { avisos[aviso] += 1; });
      resumirAvisos(usuarioId, avisos);
      return { ok: true, reuniones };
    } catch (error) {
      if (error instanceof ErrorIcs) return { ok: false, falla: 'enlace-caido' };
      avisar(usuarioId, 'interno', 'lectura del calendario fallida', error);
      return { ok: false, falla: 'sin-conexion' };
    }
  }

  async function actualizar(usuarioId: number): Promise<ResultadoCalendario> {
    const cifrado = enlaceGuardado(usuarioId);
    if (cifrado === null) {
      borrarCache(db, usuarioId);
      return { ok: true };
    }
    let url: string;
    try {
      url = descifrar(cifrado, clave, aadEnlace(usuarioId));
    } catch {
      guardarFalla(db, usuarioId, 'enlace-caido', deps.ahora());
      avisar(usuarioId, 'enlace-caido', 'no se pudo descifrar el enlace');
      return { ok: false, falla: 'enlace-caido' };
    }
    const ventana = ventanaGuardada(hoyArgentina(deps.ahora()));
    const resultado = await traer(usuarioId, url, ventana);
    // Si mientras se leía cambiaron o quitaron el enlace, esta lectura ya no vale.
    if (enlaceGuardado(usuarioId) !== cifrado) return { ok: true };
    const ahora = deps.ahora();
    if (!resultado.ok) {
      guardarFalla(db, usuarioId, resultado.falla, ahora);
      avisar(usuarioId, resultado.falla, 'lectura fallida');
      return resultado;
    }
    const previa = leerCache(db, clave, usuarioId);
    // Una lectura buena siempre guarda la ventana: si hubo lectura y no está, lo guardado está corrupto.
    if (previa !== null && previa.estado.leido !== null && previa.ventana === null) {
      avisar(usuarioId, 'cache-corrupta', 'las reuniones guardadas no se pudieron leer, se reemplazan');
    }
    const horasDesdeLectura = previa?.estado.leido == null ? Infinity : (ahora.getTime() - Date.parse(previa.estado.leido)) / 3_600_000;
    if (resultado.reuniones.length === 0 && (previa?.reuniones.length ?? 0) > 0 && horasDesdeLectura < HORAS_VACIO_SOSPECHOSO) {
      guardarFalla(db, usuarioId, 'sin-conexion', ahora);
      avisar(usuarioId, 'sin-conexion', 'calendario vacío sospechoso: se conserva lo anterior');
      return { ok: false, falla: 'sin-conexion' };
    }
    guardarLectura(db, clave, usuarioId, resultado.reuniones, ventana, ahora);
    return { ok: true };
  }

  async function guardarEnlace(usuarioId: number, url: string): Promise<ResultadoCalendario> {
    if (!enlacePermitido(url, config.icsOrigenesPrueba)) return { ok: false, falla: 'enlace-caido' };
    const antes = enlaceGuardado(usuarioId);
    const ventana = ventanaGuardada(hoyArgentina(deps.ahora()));
    const resultado = await traer(usuarioId, url, ventana);
    if (!resultado.ok) return resultado;
    const ahora = deps.ahora();
    // Si mientras se leía quitaron o cambiaron el enlace, no se pisa esa decisión: se avisa que no se pudo conectar.
    let vigente = true;
    db.transaction(() => {
      if (enlaceGuardado(usuarioId) !== antes) {
        vigente = false;
        return;
      }
      db.prepare('update usuarios set ics_cifrado = ? where id = ?').run(cifrar(url, clave, aadEnlace(usuarioId)), usuarioId);
      guardarLectura(db, clave, usuarioId, resultado.reuniones, ventana, ahora);
    })();
    return vigente ? { ok: true } : { ok: false, falla: 'sin-conexion' };
  }

  function quitarEnlace(usuarioId: number): void {
    db.transaction(() => {
      db.prepare('update usuarios set ics_cifrado = null where id = ?').run(usuarioId);
      borrarCache(db, usuarioId);
    })();
  }

  let temporizador: NodeJS.Timeout | null = null;
  let enCurso = false;

  // De a uno y sin superponer rondas: si la anterior sigue, esta se saltea.
  async function ronda(): Promise<void> {
    if (enCurso) return;
    enCurso = true;
    try {
      const ids = db.prepare('select id from usuarios where ics_cifrado is not null').pluck().all() as number[];
      for (const id of ids) {
        try {
          await actualizar(id);
        } catch {
          avisar(id, 'interno', 'actualización fallida');
        }
      }
    } catch {
      // La ronda nunca rechaza: nadie la espera y un rechazo sin manejar tumba el proceso.
      registro.warn({ falla: 'interno' }, '[calendario] ronda fallida (interno)');
    } finally {
      enCurso = false;
    }
  }

  return {
    actualizar,
    guardarEnlace,
    quitarEnlace,
    iniciar() {
      if (temporizador !== null) return;
      void ronda();
      temporizador = setInterval(() => void ronda(), deps.intervaloMs ?? INTERVALO_MS);
      temporizador.unref();
    },
    detener() {
      if (temporizador !== null) clearInterval(temporizador);
      temporizador = null;
    },
  };
}
