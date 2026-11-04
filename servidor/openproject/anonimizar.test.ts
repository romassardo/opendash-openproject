import { describe, expect, it } from 'vitest';
import { crearAnonimizador } from '../../pruebas/anonimizar.js';

const muestra = {
  principals: [{
    _type: 'User', id: 5, name: 'Juan Pérez', firstName: 'Juan', lastName: 'Pérez', login: 'jperez', email: 'juan@empresa.com', avatar: 'http://x/a.png',
    _links: { self: { href: '/api/v3/users/5', title: 'Juan Pérez' } },
  }],
  tarea: {
    _type: 'WorkPackage', id: 40, subject: 'Facturar a Cliente Secreto', description: { raw: 'Datos del cliente', html: '<p>Datos del cliente</p>' },
    customField3: 'valor secreto',
    _links: {
      self: { href: '/api/v3/work_packages/40', title: 'Facturar a Cliente Secreto' },
      assignee: { href: '/api/v3/users/5', title: 'Juan Pérez' },
      customField7: { href: '/api/v3/users/9', title: 'María Gómez' },
      children: [{ href: '/api/v3/work_packages/41', title: 'Subtarea confidencial' }],
      ancestors: [{ href: '/api/v3/work_packages/39', title: 'Madre confidencial' }],
      project: { href: '/api/v3/projects/11', title: 'Proyecto Reservado' },
      status: { href: '/api/v3/statuses/12', title: 'Closed' },
      // Los enlaces de acción repiten el título de la tarea.
      logTime: { href: '/api/v3/time_entries', method: 'post', title: "Log time on work package 'Facturar a Cliente Secreto'" },
      addChild: { href: '/api/v3/work_packages', method: 'post', title: 'Add child of Facturar a Cliente Secreto' },
    },
  },
  proyecto: { _type: 'Project', id: 11, name: 'Proyecto Reservado', identifier: 'reservado', description: { raw: 'Interno', html: '<p>Interno</p>' } },
  actividad: {
    _type: 'Activity::Comment', id: 77, comment: { raw: 'Llamé a Pedro', html: '<p>Llamé a Pedro</p>' },
    details: [{ raw: 'Estado se cambió de In progress a Closed', html: 'x' }, { raw: 'Título se cambió de Secreto a Otro', html: 'y' }],
    _links: { workPackage: { href: '/api/v3/work_packages/40', title: 'Facturar a Cliente Secreto' }, user: { href: '/api/v3/users/5', title: 'Juan Pérez' } },
  },
};

describe('anonimizador de fixtures', () => {
  const salida = crearAnonimizador()(muestra);
  const texto = JSON.stringify(salida);

  it('no deja ningún nombre ni título original', () => {
    for (const secreto of ['Juan', 'Pérez', 'jperez', 'empresa.com', 'Cliente Secreto', 'María', 'Gómez', 'confidencial', 'Reservado', 'reservado', 'Interno', 'Pedro', 'Secreto a Otro', 'valor secreto', 'Datos del cliente', 'a.png']) {
      expect(texto).not.toContain(secreto);
    }
  });
  it('numera personas y tareas de forma consistente por id', () => {
    expect(salida.principals[0]._links.self.title).toBe('Persona 1');
    expect(salida.tarea._links.assignee.title).toBe('Persona 1');
    expect(salida.actividad._links.user.title).toBe('Persona 1');
    expect(salida.tarea._links.self.title).toBe(salida.tarea.subject);
    expect(salida.actividad._links.workPackage.title).toBe(salida.tarea.subject);
  });
  it('quita customField de atributos y enlaces', () => {
    expect(salida.tarea.customField3).toBeUndefined();
    expect(salida.tarea._links.customField7).toBeUndefined();
  });
  it('conserva los cambios de estado', () => {
    expect(salida.actividad.details[0].raw).toBe('Estado se cambió de In progress a Closed');
  });
  it('no muta la entrada', () => {
    expect(muestra.tarea.subject).toBe('Facturar a Cliente Secreto');
  });
});
