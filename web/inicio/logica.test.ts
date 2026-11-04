import { describe, expect, it } from 'vitest';
import type { EstadoHoras, Reunion } from '../../compartido/tipos.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { abiertasPropias, agendaDeHoy, horasDeHoy, horasTexto, resumenHoy, saludo, semanaEquipo, subtituloInicio } from './logica.js';

const HOY = '2026-10-19'; // lunes
const NUEVO = 1;
const CERRADO = 12;
const HITO = 2;

describe('saludo', () => {
  it('usa la hora argentina y el primer nombre', () => {
    expect(saludo('Ramiro Medina', new Date('2026-10-19T12:30:00Z'))).toBe('Buen día, Ramiro'); // 09:30
    expect(saludo('Ramiro Medina', new Date('2026-10-19T15:00:00Z'))).toBe('Buenas tardes, Ramiro'); // 12:00
    expect(saludo('Ramiro', new Date('2026-10-19T23:00:00Z'))).toBe('Buenas noches, Ramiro'); // 20:00
    expect(saludo('Ramiro', new Date('2026-10-19T07:59:00Z'))).toBe('Buenas noches, Ramiro'); // 04:59
    expect(saludo('Ramiro', new Date('2026-10-19T08:00:00Z'))).toBe('Buen día, Ramiro'); // 05:00
  });
});

describe('resumenHoy', () => {
  it('paraHoy suma las cerradas hoy y las abiertas que vencen hasta hoy', () => {
    const tareas = [
      tareaDe(1, { responsableId: 9, estadoId: CERRADO, cerradaEl: '2026-10-19T14:00:00Z' }),
      tareaDe(2, { responsableId: 9, estadoId: CERRADO, cerradaEl: '2026-10-18T14:00:00Z' }), // ayer: no
      tareaDe(3, { responsableId: 9, estadoId: NUEVO, fin: HOY }),
      tareaDe(4, { responsableId: 9, estadoId: NUEVO, fin: '2026-10-15' }),
      tareaDe(5, { responsableId: 9, estadoId: NUEVO, fin: '2026-10-20' }), // mañana: no
      tareaDe(6, { responsableId: 9, estadoId: NUEVO }), // sin fin: no
      tareaDe(7, { responsableId: 5, estadoId: NUEVO, fin: HOY }), // ajena
      tareaDe(8, { responsableId: 9, tipoId: HITO, estadoId: NUEVO, fin: HOY }), // hito
      tareaDe(9, { responsableId: 9, estadoId: NUEVO, fin: HOY }),
    ];
    const r = resumenHoy(tareas, CATALOGO, 9, HOY);
    expect(r.hechas).toBe(1);
    expect(r.paraHoy).toBe(4);
    expect(r.vencidas).toBe(1);
    expect(r.mias.map((t) => t.id)).toEqual([4, 3, 9]);
  });
});

describe('resumenHoy: vencidas con la regla de «Para ordenar»', () => {
  const proyectoPlantilla = 12;
  it('cuenta la de solo inicio y el hito vencido, y no las madres con hijas abiertas ni las de proyectos plantilla', () => {
    const tareas = [
      tareaDe(1, { responsableId: 9, inicio: '2026-10-12' }), // solo inicio pasado
      tareaDe(2, { responsableId: 9, tipoId: HITO, fin: '2026-10-13' }), // hito vencido
      tareaDe(3, { responsableId: 9, fin: '2026-10-14' }), // madre con una hija abierta
      tareaDe(4, { responsableId: 9, madreId: 3, fin: '2026-10-14' }),
      tareaDe(5, { responsableId: 9, proyectoId: proyectoPlantilla, fin: '2026-10-14' }),
      tareaDe(6, { responsableId: 5, fin: '2026-10-14' }), // ajena
    ];
    const catalogo = { ...CATALOGO, plantillas: [proyectoPlantilla] };
    expect(resumenHoy(tareas, catalogo, 9, HOY).vencidas).toBe(3);
    // Sin ser plantilla, la del proyecto 12 también cuenta.
    expect(resumenHoy(tareas, CATALOGO, 9, HOY).vencidas).toBe(4);
  });
});

describe('subtituloInicio', () => {
  it('dice el día y cuántas tareas hay para hoy', () => {
    expect(subtituloInicio(HOY, 5)).toBe('lunes 19 de octubre · 5 tareas para hoy');
    expect(subtituloInicio(HOY, 1)).toBe('lunes 19 de octubre · 1 tarea para hoy');
    expect(subtituloInicio(HOY, 0)).toBe('lunes 19 de octubre · nada pendiente para hoy');
  });

  it('el subtítulo dice 3 reuniones y 5 tareas para hoy', () => {
    expect(subtituloInicio(HOY, 5, 3)).toBe('lunes 19 de octubre · 3 reuniones y 5 tareas para hoy');
    expect(subtituloInicio(HOY, 1, 1)).toBe('lunes 19 de octubre · 1 reunión y 1 tarea para hoy');
    expect(subtituloInicio(HOY, 0, 3)).toBe('lunes 19 de octubre · 3 reuniones para hoy');
    expect(subtituloInicio(HOY, 0, 1)).toBe('lunes 19 de octubre · 1 reunión para hoy');
    expect(subtituloInicio(HOY, 5, 0)).toBe('lunes 19 de octubre · 5 tareas para hoy');
    expect(subtituloInicio(HOY, 0, 0)).toBe('lunes 19 de octubre · nada pendiente para hoy');
    expect(subtituloInicio(HOY, 5, null)).toBe('lunes 19 de octubre · 5 tareas para hoy');
  });
});

describe('agendaDeHoy', () => {
  // Lunes 19, hora argentina = UTC − 3.
  const reunion = (id: string, inicio: string, fin: string, extra: Partial<Reunion> = {}): Reunion =>
    ({ id, titulo: id, lugar: null, inicio, fin, diaEntero: false, libre: false, enlace: null, plataforma: null, ...extra });
  const reuniones = [
    reunion('tarde', '2026-10-19T17:00:00Z', '2026-10-19T18:00:00Z'), // 14:00
    reunion('manana', '2026-10-19T12:00:00Z', '2026-10-19T12:30:00Z'), // 9:00
    reunion('actual', '2026-10-19T13:30:00Z', '2026-10-19T14:30:00Z'), // 10:30
    reunion('libre', '2026-10-19T15:00:00Z', '2026-10-19T16:00:00Z', { libre: true }),
    reunion('entero', '2026-10-19T03:00:00Z', '2026-10-20T03:00:00Z', { diaEntero: true }),
    reunion('ayer', '2026-10-18T13:00:00Z', '2026-10-18T14:00:00Z'),
    reunion('mañana', '2026-10-20T13:00:00Z', '2026-10-20T14:00:00Z'),
  ];

  it('agendaDeHoy separa las pasadas, la actual y la siguiente', () => {
    const agenda = agendaDeHoy(reuniones, HOY, new Date('2026-10-19T14:00:00Z')); // 11:00
    expect(agenda.reuniones.map((r) => r.id)).toEqual(['manana', 'actual', 'tarde']);
    expect(agenda.pasadas).toBe(1);
    expect(agenda.actual?.id).toBe('actual');
    expect(agenda.siguiente?.id).toBe('tarde');
  });

  it('una reunión que viene de ayer y sigue en curso entra y es la actual', () => {
    const cruza = reunion('cruza', '2026-10-19T02:00:00Z', '2026-10-19T04:00:00Z'); // 23:00 del 18 a 01:00 del 19
    const agenda = agendaDeHoy([cruza], HOY, new Date('2026-10-19T03:30:00Z')); // 00:30
    expect(agenda.reuniones.map((r) => r.id)).toEqual(['cruza']);
    expect(agenda.actual?.id).toBe('cruza');
  });

  it('una de día entero o «libre» que viene de ayer no entra', () => {
    const entero = reunion('entero', '2026-10-18T03:00:00Z', '2026-10-19T03:00:00Z', { diaEntero: true });
    const libre = reunion('libre', '2026-10-19T02:00:00Z', '2026-10-19T04:00:00Z', { libre: true });
    expect(agendaDeHoy([entero, libre], HOY, new Date('2026-10-19T03:30:00Z')).reuniones).toEqual([]);
  });

  it('una que termina justo a la medianoche no entra', () => {
    const termina = reunion('termina', '2026-10-19T02:00:00Z', '2026-10-19T03:00:00Z');
    expect(agendaDeHoy([termina], HOY, new Date('2026-10-19T03:30:00Z')).reuniones).toEqual([]);
  });

  it('sin reunión en curso, la siguiente es la primera que empieza después', () => {
    const agenda = agendaDeHoy(reuniones, HOY, new Date('2026-10-19T12:45:00Z')); // 9:45
    expect(agenda.actual).toBeNull();
    expect(agenda.siguiente?.id).toBe('actual');
    expect(agenda.pasadas).toBe(1);
  });

  it('si hay varias en curso, la actual es la que empezó última; terminadas todas, no queda ninguna', () => {
    const solapadas = [
      reunion('a', '2026-10-19T13:00:00Z', '2026-10-19T15:00:00Z'),
      reunion('b', '2026-10-19T14:00:00Z', '2026-10-19T15:00:00Z'),
    ];
    expect(agendaDeHoy(solapadas, HOY, new Date('2026-10-19T14:30:00Z')).actual?.id).toBe('b');
    const fin = agendaDeHoy(solapadas, HOY, new Date('2026-10-19T15:00:00Z'));
    expect(fin).toMatchObject({ pasadas: 2, actual: null, siguiente: null });
  });
});

describe('semanaEquipo', () => {
  const cerrada = (id: number, dia: string, extra = {}) => tareaDe(id, { estadoId: CERRADO, cerradaEl: `${dia}T15:00:00Z`, ...extra });

  it('semanaEquipo compara con los mismos días de la semana pasada', () => {
    const tareas = [
      cerrada(1, '2026-10-19'), cerrada(2, '2026-10-19'), cerrada(3, '2026-10-21'), // esta semana
      cerrada(4, '2026-10-12'), cerrada(5, '2026-10-12'), cerrada(6, '2026-10-12'), cerrada(7, '2026-10-14'), // pasada
      cerrada(8, '2026-10-19', { tipoId: HITO }), // hito: no cuenta
    ];
    const s = semanaEquipo(tareas, CATALOGO, HOY);
    expect(s.dias.map((d) => d.fecha)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(s.dias.map((d) => d.cantidad)).toEqual([2, 0, 1, 0, 0, 0, 0]);
    expect(s.total).toBe(2); // lunes a hoy
    expect(s.anterior).toBe(3); // solo el lunes pasado
    expect(s.variacion).toBe(-33);
  });

  it('sin cierres la semana pasada la variación es null', () => {
    const s = semanaEquipo([cerrada(1, '2026-10-19')], CATALOGO, HOY);
    expect(s.anterior).toBe(0);
    expect(s.variacion).toBeNull();
  });
});

describe('horasDeHoy', () => {
  it('pasa los segundos de hoy y la jornada a horas', () => {
    const estado: EstadoHoras = { enMarcha: [], hoy: [], avisos: [], totalHoySegundos: 5400, jornadaSegundos: 28800, variasALaVez: false, horasExtra: false, ultimoDia: null };
    expect(horasDeHoy(estado)).toEqual({ horas: 1.5, meta: 8 });
  });
});

describe('horasTexto', () => {
  it('escribe horas con coma y un decimal como máximo', () => {
    expect(horasTexto(1.1)).toBe('1,1 h');
    expect(horasTexto(2)).toBe('2 h');
    expect(horasTexto(0)).toBe('0 h');
    expect(horasTexto(0.04)).toBe('0 h');
  });
});

describe('abiertasPropias', () => {
  it('deja las abiertas de la persona, sin hitos ni cerradas, por título', () => {
    const tareas = [
      tareaDe(1, { titulo: 'Zeta', responsableId: 9, estadoId: NUEVO }),
      tareaDe(2, { titulo: 'Alfa', responsableId: 9, estadoId: NUEVO }),
      tareaDe(3, { titulo: 'Cerrada', responsableId: 9, estadoId: CERRADO }),
      tareaDe(4, { titulo: 'Hito', responsableId: 9, tipoId: HITO, estadoId: NUEVO }),
      tareaDe(5, { titulo: 'Ajena', responsableId: 5, estadoId: NUEVO }),
    ];
    expect(abiertasPropias(tareas, CATALOGO, 9).map((t) => t.titulo)).toEqual(['Alfa', 'Zeta']);
  });
});
