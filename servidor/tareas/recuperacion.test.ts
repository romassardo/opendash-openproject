import { describe, expect, it, vi } from 'vitest';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import type { ClienteOp } from '../openproject/cliente.js';
import { ErrorOp } from '../openproject/errores.js';
import { buscarComentario, buscarDependencia, buscarTareaCreada } from './recuperacion.js';

const DESDE = '2026-10-19T11:58:00.000Z';
const datos = { titulo: 'Nueva', proyectoId: 11 };

function clienteCon(parcial: Partial<Record<keyof ClienteOp, unknown>>): ClienteOp {
  return parcial as unknown as ClienteOp;
}

describe('buscarTareaCreada', () => {
  it('pide las tareas actualizadas desde el momento indicado', async () => {
    const tareas = vi.fn().mockResolvedValue({ tareas: [], salteadas: [] });
    await buscarTareaCreada(clienteCon({ tareas }), datos, 9, DESDE);
    expect(tareas).toHaveBeenCalledWith({ actualizadasDesde: DESDE });
  });

  it('encuentra la del mismo proyecto, título (sin espacios sobrantes) y autor', async () => {
    const tareas = vi.fn().mockResolvedValue({
      tareas: [
        tareaDe(1, { titulo: 'Nueva', proyectoId: 12, autorId: 9 }),
        tareaDe(2, { titulo: 'Otra', proyectoId: 11, autorId: 9 }),
        tareaDe(3, { titulo: 'Nueva', proyectoId: 11, autorId: 4 }),
        tareaDe(77, { titulo: 'Nueva', proyectoId: 11, autorId: 9, creada: '2026-10-19T12:00:00Z' }),
      ],
      salteadas: [],
    });
    const t = await buscarTareaCreada(clienteCon({ tareas }), { ...datos, titulo: '  Nueva ' }, 9, DESDE);
    expect(t?.id).toBe(77);
  });

  it('si hay varias, devuelve la creada más nueva', async () => {
    const tareas = vi.fn().mockResolvedValue({
      tareas: [
        tareaDe(10, { titulo: 'Nueva', proyectoId: 11, autorId: 9, creada: '2026-10-19T11:59:30Z' }),
        tareaDe(11, { titulo: 'Nueva', proyectoId: 11, autorId: 9, creada: '2026-10-19T12:00:30Z' }),
        tareaDe(12, { titulo: 'Nueva', proyectoId: 11, autorId: 9, creada: '2026-10-19T12:00:00Z' }),
      ],
      salteadas: [],
    });
    expect((await buscarTareaCreada(clienteCon({ tareas }), datos, 9, DESDE))?.id).toBe(11);
  });

  it('una tarea vieja con el mismo título bajo otra madre no se toma como la recién creada', async () => {
    const tareas = vi.fn().mockResolvedValue({
      tareas: [
        tareaDe(1, { titulo: 'Nueva', proyectoId: 11, autorId: 9, madreId: 5, creada: '2026-10-19T12:00:00Z' }),
        tareaDe(2, { titulo: 'Nueva', proyectoId: 11, autorId: 9, madreId: null, creada: '2026-10-01T10:00:00Z' }),
      ],
      salteadas: [],
    });
    expect(await buscarTareaCreada(clienteCon({ tareas }), datos, 9, DESDE)).toBeNull();
  });

  it('encuentra la que tiene la madre pedida y fue creada desde el momento indicado', async () => {
    const tareas = vi.fn().mockResolvedValue({
      tareas: [
        tareaDe(1, { titulo: 'Nueva', proyectoId: 11, autorId: 9, madreId: 5, creada: '2026-10-19T12:00:00Z' }),
        tareaDe(2, { titulo: 'Nueva', proyectoId: 11, autorId: 9, madreId: 6, creada: '2026-10-19T12:00:00Z' }),
        tareaDe(3, { titulo: 'Nueva', proyectoId: 11, autorId: 9, madreId: 5, creada: '2026-10-01T10:00:00Z' }),
      ],
      salteadas: [],
    });
    expect((await buscarTareaCreada(clienteCon({ tareas }), { ...datos, madreId: 5 }, 9, DESDE))?.id).toBe(1);
  });

  it('devuelve null si no aparece', async () => {
    const tareas = vi.fn().mockResolvedValue({ tareas: [tareaDe(2, { titulo: 'Otra', proyectoId: 11, autorId: 9 })], salteadas: [] });
    expect(await buscarTareaCreada(clienteCon({ tareas }), datos, 9, DESDE)).toBeNull();
  });

  it('lanza si no puede preguntar', async () => {
    const tareas = vi.fn().mockRejectedValue(new ErrorOp('red', 'x'));
    await expect(buscarTareaCreada(clienteCon({ tareas }), datos, 9, DESDE)).rejects.toBeInstanceOf(ErrorOp);
  });
});

describe('buscarComentario', () => {
  const act = (id: number, comentario: string, autorId: number | null, creada: string) => ({ id, comentario, autorId, creada, detalles: [] });

  it('encuentra el comentario del mismo autor, con el mismo texto y desde ese momento', async () => {
    const actividades = vi.fn().mockResolvedValue([act(1, 'Hola', 9, '2026-10-19T12:00:00Z')]);
    expect(await buscarComentario(clienteCon({ actividades }), 5, 9, '  Hola ', DESDE)).toBe(true);
    expect(actividades).toHaveBeenCalledWith(5);
  });

  it.each([
    ['otro autor', act(1, 'Hola', 4, '2026-10-19T12:00:00Z')],
    ['otro texto', act(1, 'Chau', 9, '2026-10-19T12:00:00Z')],
    ['anterior al pedido', act(1, 'Hola', 9, '2026-10-19T11:00:00Z')],
  ])('no lo da por hecho con %s', async (_n, actividad) => {
    const actividades = vi.fn().mockResolvedValue([actividad]);
    expect(await buscarComentario(clienteCon({ actividades }), 5, 9, 'Hola', DESDE)).toBe(false);
  });

  it('lanza si no puede preguntar', async () => {
    const actividades = vi.fn().mockRejectedValue(new ErrorOp('red', 'x'));
    await expect(buscarComentario(clienteCon({ actividades }), 5, 9, 'Hola', DESDE)).rejects.toBeInstanceOf(ErrorOp);
  });
});

describe('buscarDependencia', () => {
  it('encuentra la dependencia entre esas dos tareas', async () => {
    const dependencias = vi.fn().mockResolvedValue([
      { id: 1, sucesoraId: 8, predecesoraId: 6, lag: 0 },
      { id: 31, sucesoraId: 8, predecesoraId: 7, lag: 0 },
    ]);
    expect(await buscarDependencia(clienteCon({ dependencias }), 8, 7)).toEqual({ id: 31, sucesoraId: 8, predecesoraId: 7, lag: 0 });
  });

  it('devuelve null si no existe', async () => {
    const dependencias = vi.fn().mockResolvedValue([{ id: 1, sucesoraId: 7, predecesoraId: 8, lag: 0 }]);
    expect(await buscarDependencia(clienteCon({ dependencias }), 8, 7)).toBeNull();
  });

  it('lanza si no puede preguntar', async () => {
    const dependencias = vi.fn().mockRejectedValue(new ErrorOp('red', 'x'));
    await expect(buscarDependencia(clienteCon({ dependencias }), 8, 7)).rejects.toBeInstanceOf(ErrorOp);
  });
});
