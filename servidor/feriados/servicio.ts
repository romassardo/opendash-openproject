import type { Database } from 'better-sqlite3';
import { hoyArgentina } from '../../compartido/fechas.js';
import type { Config } from '../config.js';
import { REGISTRO_MUDO, type Registro } from '../registro.js';
import { leerFeriadosDelAnio, type FeriadoLista } from './fuente.js';
import { reemplazarAnio } from './repositorio.js';

export interface ServicioFeriados {
  actualizarSiHaceFalta(): Promise<void>;
  iniciar(): void;
  detener(): void;
}

export interface DepsFeriados {
  db: Database;
  config: Pick<Config, 'feriadosUrl'>;
  ahora: () => Date;
  leer?: (anio: number) => Promise<FeriadoLista[]>;
  registro?: Registro;
  chequeoMs?: number;
}

const CLAVE = 'feriados_actualizados';
const SEMANA_MS = 7 * 24 * 3_600_000;
const CHEQUEO_MS = 6 * 3_600_000;

export function crearServicioFeriados(deps: DepsFeriados): ServicioFeriados {
  const { db } = deps;
  const registro = deps.registro ?? REGISTRO_MUDO;
  const leer = deps.leer ?? ((anio: number) => leerFeriadosDelAnio(deps.config.feriadosUrl, anio));

  function hayQueActualizar(): boolean {
    const ultima = db.prepare('select valor from estado_sync where clave = ?').pluck().get(CLAVE) as string | undefined;
    const cuando = ultima === undefined ? Number.NaN : Date.parse(ultima);
    return Number.isNaN(cuando) || deps.ahora().getTime() - cuando > SEMANA_MS;
  }

  // Cada año va por su cuenta: una lista vacía o una falla dejan la anterior de ese año.
  async function bajarAnio(anio: number): Promise<boolean> {
    try {
      const lista = await leer(anio);
      if (lista.length === 0) {
        registro.warn(`[feriados] ${anio}: la fuente devolvió una lista vacía, se conserva la anterior`);
        return false;
      }
      reemplazarAnio(db, anio, lista);
      return true;
    } catch (error) {
      registro.warn(`[feriados] ${anio}: no se pudo actualizar (${error instanceof Error ? error.name : 'error'})`);
      return false;
    }
  }

  async function actualizarSiHaceFalta(): Promise<void> {
    if (!hayQueActualizar()) return;
    const anio = Number(hoyArgentina(deps.ahora()).slice(0, 4));
    const enCurso = await bajarAnio(anio);
    await bajarAnio(anio + 1);
    if (enCurso) {
      db.prepare('insert or replace into estado_sync (clave, valor) values (?, ?)').run(CLAVE, deps.ahora().toISOString());
    }
  }

  let temporizador: NodeJS.Timeout | null = null;
  // Nadie espera esta promesa: un rechazo sin manejar tumbaría el proceso.
  const correr = (): void => {
    actualizarSiHaceFalta().catch(() => registro.warn('[feriados] chequeo fallido (interno)'));
  };

  return {
    actualizarSiHaceFalta,
    iniciar() {
      if (temporizador !== null) return;
      correr();
      temporizador = setInterval(correr, deps.chequeoMs ?? CHEQUEO_MS);
      temporizador.unref();
    },
    detener() {
      if (temporizador !== null) clearInterval(temporizador);
      temporizador = null;
    },
  };
}
