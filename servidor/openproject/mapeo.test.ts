import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { halTarea, leerFixture } from '../../pruebas/fabricas/op.js';
import { aAdjunto, aDiaNoLaborable, aDiaSemana, aMiembro, aPrioridad, aProyecto, aRol, aTarea, aVersion, horasDeDuracion } from './mapeo.js';

const rutaTareasGrabadas = resolve(dirname(fileURLToPath(import.meta.url)), '../../pruebas/fixtures/op/work_packages.json');

describe('mapeo', () => {
  it('un adjunto sabe si se puede borrar por el enlace delete', () => {
    const hal = { id: 9, fileName: 'informe ñandú.txt', fileSize: 12, contentType: 'text/plain', createdAt: '2026-10-25T10:00:00Z', _links: { author: { href: '/api/v3/users/4' } } };
    expect(aAdjunto(hal)).toEqual({ id: 9, nombre: 'informe ñandú.txt', bytes: 12, tipo: 'text/plain', autorId: 4, creado: '2026-10-25T10:00:00Z', puedeBorrar: false });
    expect(aAdjunto({ ...hal, _links: { ...hal._links, delete: { href: '/api/v3/attachments/9', method: 'delete' } } }).puedeBorrar).toBe(true);
  });
  it('aVersion lee endDate y el estado', () => {
    const hal = { id: 6, name: 'v1', _links: { definingProject: { href: '/api/v3/projects/11' } } };
    expect(aVersion({ ...hal, startDate: '2026-11-01', endDate: '2026-11-30', status: 'locked' }))
      .toEqual({ id: 6, nombre: 'v1', proyectoId: 11, estado: 'bloqueada', inicio: '2026-11-01', fin: '2026-11-30' });
    // respaldo: effectiveDate (OpenProject anterior a 16.6)
    expect(aVersion({ ...hal, effectiveDate: '2026-11-30' }).fin).toBe('2026-11-30');
    expect(aVersion({ ...hal, endDate: null, effectiveDate: null }).fin).toBeNull();
    expect(aVersion({ ...hal, status: 'closed' }).estado).toBe('cerrada');
    expect(aVersion(hal)).toMatchObject({ estado: 'abierta', inicio: null, fin: null });
  });
  it('aMiembro lee la persona y los roles; un grupo se descarta', () => {
    const hal = { id: 9, _links: { principal: { href: '/api/v3/users/4' }, roles: [{ href: '/api/v3/roles/5', title: 'Project admin' }] } };
    expect(aMiembro(hal)).toEqual({ id: 9, personaId: 4, roles: [{ id: 5, nombre: 'Project admin' }] });
    expect(aMiembro({ ...hal, _links: { ...hal._links, principal: { href: '/api/v3/groups/4' } } })).toBeNull();
  });
  it('aRol toma id y nombre', () => {
    expect(aRol({ id: 3, name: 'Member' })).toEqual({ id: 3, nombre: 'Member' });
  });
  it('un proyecto toma la clave de su estado del href', () => {
    const hal = { id: 11, name: 'Portal', identifier: 'portal' };
    const conEstado = (href: string | null) => aProyecto({ ...hal, _links: { status: { href, title: 'En riesgo' } } });
    expect(conEstado('/api/v3/project_statuses/at_risk')).toMatchObject({ estadoOp: 'En riesgo', estadoOpClave: 'at_risk' });
    expect(conEstado(null).estadoOpClave).toBeNull();
    expect(aProyecto(hal).estadoOpClave).toBeNull();
  });
  it('mapea una tarea con todos los opcionales en null', () => {
    const t = aTarea(halTarea({ assignee: null, startDate: null, dueDate: null, estimatedTime: null, description: { raw: null }, parent: null, version: null }));
    expect(t).toMatchObject({ responsableId: null, inicio: null, fin: null, estimacionHoras: null, descripcion: '', madreId: null, versionId: null, cerradaEl: null, comentarios: null });
  });
  it('pasa el día de la semana de OpenProject (7 = domingo) a 0 = domingo', () => {
    expect(aDiaSemana({ day: 7, working: false })).toEqual({ dia: 0, laborable: false });
    expect(aDiaSemana({ day: 1, working: true })).toEqual({ dia: 1, laborable: true });
  });
  it('lee la fecha de un día no laborable', () => {
    expect(aDiaNoLaborable({ date: '2026-11-23', name: 'x' })).toBe('2026-11-23');
  });
  it('lee las horas reales de spentTime', () => {
    expect(aTarea({ ...(halTarea() as object), spentTime: 'PT6H20M' }).horasReales).toBeCloseTo(6.333, 2);
  });
  it('lee el trabajo restante de remainingTime; sin él es null', () => {
    expect(aTarea({ ...(halTarea() as object), remainingTime: 'PT8H' }).restanteHoras).toBe(8);
    expect(aTarea(halTarea()).restanteHoras).toBeNull();
  });
  it('sin spentTime las horas reales son null', () => {
    expect(aTarea(halTarea()).horasReales).toBeNull();
  });
  it('mapea los ids desde los enlaces', () => {
    const t = aTarea(halTarea({ id: 9, assignee: 4, parent: 3, version: 6 }));
    expect(t).toMatchObject({ id: 9, responsableId: 4, madreId: 3, versionId: 6 });
  });
  it('un hito toma inicio y fin de date', () => {
    const pagina = leerFixture('work_packages.json');
    const hito = pagina._embedded.elements.find((e: any) => e._links.type.href === '/api/v3/types/2' && !e.startDate && !e.dueDate);
    expect(hito?.date).toBeTruthy();
    expect(aTarea(hito)).toMatchObject({ inicio: hito.date, fin: hito.date });
  });
  it('una tarea común conserva sus propias fechas aunque traiga date', () => {
    const t = aTarea({ ...halTarea({ startDate: '2026-10-01', dueDate: '2026-10-05' }), date: '2026-10-09' });
    expect(t).toMatchObject({ inicio: '2026-10-01', fin: '2026-10-05' });
  });
  it('aPrioridad calcula el nivel y alta desde el nombre', () => {
    expect(aPrioridad({ id: 10, name: 'Immediate' })).toEqual({ id: 10, nombre: 'Immediate', alta: true, nivel: 'inmediata' });
    expect(aPrioridad({ id: 8, name: 'Normal' })).toMatchObject({ alta: false, nivel: 'normal' });
    expect(aPrioridad({ id: 11, name: 'Crítica' })).toMatchObject({ alta: false, nivel: null });
  });
  it.each([['PT2H', 2], ['PT1H30M', 1.5], ['P1DT2H', 26], ['P1W', 168], ['P1WT2H', 170], ['P1M', null], ['P1Y', null], ['basura', null], [null, null]])('duración %s → %s horas', (iso, h) => {
    expect(horasDeDuracion(iso)).toBe(h);
  });
  it.runIf(existsSync(rutaTareasGrabadas))('mapea todas las tareas grabadas sin errores', () => {
    const pagina = leerFixture('work_packages.json');
    expect(() => pagina._embedded.elements.map(aTarea)).not.toThrow();
  });
});
