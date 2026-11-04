import type { Database } from 'better-sqlite3';
import { hoyArgentina, sumarDias } from '../../compartido/fechas.js';
import { leerHoras } from '../ajustes/repositorio.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { REGISTRO_MUDO, type Registro } from '../registro.js';
import { fechasFeriado } from '../feriados/repositorio.js';
import { cargarTramo } from './carga.js';
import { aplicarFrenos } from './reglas.js';
import { pendientesDeCarga } from './repositorio.js';

export interface ServicioHoras {
  iniciar(): void;
  detener(): void;
  ronda(): Promise<void>;
}

export interface DepsServicioHoras {
  db: Database;
  ahora: () => Date;
  clientePara: (usuarioId: number) => ClienteOp | null;
  registro?: Registro;
  /** Cada cuánto corre la ronda; 60 s por defecto. */
  rondaMs?: number;
}

const RONDA_MS = 60_000;
const MINUTO_MS = 60_000;
/** Espera tras cada intento fallido: 1, 5 y 15 minutos, y luego cada 15. */
const ESPERAS_MS = [1, 5, 15].map((m) => m * MINUTO_MS);

export function crearServicioHoras(deps: DepsServicioHoras): ServicioHoras {
  const registro = deps.registro ?? REGISTRO_MUDO;
  const reintentos = new Map<number, { intentos: number; proximo: number }>();
  let enRonda = false;

  const tokenVencido = (usuarioId: number): boolean =>
    deps.db.prepare('select token_vencido from usuarios where id = ?').pluck().get(usuarioId) === 1;

  async function ronda(): Promise<void> {
    if (enRonda) return;
    enRonda = true;
    try {
      const ahora = deps.ahora();
      const hoy = hoyArgentina(ahora);
      const jornadaMs = leerHoras(deps.db).jornadaHoras * 3_600_000;
      aplicarFrenos(deps.db, ahora, fechasFeriado(deps.db, sumarDias(hoy, -60), sumarDias(hoy, 1)), jornadaMs);
      const pendientes = pendientesDeCarga(deps.db);
      const vigentes = new Set(pendientes.map((t) => t.id));
      for (const id of reintentos.keys()) if (!vigentes.has(id)) reintentos.delete(id);
      for (const t of pendientes) {
        // Sin token vigente no hay nada que probar: se carga en la primera ronda tras renovarlo.
        if (tokenVencido(t.usuarioId)) {
          reintentos.delete(t.id);
          continue;
        }
        const previo = reintentos.get(t.id);
        if (previo !== undefined && ahora.getTime() < previo.proximo) continue;
        const despues = await cargarTramo({ db: deps.db, ahora: deps.ahora, clientePara: deps.clientePara, registro }, t.id);
        if (despues.estado !== 'pendiente' || tokenVencido(t.usuarioId)) {
          reintentos.delete(t.id);
          continue;
        }
        const intentos = (previo?.intentos ?? 0) + 1;
        reintentos.set(t.id, { intentos, proximo: ahora.getTime() + (ESPERAS_MS[Math.min(intentos - 1, ESPERAS_MS.length - 1)] as number) });
      }
    } finally {
      enRonda = false;
    }
  }

  let temporizador: NodeJS.Timeout | null = null;
  // Nadie espera esta promesa: un rechazo sin manejar tumbaría el proceso.
  const correr = (): void => {
    ronda().catch(() => registro.warn('[horas] ronda fallida (interno)'));
  };

  return {
    ronda,
    iniciar() {
      if (temporizador !== null) return;
      correr();
      temporizador = setInterval(correr, deps.rondaMs ?? RONDA_MS);
      temporizador.unref();
    },
    detener() {
      if (temporizador !== null) clearInterval(temporizador);
      temporizador = null;
    },
  };
}
