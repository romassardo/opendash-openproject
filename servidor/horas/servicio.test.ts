import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { abrirDb } from '../db/conexion.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { crearCache } from '../sync/cache.js';
import { tramo } from './repositorio.js';
import { crearServicioHoras } from './servicio.js';

const en = (hhmm: string, dia = '2026-10-26'): Date => new Date(`${dia}T${hhmm}:00-03:00`);

describe('servicio de horas', () => {
  let db: Database;
  let reloj: Date;
  let crear: ReturnType<typeof vi.fn>;
  let cliente: ClienteOp;

  const abierto = (desde: string): number => {
    const id = Number(db.prepare("insert into tramos_trabajo (usuario_id, tarea_id, dia, inicio, estado, creado) values (9, 100, '2026-10-26', ?, 'abierto', ?)")
      .run(en(desde).toISOString(), en(desde).toISOString()).lastInsertRowid);
    db.prepare('insert into pedazos_trabajo (tramo_id, desde) values (?, ?)').run(id, en(desde).toISOString());
    return id;
  };
  const cerrarComoPendiente = (id: number): void => {
    db.prepare("update tramos_trabajo set fin = ?, segundos = 3600, estado = 'pendiente' where id = ?").run(reloj.toISOString(), id);
  };
  const servicio = () => crearServicioHoras({ db, ahora: () => reloj, clientePara: () => cliente });

  beforeEach(() => {
    reloj = en('16:30');
    db = abrirDb(':memory:');
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (9, 'r', 'R', 'h', 't', ?)").run(reloj.toISOString());
    crearCache(db).guardarTareas([tareaDe(100, { proyectoId: 1 })]);
    crear = vi.fn(async () => ({ id: 500 }));
    cliente = {
      crearEntradaTiempo: crear, editarEntradaTiempo: vi.fn(), borrarEntradaTiempo: vi.fn(),
      entradasDeTiempo: vi.fn(async () => []), tarea: vi.fn(async (id: number) => tareaDe(id, { proyectoId: 1 })),
    } as unknown as ClienteOp;
  });
  afterEach(() => db.close());

  it('la ronda frena lo vencido y lo carga', async () => {
    const id = abierto('09:00'); // 7,5 h a las 16:30: todavía no frena
    await servicio().ronda();
    expect(tramo(db, id)?.fin).toBeNull();
    reloj = en('18:00'); // pasó las 8 h: frena a las 17:00
    await servicio().ronda();
    expect(tramo(db, id)).toMatchObject({ frenadoSolo: 'tope', estado: 'cargado', segundos: 8 * 3600 });
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('reintenta con espera creciente', async () => {
    const id = abierto('15:00');
    cerrarComoPendiente(id);
    const s = servicio();
    crear.mockRejectedValue(new ErrorOp('red', 'sin red'));
    await s.ronda(); // intento 1 falla; el próximo en 1 min
    expect(crear).toHaveBeenCalledTimes(1);
    reloj = new Date(reloj.getTime() + 30_000);
    await s.ronda(); // todavía no toca
    expect(crear).toHaveBeenCalledTimes(1);
    reloj = new Date(reloj.getTime() + 31_000);
    await s.ronda(); // intento 2 falla; el próximo en 5 min
    expect(crear).toHaveBeenCalledTimes(2);
    reloj = new Date(reloj.getTime() + 4 * 60_000);
    await s.ronda();
    expect(crear).toHaveBeenCalledTimes(2);
    crear.mockResolvedValue({ id: 600 });
    reloj = new Date(reloj.getTime() + 61_000);
    await s.ronda();
    expect(tramo(db, id)).toMatchObject({ estado: 'cargado', entradaOpId: 600 });
  });

  it('cada tramo se carga con el cliente de su dueño', async () => {
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (8, 'c', 'C', 'h', 't', ?)").run(reloj.toISOString());
    const propio = abierto('15:00');
    cerrarComoPendiente(propio);
    const ajeno = Number(db.prepare("insert into tramos_trabajo (usuario_id, tarea_id, dia, inicio, fin, segundos, estado, creado) values (8, 100, '2026-10-26', ?, ?, 3600, 'pendiente', ?)")
      .run(en('14:00').toISOString(), en('15:00').toISOString(), en('14:00').toISOString()).lastInsertRowid);
    db.prepare('insert into pedazos_trabajo (tramo_id, desde, hasta) values (?, ?, ?)').run(ajeno, en('14:00').toISOString(), en('15:00').toISOString());
    const pedidos: number[] = [];
    await crearServicioHoras({ db, ahora: () => reloj, clientePara: (usuarioId) => { pedidos.push(usuarioId); return cliente; } }).ronda();
    expect(tramo(db, propio)?.estado).toBe('cargado');
    expect(tramo(db, ajeno)?.estado).toBe('cargado');
    expect(pedidos).toContain(9);
    expect(pedidos).toContain(8);
    expect(crear).toHaveBeenCalledTimes(2);
  });

  it('con token vencido no insiste y carga al renovarlo', async () => {
    const id = abierto('15:00');
    cerrarComoPendiente(id);
    db.prepare('update usuarios set token_vencido = 1 where id = 9').run();
    const s = servicio();
    await s.ronda();
    expect(crear).not.toHaveBeenCalled();
    db.prepare('update usuarios set token_vencido = 0 where id = 9').run();
    await s.ronda();
    expect(tramo(db, id)?.estado).toBe('cargado');
  });
});
