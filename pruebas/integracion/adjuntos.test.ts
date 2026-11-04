// Adjuntos y borrado de tareas del cliente real contra el OpenProject de Docker (OpenProject 16).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClienteOp } from '../../servidor/openproject/cliente.js';
import { ErrorOp } from '../../servidor/openproject/errores.js';
import { admin, borrarProyecto, clienteConRol, crearProyecto } from './ayudas.js';

let proyectoId = 0;
let tareaId = 0;
let lector: ClienteOp;

beforeAll(async () => {
  proyectoId = await crearProyecto(`int-adjuntos-${Date.now()}`, 'Integración adjuntos');
  const tipo = (await admin.catalogo()).tipos.find((t) => t.nombre === 'Task')!.id;
  tareaId = (await admin.crearTarea({ titulo: 'Con adjuntos', proyectoId, tipoId: tipo })).id;
  lector = await clienteConRol('Reader', proyectoId);
});

afterAll(async () => {
  if (proyectoId !== 0) await borrarProyecto(proyectoId);
});

describe('adjuntos contra OpenProject 16', () => {
  it('sube, lista, baja y borra un adjunto con nombre «informe ñandú.txt»', async () => {
    expect(await admin.puedeAdjuntar(tareaId)).toBe(true);
    const subido = await admin.subirAdjunto(tareaId, 'informe ñandú.txt', 'text/plain', Buffer.from('contenido ñ'));
    // OpenProject cambia los espacios por «_» y se acepta.
    expect(subido.nombre).toBe('informe_ñandú.txt');
    expect(subido.bytes).toBe(Buffer.byteLength('contenido ñ'));
    expect(subido.puedeBorrar).toBe(true);
    expect((await admin.adjuntos(tareaId)).map((a) => a.id)).toContain(subido.id);
    expect((await admin.adjunto(subido.id)).nombre).toBe('informe_ñandú.txt');
    const bajado = await admin.bajarAdjunto(subido.id, 1024);
    expect(bajado.bytes.toString('utf8')).toBe('contenido ñ');
    await admin.borrarAdjunto(subido.id);
    expect((await admin.adjuntos(tareaId)).map((a) => a.id)).not.toContain(subido.id);
  });

  it('un Reader no puede adjuntar (puedeAdjuntar false) y su subida da prohibido', async () => {
    expect(await lector.puedeAdjuntar(tareaId)).toBe(false);
    const error = await lector.subirAdjunto(tareaId, 'x.txt', 'text/plain', Buffer.from('x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorOp);
    expect((error as ErrorOp).tipo).toBe('prohibido');
  });

  it('5 MB + 1 byte da validacion', async () => {
    const max = await admin.maximoAdjunto();
    expect(max).toBe(5_242_880);
    const error = await admin.subirAdjunto(tareaId, 'grande.bin', 'application/octet-stream', Buffer.alloc(max + 1)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorOp);
    expect((error as ErrorOp).tipo).toBe('validacion');
  });
});

describe('borrar tareas contra OpenProject 16', () => {
  it('puedeBorrarTarea y borrarTarea: el admin borra; el Reader no puede', async () => {
    const tipo = (await admin.catalogo()).tipos.find((t) => t.nombre === 'Task')!.id;
    const t = await admin.crearTarea({ titulo: 'Para borrar', proyectoId, tipoId: tipo });
    expect(await lector.puedeBorrarTarea(t.id)).toBe(false);
    expect(await admin.puedeBorrarTarea(t.id)).toBe(true);
    await admin.borrarTarea(t.id);
    const error = await admin.tarea(t.id).catch((e: unknown) => e);
    expect((error as ErrorOp).tipo).toBe('no-encontrado');
  });
});
