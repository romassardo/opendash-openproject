import type { Database } from 'better-sqlite3';
import type { Tema, Yo } from '../../compartido/tipos.js';
import { leerReceptores } from '../ajustes/repositorio.js';
import { estadoCalendario } from '../calendario/repositorio.js';

interface FilaYo {
  id: number; login: string; nombre: string; tema: string; fijados: string;
  rol: string; capacidad_horas: number; varias_a_la_vez: number; aviso_reunion_min: number | null; tiene_calendario: number;
}

function fijadosDe(crudo: string): number[] {
  try {
    const lista: unknown = JSON.parse(crudo);
    return Array.isArray(lista) ? lista.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

/** El perfil de una persona tal como lo ve ella. Un tema inválido en la base vale 'oscuro'. */
export function leerYo(db: Database, usuarioId: number): Yo {
  const fila = db
    .prepare(
      `select id, login, nombre, tema, fijados, rol, capacidad_horas, varias_a_la_vez, aviso_reunion_min,
              ics_cifrado is not null as tiene_calendario
       from usuarios where id = ?`,
    )
    .get(usuarioId) as FilaYo;
  const cargaInicialLista = db.prepare('select 1 from estado_sync where clave = ?').pluck().get(`ultimo_completo:${fila.id}`) !== undefined;
  const tema: Tema = fila.tema === 'claro' ? 'claro' : 'oscuro';
  return {
    id: fila.id,
    login: fila.login,
    nombre: fila.nombre,
    tema,
    fijados: fijadosDe(fila.fijados),
    cargaInicialLista,
    rol: fila.rol,
    capacidadHoras: fila.capacidad_horas,
    variasALaVez: fila.varias_a_la_vez === 1,
    recibeAvisos: leerReceptores(db).includes(fila.id),
    avisoReunionMin: fila.aviso_reunion_min,
    tieneCalendario: fila.tiene_calendario === 1,
    calendario: estadoCalendario(db, fila.id),
  };
}
