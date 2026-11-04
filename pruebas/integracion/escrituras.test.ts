// Escrituras del cliente real contra el OpenProject de Docker (OpenProject 16).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarioDe, habilesEntre, sumarHabiles } from '../../compartido/calendarioOp.js';
import type { Catalogo, CatalogoOp } from '../../compartido/tipos.js';
import { fechasDetras } from '../../web/linea/cascada.js';
import { ErrorOp } from '../../servidor/openproject/errores.js';
import { admin, borrarProyecto, crearProyecto, crearVersion, hecho, idEstado, lineaDe, rails } from './ayudas.js';

let proyectoId = 0;
let catalogo: CatalogoOp;
let versionCursoId = 0;

beforeAll(async () => {
  proyectoId = await crearProyecto(`int-escritura-${Date.now()}`, 'Integración escritura');
  versionCursoId = (await crearVersion(proyectoId, 'En curso')).id;
  catalogo = await admin.catalogo();
});

afterAll(async () => {
  if (proyectoId !== 0) await borrarProyecto(proyectoId);
});

const tipoTask = (): number => catalogo.tipos.find((t) => t.nombre === 'Task')!.id;

describe('escrituras contra OpenProject 16', () => {
  it('crearTarea(): crea con tipo, madre y fecha límite', async () => {
    const madre = await admin.crearTarea({ titulo: 'Madre', proyectoId, tipoId: tipoTask() });
    const hija = await admin.crearTarea({ titulo: 'Hija', proyectoId, tipoId: tipoTask(), madreId: madre.id, fin: '2026-11-30' });
    expect(hija).toMatchObject({ titulo: 'Hija', madreId: madre.id, fin: '2026-11-30', proyectoId });
    expect(hija.estadoId).toBe(idEstado(catalogo, 'New'));
  });

  it('crearTarea(): una hija manual con inicio y fin (alta desde la línea); si la madre es automática, la cubre', async () => {
    const madre = await admin.crearTarea({ titulo: 'Madre de la línea', proyectoId, tipoId: tipoTask() });
    const hija = await admin.crearTarea({
      titulo: 'Hija de la línea', proyectoId, tipoId: tipoTask(), madreId: madre.id, inicio: '2026-11-02', fin: '2026-11-06', programacionManual: true,
    });
    expect(hija).toMatchObject({ madreId: madre.id, inicio: '2026-11-02', fin: '2026-11-06', programacionManual: true });
    expect(await admin.tarea(hija.id)).toMatchObject({ inicio: '2026-11-02', fin: '2026-11-06', programacionManual: true });
    const releida = await admin.tarea(madre.id);
    hecho('madre tras crear la hija (inicio, fin, manual)', [releida.inicio, releida.fin, releida.programacionManual]);
    if (!releida.programacionManual) expect(releida).toMatchObject({ inicio: '2026-11-02', fin: '2026-11-06' });
  });

  it('actualizarTarea(): lockVersion correcto sube la versión; uno viejo da conflicto', async () => {
    const t = await admin.crearTarea({ titulo: 'Con lock', proyectoId, tipoId: tipoTask() });
    const nueva = await admin.actualizarTarea(t.id, t.lockVersion, { titulo: 'Con lock 2' });
    hecho('lockVersion tras PATCH', [t.lockVersion, nueva.lockVersion]);
    expect(nueva.titulo).toBe('Con lock 2');
    expect(nueva.lockVersion).toBeGreaterThan(t.lockVersion);
    const error = await admin.actualizarTarea(t.id, t.lockVersion, { titulo: 'Pisada' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorOp);
    expect((error as ErrorOp).tipo).toBe('conflicto');
    expect((error as ErrorOp).estadoHttp).toBe(409);
    expect((await admin.tarea(t.id)).titulo).toBe('Con lock 2'); // el conflicto no pisó nada
  });

  it('actualizarTarea(): estimación, fechas, responsable y versión', async () => {
    const yo = await admin.yo();
    const t = await admin.crearTarea({ titulo: 'Campos', proyectoId, tipoId: tipoTask() });
    const r = await admin.actualizarTarea(t.id, t.lockVersion, {
      estimacionHoras: 1.5, inicio: '2026-11-02', fin: '2026-11-06', responsableId: yo.id, versionId: versionCursoId,
    });
    expect(r).toMatchObject({ estimacionHoras: 1.5, inicio: '2026-11-02', fin: '2026-11-06', responsableId: yo.id, versionId: versionCursoId });
    const limpia = await admin.actualizarTarea(t.id, r.lockVersion, { responsableId: null, versionId: null, estimacionHoras: null });
    expect(limpia).toMatchObject({ responsableId: null, versionId: null, estimacionHoras: null });
  });

  it('actualizarTarea(): un hito cambia su única fecha (date) y OpenProject la guarda', async () => {
    const hitoId = catalogo.tipos.find((t) => t.esHito)!.id;
    const hito = await admin.crearTarea({ titulo: 'Hito', proyectoId, tipoId: hitoId });
    const r = await admin.actualizarTarea(hito.id, hito.lockVersion, { fecha: '2026-12-15' });
    expect(r).toMatchObject({ inicio: '2026-12-15', fin: '2026-12-15' });
    const releida = await admin.tarea(hito.id);
    hecho('fecha del hito tras PATCH', [releida.inicio, releida.fin]);
    expect(releida).toMatchObject({ inicio: '2026-12-15', fin: '2026-12-15' });
  });

  it('el flujo por defecto deja al admin pasar por New, In progress, On hold y Closed (y volver)', async () => {
    let t = await admin.crearTarea({ titulo: 'Recorrido', proyectoId, tipoId: tipoTask() });
    const recorrido = ['In progress', 'On hold', 'Closed', 'New', 'In progress'] as const;
    const resultados: Record<string, string> = {};
    for (const nombre of recorrido) {
      try {
        t = await admin.actualizarTarea(t.id, t.lockVersion, { estadoId: idEstado(catalogo, nombre) });
        resultados[nombre] = 'ok';
        expect(t.estadoId).toBe(idEstado(catalogo, nombre));
      } catch (e) {
        resultados[nombre] = e instanceof ErrorOp ? `${e.tipo} ${e.estadoHttp}: ${e.message}` : String(e);
      }
    }
    hecho('transiciones del admin', resultados);
    expect(Object.values(resultados).every((v) => v === 'ok')).toBe(true);
  });

  it('dependencias: crearDependencia (follows) devuelve sucesora/predecesora y borrarDependencia la quita', async () => {
    const a = await admin.crearTarea({ titulo: 'Primera', proyectoId, tipoId: tipoTask() });
    const b = await admin.crearTarea({ titulo: 'Segunda', proyectoId, tipoId: tipoTask() });
    const dep = await admin.crearDependencia(b.id, a.id);
    expect(dep).toMatchObject({ sucesoraId: b.id, predecesoraId: a.id, lag: 0 });
    expect((await admin.dependencias()).some((d) => d.id === dep.id)).toBe(true);
    await admin.borrarDependencia(dep.id);
    expect((await admin.dependencias()).some((d) => d.id === dep.id)).toBe(false);
  });

  it('crearDependencia: dos veces la misma relación y una a sí misma se rechazan', async () => {
    const a = await admin.crearTarea({ titulo: 'Ciclo A', proyectoId, tipoId: tipoTask() });
    const b = await admin.crearTarea({ titulo: 'Ciclo B', proyectoId, tipoId: tipoTask() });
    await admin.crearDependencia(b.id, a.id);
    const repetida = await admin.crearDependencia(b.id, a.id).catch((e: unknown) => e);
    const alReves = await admin.crearDependencia(a.id, b.id).catch((e: unknown) => e);
    hecho('dependencia repetida', repetida instanceof ErrorOp ? `${repetida.tipo} ${repetida.estadoHttp}: ${repetida.message}` : 'aceptada');
    hecho('dependencia circular', alReves instanceof ErrorOp ? `${alReves.tipo} ${alReves.estadoHttp}: ${alReves.message}` : 'aceptada');
    expect(repetida).toBeInstanceOf(ErrorOp);
    expect(alReves).toBeInstanceOf(ErrorOp);
  });

  it('comentar(): el comentario aparece en actividades()', async () => {
    const t = await admin.crearTarea({ titulo: 'Comentada', proyectoId, tipoId: tipoTask() });
    await admin.comentar(t.id, 'Primer comentario **con markdown**');
    const comentarios = (await admin.actividades(t.id)).filter((a) => a.comentario !== '');
    expect(comentarios.map((a) => a.comentario)).toEqual(['Primer comentario **con markdown**']);
    expect(comentarios[0]!.autorId).not.toBeNull();
  });

  it('marcarLeida(): una notificación sin leer queda leída', async () => {
    const t = await admin.crearTarea({ titulo: 'Con aviso', proyectoId, tipoId: tipoTask() });
    // OpenProject no avisa a quien hace el cambio: la notificación se crea a mano para el admin.
    const id = Number(lineaDe(rails(`
      u = User.find_by!(login: 'admin')
      wp = WorkPackage.find(${t.id})
      n = Notification.create!(recipient: u, actor: u, resource: wp, journal: wp.journals.last, reason: :assigned, read_ian: false)
      puts "NOTIFICACION=#{n.id}"
    `), 'NOTIFICACION'));
    try {
      await admin.marcarLeida(id);
      expect((await admin.notificaciones()).find((n) => n.id === id)?.leida).toBe(true);
    } finally {
      rails(`Notification.where(id: ${id}).destroy_all\n`);
    }
  });

  it('read_ian acepta filters por id: una sola llamada marca varias y deja intactas las demás', async () => {
    const t = await admin.crearTarea({ titulo: 'Con avisos', proyectoId, tipoId: tipoTask() });
    const ids = lineaDe(rails(`
      u = User.find_by!(login: 'admin')
      wp = WorkPackage.find(${t.id})
      ns = 3.times.map { Notification.create!(recipient: u, actor: u, resource: wp, journal: wp.journals.last, reason: :assigned, read_ian: false) }
      puts "NOTIFICACIONES=#{ns.map(&:id).join(',')}"
    `), 'NOTIFICACIONES').split(',').map(Number);
    try {
      const fallidas = await admin.marcarLeidas([ids[0]!, ids[1]!]);
      hecho('marcarLeidas fallidas', fallidas);
      expect(fallidas).toEqual([]);
      const estado = new Map((await admin.notificaciones()).map((n) => [n.id, n.leida]));
      expect([estado.get(ids[0]!), estado.get(ids[1]!), estado.get(ids[2]!)]).toEqual([true, true, false]);
    } finally {
      rails(`Notification.where(id: [${ids.join(',')}]).destroy_all
`);
    }
  });

  it('errores: tarea inexistente es no-encontrado y token inválido es no-autorizado', async () => {
    const inexistente = await admin.tarea(99999999).catch((e: unknown) => e);
    expect((inexistente as ErrorOp).tipo).toBe('no-encontrado');
    const { crearClienteOp } = await import('../../servidor/openproject/cliente.js');
    const malo = crearClienteOp({ baseUrl: 'http://localhost:8090', token: 'token-que-no-existe' });
    const e = await malo.yo().catch((x: unknown) => x);
    expect((e as ErrorOp).tipo).toBe('no-autorizado');
  });
});

describe('correr detrás de la anterior contra OpenProject 16', () => {
  const catalogoWeb = async (): Promise<Catalogo> => ({ ...(await admin.catalogo()), tablero: { nuevo: null, curso: null, pausa: null, cerrado: null }, plantillas: [] });
  const fechasQueCorreria = async (id: number) => {
    const [{ tareas }, dependencias, cat] = await Promise.all([admin.tareas(), admin.dependencias(), catalogoWeb()]);
    return fechasDetras(id, tareas, dependencias, cat);
  };

  it('una sucesora manual pisada se corre detrás de su anterior con fechasDetras y sigue manual', async () => {
    const a = await admin.crearTarea({ titulo: 'Anterior manual', proyectoId, tipoId: tipoTask() });
    const b = await admin.crearTarea({ titulo: 'Sucesora manual', proyectoId, tipoId: tipoTask() });
    await admin.actualizarTarea(a.id, a.lockVersion, { inicio: '2026-11-02', fin: '2026-11-06', programacionManual: true });
    await admin.crearDependencia(b.id, a.id);
    const unida = await admin.tarea(b.id);
    hecho('tras unir (OpenProject la deja automática y la corre)', [unida.inicio, unida.fin, unida.programacionManual]);
    // Se la pisa a mano: manual y encima de la anterior.
    const pisada = await admin.actualizarTarea(b.id, unida.lockVersion, { inicio: '2026-11-04', fin: '2026-11-05', programacionManual: true });
    const nuevas = await fechasQueCorreria(b.id);
    hecho('fechasDetras de la pisada', nuevas);
    expect(nuevas).toEqual({ inicio: '2026-11-09', fin: '2026-11-10' });
    const movida = await admin.actualizarTarea(b.id, pisada.lockVersion, { ...nuevas!, programacionManual: true });
    expect(movida).toMatchObject({ inicio: '2026-11-09', fin: '2026-11-10', programacionManual: true });
    expect(await fechasQueCorreria(b.id)).toBeNull();
  });

  it('pausar una automática: mandar solo una duración hábil más larga corre el fin, deja el inicio y sigue automática', async () => {
    const a = await admin.crearTarea({ titulo: 'Anterior de la pausa', proyectoId, tipoId: tipoTask() });
    const b = await admin.crearTarea({ titulo: 'Automática pausada', proyectoId, tipoId: tipoTask() });
    await admin.actualizarTarea(a.id, a.lockVersion, { inicio: '2026-11-02', fin: '2026-11-06', programacionManual: true });
    await admin.crearDependencia(b.id, a.id);
    // Sin duración OpenProject 16 deja a la sucesora automática sin fin: se le da una antes de pausarla.
    const recienUnida = await admin.tarea(b.id);
    const unida = await admin.actualizarTarea(b.id, recienUnida.lockVersion, { duracionDias: 3 });
    hecho('automática antes de pausar (inicio, fin, manual)', [unida.inicio, unida.fin, unida.programacionManual]);
    expect(unida.programacionManual).toBe(false);
    expect(unida.fin).not.toBeNull();
    const cal = calendarioDe(catalogo);
    const duracion = habilesEntre(unida.inicio!, unida.fin!, cal);
    const pausada = await admin.actualizarTarea(b.id, unida.lockVersion, { duracionDias: duracion + 2 });
    hecho('automática pausada dos días (inicio, fin, manual)', [pausada.inicio, pausada.fin, pausada.programacionManual]);
    expect(pausada).toMatchObject({ inicio: unida.inicio, fin: sumarHabiles(unida.fin!, 2, cal), programacionManual: false });
  });

  it('una sucesora pisada vuelta a automática (sin mandar fechas) la reprograma OpenProject', async () => {
    const a = await admin.crearTarea({ titulo: 'Anterior reprogramar', proyectoId, tipoId: tipoTask() });
    const b = await admin.crearTarea({ titulo: 'Sucesora reprogramar', proyectoId, tipoId: tipoTask() });
    await admin.actualizarTarea(a.id, a.lockVersion, { inicio: '2026-11-02', fin: '2026-11-06', programacionManual: true });
    await admin.crearDependencia(b.id, a.id);
    const unida = await admin.tarea(b.id);
    // Se la pisa a mano (manual) y después se la devuelve a automática: OpenProject la corre solo.
    const pisada = await admin.actualizarTarea(b.id, unida.lockVersion, { inicio: '2026-11-04', fin: '2026-11-05', programacionManual: true });
    hecho('pisada manual', [pisada.inicio, pisada.fin, pisada.programacionManual]);
    const vuelta = await admin.actualizarTarea(b.id, pisada.lockVersion, { programacionManual: false });
    hecho('vuelta a automática sin fechas', [vuelta.inicio, vuelta.fin, vuelta.programacionManual]);
    const releida = await admin.tarea(b.id);
    hecho('releída', [releida.inicio, releida.fin, releida.programacionManual]);
    expect(releida.programacionManual).toBe(false);
    expect((releida.inicio ?? '') >= '2026-11-09').toBe(true);
  });

  it('una sucesora que YA era automática y quedó pisada: OpenProject la reprograma al pedírselo (solo programacionManual:false)', async () => {
    const a = await admin.crearTarea({ titulo: 'Anterior auto pisada', proyectoId, tipoId: tipoTask() });
    const b = await admin.crearTarea({ titulo: 'Sucesora auto pisada', proyectoId, tipoId: tipoTask() });
    await admin.actualizarTarea(a.id, a.lockVersion, { inicio: '2026-11-02', fin: '2026-11-06', programacionManual: true });
    await admin.crearDependencia(b.id, a.id);
    // Se la deja automática pero con fechas encima de la anterior (por la base, saltando la reprogramación).
    rails(`WorkPackage.find(${b.id}).update_columns(start_date: Date.new(2026, 11, 4), due_date: Date.new(2026, 11, 5), schedule_manually: false, updated_at: Time.now.utc + 60)
puts 'PISADA'
`);
    const pisada = await admin.tarea(b.id);
    hecho('automática pisada por la base', [pisada.inicio, pisada.fin, pisada.programacionManual]);
    expect(pisada.programacionManual).toBe(false);
    expect(await fechasQueCorreria(b.id)).not.toBeNull();
    const guardada = await admin.actualizarTarea(b.id, pisada.lockVersion, { programacionManual: false });
    const releida = await admin.tarea(b.id);
    hecho('tras PATCH {programacionManual:false} sobre una automática pisada', [guardada.inicio, guardada.fin, releida.inicio, releida.fin, releida.programacionManual]);
    expect(releida.programacionManual).toBe(false);
    expect((releida.inicio ?? '') >= '2026-11-09').toBe(true);
    expect(await fechasQueCorreria(b.id)).toBeNull();
  });

  it('una sucesora automática rechaza que se le manden fechas pisadas (422)', async () => {
    const a = await admin.crearTarea({ titulo: 'Anterior auto', proyectoId, tipoId: tipoTask() });
    const b = await admin.crearTarea({ titulo: 'Sucesora auto', proyectoId, tipoId: tipoTask() });
    await admin.actualizarTarea(a.id, a.lockVersion, { inicio: '2026-11-02', fin: '2026-11-06', programacionManual: true });
    await admin.crearDependencia(b.id, a.id);
    const unida = await admin.tarea(b.id);
    const error = await admin.actualizarTarea(b.id, unida.lockVersion, { inicio: '2026-11-04', fin: '2026-11-05', programacionManual: false }).catch((e: unknown) => e);
    hecho('automática con fechas pisadas', error instanceof ErrorOp ? `${error.tipo} ${error.estadoHttp}` : 'aceptada');
    expect(error).toBeInstanceOf(ErrorOp);
    expect((await admin.tarea(b.id)).inicio).toBe('2026-11-09');
  });
});
