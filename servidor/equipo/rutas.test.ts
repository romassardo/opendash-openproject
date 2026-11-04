import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MiembroEquipo, Reunion } from '../../compartido/tipos.js';
import { syncFalso, tareaDe } from '../../pruebas/fabricas/sync.js';
import { guardarMetricas, leerAjustes } from '../ajustes/repositorio.js';
import { crearApp } from '../app.js';
import { crearSesion } from '../auth/sesiones.js';
import { guardarLectura } from '../calendario/repositorio.js';
import { cargarConfig } from '../config.js';
import { abrirDb } from '../db/conexion.js';
import { crearCache } from '../sync/cache.js';

const config = cargarConfig({ OPENPROJECT_URL: 'http://op.test', OPENDASH_CLAVE_CIFRADO: Buffer.alloc(32, 1).toString('base64') });
const MIN = 60_000;
const hora = (h: number, m = 0): Date => new Date(Date.UTC(2026, 9, 19, h, m));

describe('GET /api/equipo', () => {
  let db: Database;
  let app: FastifyInstance;
  let sesion: string;
  let ahora: Date;

  const equipo = async (): Promise<MiembroEquipo[]> => {
    const r = await app.inject({ method: 'GET', url: '/api/equipo', cookies: { od_sesion: sesion } });
    expect(r.statusCode).toBe(200);
    return r.json().datos as MiembroEquipo[];
  };
  const de = (lista: MiembroEquipo[], id: number): MiembroEquipo => lista.find((m) => m.personaId === id)!;
  const tramo = (usuario: number, tarea: number, extra: { pausado?: boolean } = {}): void => {
    const id = Number(db.prepare("insert into tramos_trabajo (usuario_id, tarea_id, dia, inicio, creado) values (?,?,?,?,?)")
      .run(usuario, tarea, '2026-10-19', hora(11).toISOString(), hora(11).toISOString()).lastInsertRowid);
    db.prepare('insert into pedazos_trabajo (tramo_id, desde, hasta) values (?,?,?)')
      .run(id, hora(11).toISOString(), extra.pausado ? hora(11, 30).toISOString() : null);
  };
  const actividad = (usuario: number, cuando: Date | null): void => {
    db.prepare('update usuarios set ultima_actividad = ? where id = ?').run(cuando?.toISOString() ?? null, usuario);
  };

  beforeEach(async () => {
    ahora = hora(12);
    db = abrirDb(':memory:');
    app = await crearApp({ config, db, crearCliente: () => ({}) as never, ahora: () => ahora, sync: syncFalso() });
    const insertar = db.prepare("insert into usuarios (id, login, nombre, hash, token_cifrado, creado, rol, capacidad_horas) values (?,?,?,'h','t',?,?,?)");
    insertar.run(9, 'rmedina', 'Ramiro', hora(0).toISOString(), 'Líder', 36);
    insertar.run(8, 'colega', 'Colega', hora(0).toISOString(), 'Dev', 30);
    insertar.run(7, 'ajeno', 'Ajeno', hora(0).toISOString(), '', 40);
    db.prepare('insert into usuario_proyectos (usuario_id, proyecto_id) values (9, 1), (8, 1), (7, 3)').run();
    crearCache(db).guardarTareas([
      tareaDe(100, { proyectoId: 1, responsableId: 8 }),
      tareaDe(300, { proyectoId: 3, responsableId: 7 }),
    ]);
    sesion = crearSesion(db, 9, ahora);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/equipo' })).statusCode).toBe(401);
  });

  it('el equipo no incluye personas que el usuario no ve', async () => {
    const lista = await equipo();
    expect(lista.map((m) => m.personaId).sort()).toEqual([8, 9]);
  });

  it('trae el rol y la capacidad de cada persona', async () => {
    const lista = await equipo();
    expect(de(lista, 8)).toMatchObject({ rol: 'Dev', capacidadHoras: 30, trabajandoEn: [] });
  });

  it('conectado con actividad reciente y ausente sin ella', async () => {
    actividad(8, new Date(ahora.getTime() - 1 * MIN));
    expect(de(await equipo(), 8).presencia).toBe('conectado');
    actividad(8, new Date(ahora.getTime() - 3 * MIN));
    expect(de(await equipo(), 8).presencia).toBe('ausente');
    actividad(8, null);
    expect(de(await equipo(), 8).presencia).toBe('ausente');
  });

  it('quien consulta figura conectado: su propia petición cuenta como actividad', async () => {
    expect(de(await equipo(), 9).presencia).toBe('conectado');
  });

  it('trabajando con un tramo en marcha, y muestra la tarea', async () => {
    tramo(8, 100);
    const m = de(await equipo(), 8);
    expect(m.presencia).toBe('trabajando');
    expect(m.trabajandoEn).toEqual([100]);
  });

  it('un tramo pausado cuenta como conectado, no trabajando', async () => {
    tramo(8, 100, { pausado: true });
    actividad(8, new Date(ahora.getTime() - 1 * MIN));
    const m = de(await equipo(), 8);
    expect(m.presencia).toBe('conectado');
    expect(m.trabajandoEn).toEqual([]);
  });

  describe('calendario, vacaciones y horas de reunión', () => {
    // ahora = lunes 2026-10-19 12:00 UTC = 09:00 en Argentina
    const clave = config.claveCifrado;
    const reunion = (inicio: string, fin: string, titulo = 'Daily'): Reunion => ({
      id: `${inicio}`, titulo, lugar: 'Sala Secreta', inicio, fin, diaEntero: false, libre: false,
      enlace: 'https://teams.microsoft.com/l/meetup-join/secreto', plataforma: 'teams',
    });
    const guardar = (usuario: number, reuniones: Reunion[]): void =>
      guardarLectura(db, clave, usuario, reuniones, { desde: '2026-07-20', hasta: '2027-04-20' }, ahora);
    const restar = (v: boolean): void => guardarMetricas(db, { ...leerAjustes(db, []).metricas, restarReuniones: v });

    it('En reunión con una reunión en curso, sin revelar título ni horario', async () => {
      guardar(8, [reunion('2026-10-19T08:30:00-03:00', '2026-10-19T09:30:00-03:00')]);
      const r = await app.inject({ method: 'GET', url: '/api/equipo', cookies: { od_sesion: sesion } });
      const lista = r.json().datos as MiembroEquipo[];
      expect(de(lista, 8).presencia).toBe('reunion');
      for (const secreto of ['Daily', 'Sala Secreta', 'teams.microsoft.com', '08:30', '11:30', 'meetup']) expect(r.body).not.toContain(secreto);
    });

    it('trae las vacaciones que no terminaron y marca de vacaciones a quien está hoy', async () => {
      const v = db.prepare('insert into vacaciones (usuario_id, desde, hasta) values (?,?,?)');
      v.run(8, '2026-10-01', '2026-10-10');   // ya terminó
      v.run(8, '2026-10-19', '2026-10-23');
      v.run(8, '2026-12-01', '2026-12-05');
      const m = de(await equipo(), 8);
      expect(m.presencia).toBe('vacaciones');
      expect(m.vacaciones).toEqual([{ desde: '2026-10-19', hasta: '2026-10-23' }, { desde: '2026-12-01', hasta: '2026-12-05' }]);
    });

    it('con la opción apagada reunionesPorSemana es null', async () => {
      guardar(8, [reunion('2026-10-20T10:00:00-03:00', '2026-10-20T12:00:00-03:00')]);
      expect(de(await equipo(), 8).reunionesPorSemana).toBeNull();
    });

    it('con la opción prendida trae las horas por semana o sin-calendario', async () => {
      restar(true);
      guardar(8, [reunion('2026-10-20T10:00:00-03:00', '2026-10-20T12:00:00-03:00'), reunion('2026-11-03T10:00:00-03:00', '2026-11-03T11:30:00-03:00')]);
      const lista = await equipo();
      expect(de(lista, 8).reunionesPorSemana).toEqual({ '2026-10-19': 2, '2026-10-26': 0, '2026-11-02': 1.5, '2026-11-09': 0 });
      expect(de(lista, 9).reunionesPorSemana).toBe('sin-calendario');
    });

    it('un feriado y las vacaciones no restan reuniones', async () => {
      restar(true);
      db.prepare('insert into feriados_ajustes (fecha, accion, nombre) values (?,?,?)').run('2026-10-20', 'agregar', 'Feriado de prueba');
      db.prepare('insert into vacaciones (usuario_id, desde, hasta) values (8, ?, ?)').run('2026-10-21', '2026-10-21');
      guardar(8, [
        reunion('2026-10-20T10:00:00-03:00', '2026-10-20T12:00:00-03:00'),
        reunion('2026-10-21T10:00:00-03:00', '2026-10-21T12:00:00-03:00'),
        reunion('2026-10-22T10:00:00-03:00', '2026-10-22T11:00:00-03:00'),
      ]);
      expect(de(await equipo(), 8).reunionesPorSemana).toMatchObject({ '2026-10-19': 1 });
    });
  });

  it('trabajandoEn solo trae tareas visibles para quien mira', async () => {
    tramo(8, 300);
    tramo(8, 100);
    const m = de(await equipo(), 8);
    expect(m.presencia).toBe('trabajando');
    expect(m.trabajandoEn).toEqual([100]);
  });

  it('quien trabaja solo en tareas que el que mira no ve figura trabajando, sin tareas', async () => {
    tramo(8, 300);
    const m = de(await equipo(), 8);
    expect(m.presencia).toBe('trabajando');
    expect(m.trabajandoEn).toEqual([]);
  });
});
