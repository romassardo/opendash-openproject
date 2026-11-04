import type { Database } from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirDb } from '../db/conexion.js';
import { cerrarTramoEn, crearTramo, rechazarPorTareaBorrada, tramo } from './repositorio.js';

describe('rechazarPorTareaBorrada', () => {
  let db: Database;
  const t0 = new Date('2026-10-19T12:00:00.000Z');
  const cerrado = (usuario: number, tarea: number, estado: string, entrada: number | null): number => {
    const t = crearTramo(db, usuario, tarea, '2026-10-19', t0);
    cerrarTramoEn(db, t.id, new Date(t0.getTime() + 600_000), 600, null);
    db.prepare('update tramos_trabajo set estado = ?, entrada_op_id = ? where id = ?').run(estado, entrada, t.id);
    return t.id;
  };
  beforeEach(() => {
    db = abrirDb(':memory:');
    for (const id of [1, 2]) {
      db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (?, ?, ?, 'h', 't', '2026-01-01')").run(id, `u${id}`, `U${id}`);
    }
  });

  it('pasa a rechazado los cerrados no descartados de esas tareas, de cualquier persona', () => {
    const a = cerrado(1, 10, 'cargado', 55);
    const b = cerrado(2, 11, 'pendiente', null);
    const c = cerrado(1, 10, 'descartado', null);
    const otra = cerrado(1, 99, 'cargado', 77);
    expect(rechazarPorTareaBorrada(db, [10, 11])).toBe(2);
    expect(tramo(db, a)).toMatchObject({ estado: 'rechazado', entradaOpId: null, motivo: 'La tarea ya no existe en OpenProject' });
    expect(tramo(db, b)).toMatchObject({ estado: 'rechazado', entradaOpId: null });
    expect(tramo(db, c)!.estado).toBe('descartado');
    expect(tramo(db, otra)).toMatchObject({ estado: 'cargado', entradaOpId: 77 });
  });

  it('sin tareas no toca nada', () => {
    expect(rechazarPorTareaBorrada(db, [])).toBe(0);
  });
});
