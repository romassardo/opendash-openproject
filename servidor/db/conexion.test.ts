import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abrirDb } from './conexion.js';
import { migrar } from './migraciones.js';

describe('base de datos', () => {
  it('migrar es idempotente y crea las tablas', () => {
    const db = abrirDb(':memory:');
    migrar(db);
    const tablas = (db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tablas).toEqual(
      expect.arrayContaining(['usuarios', 'sesiones', 'cache_tareas', 'cierres', 'estado_sync']),
    );
    expect(db.pragma('user_version', { simple: true })).toBe(13);
    db.close();
  });

  it('migrar deja la base en la versión 6 con las tablas de la etapa 3', () => {
    const db = abrirDb(':memory:');
    migrar(db);
    const tablas = (db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map((t) => t.name);
    expect(tablas).toEqual(expect.arrayContaining(['calendario_cache', 'vacaciones', 'feriados_lista', 'feriados_ajustes']));
    expect(() => db.prepare("insert into feriados_ajustes (fecha, accion) values ('2026-01-01', 'otra')").run()).toThrow();
    db.close();
  });

  it('la migración del aviso de reunión se aplica sobre una base anterior y deja 5 por defecto', () => {
    const db = abrirDb(':memory:');
    db.exec('alter table usuarios drop column aviso_reunion_min');
    db.exec('drop table pausas_tarea'); // la base anterior todavía no tenía las pausas
    db.exec('alter table tramos_trabajo drop column medidos'); // ni lo medido de cada tramo
    db.exec('drop table horas_extra'); // ni las horas extra
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (1,'a','A','h','t','2026-01-01')").run();
    db.pragma('user_version = 9');
    migrar(db);
    expect(db.pragma('user_version', { simple: true })).toBe(13);
    expect(db.prepare('select aviso_reunion_min from usuarios where id = 1').pluck().get()).toBe(5);
    db.close();
  });

  it('la migración de lo medido toma lo contado de los tramos cerrados y deja los abiertos sin nada', () => {
    const db = abrirDb(':memory:');
    db.exec('alter table tramos_trabajo drop column medidos');
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (1,'a','A','h','t','2026-01-01')").run();
    const tramo = db.prepare("insert into tramos_trabajo (id, usuario_id, tarea_id, dia, inicio, fin, segundos, creado) values (?, 1, 5, '2026-10-26', 'x', ?, ?, 'x')");
    tramo.run(1, 'y', 1800);
    tramo.run(2, null, null);
    db.exec('drop table horas_extra');
    db.pragma('user_version = 11');
    migrar(db);
    expect(db.prepare('select id, medidos from tramos_trabajo order by id').all()).toEqual([{ id: 1, medidos: 1800 }, { id: 2, medidos: null }]);
    db.close();
  });

  it('la migración de horas extra crea la tabla sobre una base v12, una marca por persona y día', () => {
    const db = abrirDb(':memory:');
    db.exec('drop table horas_extra');
    db.pragma('user_version = 12');
    migrar(db);
    expect(db.pragma('user_version', { simple: true })).toBe(13);
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (1,'a','A','h','t','2026-01-01')").run();
    const marcar = db.prepare("insert into horas_extra (usuario_id, dia, confirmado) values (1, '2026-11-04', 'x')");
    marcar.run();
    expect(() => marcar.run()).toThrow();
    db.close();
  });

  it('la tabla de pausas no acepta pausas sin trabajo antes ni de cero días', () => {
    const db = abrirDb(':memory:');
    migrar(db);
    const poner = db.prepare("insert into pausas_tarea (tarea_id, despues, dias, creada) values (1, ?, ?, '2026-10-27')");
    expect(() => poner.run(3, 2)).not.toThrow();
    expect(() => poner.run(0, 2)).toThrow();
    expect(() => poner.run(3, 0)).toThrow();
    db.close();
  });

  it('activa claves foráneas y borra sesiones en cascada', () => {
    const db = abrirDb(':memory:');
    db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado) values (1,'a','A','h','t','2026-01-01')").run();
    db.prepare("insert into sesiones (id, usuario_id, vence) values ('s',1,'2027-01-01')").run();
    db.prepare('delete from usuarios where id = 1').run();
    expect(db.prepare('select count(*) as n from sesiones').get()).toEqual({ n: 0 });
    db.close();
  });

  it('crea la carpeta de un archivo y usa WAL', () => {
    const base = mkdtempSync(join(tmpdir(), 'opendash-'));
    try {
      const ruta = join(base, 'sub', 'datos', 'x.db');
      const db = abrirDb(ruta);
      expect(existsSync(ruta)).toBe(true);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      db.close();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
