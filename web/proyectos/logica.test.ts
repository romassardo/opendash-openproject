import { describe, expect, it } from 'vitest';
import type { Catalogo, Version } from '../../compartido/tipos.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { contadoresProyectos, resumirProyecto, type ResumenProyecto } from './logica.js';

const HOY = '2026-10-19';
const NUEVO = 1;
const CERRADO = 12;
const HITO = 2;
const MADRE = 3;
const PROYECTO = CATALOGO.proyectos[0]!;

const resumir = (tareas: ReturnType<typeof tareaDe>[], catalogo: Catalogo = CATALOGO) => resumirProyecto(PROYECTO, tareas, catalogo, HOY);

describe('resumirProyecto', () => {
  it('un proyecto sin tareas queda activo con avance 0 y sin próximo hito', () => {
    const r = resumir([]);
    expect(r).toMatchObject({ estado: 'activo', hechas: 0, total: 0, porcentaje: 0, proximoHito: null, personas: [], fin: null, vencidas: 0 });
  });

  it('el avance no cuenta madres ni hitos', () => {
    const r = resumir([
      tareaDe(1, { tipoId: MADRE, estadoId: NUEVO }),
      tareaDe(2, { madreId: 1, estadoId: CERRADO }),
      tareaDe(3, { madreId: 1, estadoId: NUEVO }),
      tareaDe(4, { tipoId: HITO, estadoId: CERRADO, fin: '2026-10-01' }),
      tareaDe(5, { estadoId: CERRADO }),
      tareaDe(6, { proyectoId: 12, estadoId: CERRADO }), // de otro proyecto
    ]);
    expect(r.hechas).toBe(2);
    expect(r.total).toBe(3);
    expect(r.porcentaje).toBe(67);
    expect(r.estado).toBe('activo');
  });

  it('es terminado cuando hay tareas y todas están cerradas', () => {
    const r = resumir([tareaDe(1, { estadoId: CERRADO }), tareaDe(2, { estadoId: 14 })]);
    expect(r.estado).toBe('terminado');
    expect(r.porcentaje).toBe(100);
  });

  it('el próximo hito es el abierto más temprano y si no hay, la versión siguiente', () => {
    const versiones: Version[] = [
      { id: 1, nombre: 'v1', proyectoId: 11, estado: 'abierta', inicio: null, fin: '2026-10-10' }, // ya pasó
      { id: 2, nombre: 'v2', proyectoId: 11, estado: 'abierta', inicio: null, fin: '2026-11-30' },
      { id: 3, nombre: 'v1.5', proyectoId: 11, estado: 'abierta', inicio: null, fin: '2026-11-05' },
      { id: 4, nombre: 'otra', proyectoId: 12, estado: 'abierta', inicio: null, fin: '2026-10-20' }, // de otro proyecto
    ];
    const catalogo = { ...CATALOGO, versiones };
    const conHitos = resumir([
      tareaDe(1, { tipoId: HITO, titulo: 'Beta', fin: '2026-12-01' }),
      tareaDe(2, { tipoId: HITO, titulo: 'Vencido', fin: '2026-10-05' }),
      tareaDe(3, { tipoId: HITO, titulo: 'Hecho', fin: '2026-09-01', estadoId: CERRADO }),
    ], catalogo);
    expect(conHitos.proximoHito).toEqual({ titulo: 'Vencido', fecha: '2026-10-05', esVersion: false });

    const sinHitos = resumir([tareaDe(1, { estadoId: NUEVO })], catalogo);
    expect(sinHitos.proximoHito).toEqual({ titulo: 'v1.5', fecha: '2026-11-05', esVersion: true });
  });

  it('personas, fin y vencidas salen de las tareas', () => {
    const r = resumir([
      tareaDe(1, { responsableId: 5, estadoId: NUEVO, fin: '2026-10-10' }),
      tareaDe(2, { responsableId: 9, estadoId: NUEVO, fin: '2026-10-30' }),
      tareaDe(3, { responsableId: 5, estadoId: NUEVO, fin: HOY }),
      tareaDe(4, { responsableId: 7, estadoId: CERRADO, fin: '2026-09-01' }), // cerrada: no suma persona
      tareaDe(5, { tipoId: HITO, fin: '2026-12-15' }),
    ]);
    expect(r.personas).toEqual([5, 9]);
    expect(r.fin).toBe('2026-12-15');
    expect(r.vencidas).toBe(1);
  });

  it('si no hay abiertas, las personas salen de todas las tareas', () => {
    const r = resumir([tareaDe(1, { responsableId: 7, estadoId: CERRADO }), tareaDe(2, { responsableId: 5, estadoId: CERRADO })]);
    expect(r.personas).toEqual([7, 5]);
  });
});

describe('contadoresProyectos', () => {
  const resumen = (extra: Partial<ResumenProyecto>): ResumenProyecto => ({
    proyecto: PROYECTO, estado: 'activo', hechas: 0, total: 1, porcentaje: 0, proximoHito: null, personas: [], fin: null, vencidas: 0, ...extra,
  });

  it('enFecha es null sin proyectos activos', () => {
    expect(contadoresProyectos([resumen({ estado: 'terminado' })], HOY)).toEqual({ activos: 0, terminados: 1, enFecha: null, vencenEsteMes: 0 });
  });

  it('cuenta activos en fecha y los que vencen este mes', () => {
    const c = contadoresProyectos([
      resumen({ fin: '2026-10-31' }),
      resumen({ fin: '2026-10-05', vencidas: 2 }),
      resumen({ fin: '2026-11-01' }),
      resumen({ fin: null }),
      resumen({ estado: 'terminado', fin: '2026-10-10' }),
    ], HOY);
    expect(c).toEqual({ activos: 4, terminados: 1, enFecha: 75, vencenEsteMes: 2 });
  });
});
