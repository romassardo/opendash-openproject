// Entradas de tiempo del cliente real contra el OpenProject de Docker (OpenProject 16).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorOp } from '../../servidor/openproject/errores.js';
import { admin, borrarProyecto, crearProyecto, cruda, hecho } from './ayudas.js';

let proyectoId = 0;
let tareaId = 0;
const DIA = '2026-10-26';

beforeAll(async () => {
  proyectoId = await crearProyecto(`int-horas-${Date.now()}`, 'Integración horas');
  const catalogo = await admin.catalogo();
  tareaId = (await admin.crearTarea({ titulo: 'Con horas', proyectoId, tipoId: catalogo.tipos.find((t) => t.nombre === 'Task')!.id })).id;
});

afterAll(async () => {
  if (proyectoId !== 0) await borrarProyecto(proyectoId);
});

describe('horas contra OpenProject 16', () => {
  it('crea, lista, edita y borra una entrada; spentTime sigue la edición', async () => {
    const { id } = await admin.crearEntradaTiempo({ tareaId, dia: DIA, horasIso: 'PT1H30M', comentario: 'OpenDash · tramo 1' });
    expect(await admin.entradasDeTiempo({ tareaId, dia: DIA })).toEqual([{ id, comentario: 'OpenDash · tramo 1' }]);
    expect(await admin.entradasDeTiempo({ tareaId, dia: '2026-10-27' })).toEqual([]);
    expect((await admin.tarea(tareaId)).horasReales).toBe(1.5);

    await admin.editarEntradaTiempo(id, 'PT2H');
    expect((await admin.tarea(tareaId)).horasReales).toBe(2);
    hecho('spentTime tras editar', (await admin.tarea(tareaId)).horasReales);

    await admin.borrarEntradaTiempo(id);
    expect(await admin.entradasDeTiempo({ tareaId, dia: DIA })).toEqual([]);
    const error = await admin.borrarEntradaTiempo(id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorOp);
    expect((error as ErrorOp).tipo).toBe('no-encontrado');
  });

  it('un proyecto sin el módulo «costs» responde 403 (prohibido)', async () => {
    const sinModulo = await crearProyecto(`int-horas-sin-${Date.now()}`, 'Integración horas sin costs');
    try {
      const { rails } = await import('./ayudas.js');
      rails(`p = Project.find(${sinModulo})\np.enabled_module_names -= ['costs']\np.save!\n`);
      const t = await admin.crearTarea({ titulo: 'Sin módulo', proyectoId: sinModulo });
      const error = await admin.crearEntradaTiempo({ tareaId: t.id, dia: DIA, horasIso: 'PT1H', comentario: 'x' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorOp);
      hecho('sin costs', [(error as ErrorOp).tipo, (error as ErrorOp).estadoHttp]);
      expect((error as ErrorOp).tipo).toBe('prohibido');
    } finally {
      await borrarProyecto(sinModulo);
    }
  });

  it('cruda: el usuario de la entrada es el del token', async () => {
    const { id } = await admin.crearEntradaTiempo({ tareaId, dia: DIA, horasIso: 'PT30M', comentario: 'OpenDash · tramo 2' });
    const { json } = await cruda('GET', `/api/v3/time_entries/${id}`);
    expect((json as { _links: { user: { href: string } } })._links.user.href).toBe(`/api/v3/users/${(await admin.yo()).id}`);
    await admin.borrarEntradaTiempo(id);
  });
});
