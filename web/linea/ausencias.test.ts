import { describe, expect, it } from 'vitest';
import type { MiembroEquipo } from '../../compartido/tipos.js';
import { feriadosEnVentana, textoVacaciones, tramoQuePisa, vacacionesPorPersona } from './ausencias.js';

const lista = { actualizado: null, feriados: [
  { fecha: '2026-10-12', nombre: 'Diversidad', puente: false, manual: false },
  { fecha: '2026-11-20', nombre: 'Puente', puente: true, manual: false },
  { fecha: '2026-12-25', nombre: 'Navidad', puente: false, manual: false },
] };
const tramo = { desde: '2026-10-26', hasta: '2026-10-28' };

describe('ausencias', () => {
  it('feriados: deja afuera los de fuera de la ventana y suma los puentes', () => {
    const m = feriadosEnVentana(lista, '2026-11-01', '2026-11-30');
    expect([...m.entries()]).toEqual([['2026-11-20', 'Puente']]);
    expect(feriadosEnVentana(undefined, 'a', 'b').size).toBe(0);
  });
  it('feriados: un feriado común dentro de la ventana también cuenta, con su nombre', () => {
    expect([...feriadosEnVentana(lista, '2026-10-01', '2026-10-31').entries()]).toEqual([['2026-10-12', 'Diversidad']]);
  });
  it('vacaciones por persona', () => {
    const eq = [{ personaId: 7, vacaciones: [tramo] }, { personaId: 8, vacaciones: [] }] as unknown as MiembroEquipo[];
    const porPersona = vacacionesPorPersona(eq);
    expect([...porPersona.keys()]).toEqual([7]);
    expect(porPersona.get(7)).toEqual([tramo]);
  });
  it('tramoQuePisa respeta bordes y una sola fecha', () => {
    expect(tramoQuePisa({ inicio: '2026-10-23', fin: '2026-10-26' }, [tramo])).toEqual(tramo);
    expect(tramoQuePisa({ inicio: '2026-10-22', fin: '2026-10-23' }, [tramo])).toBeNull();
    expect(tramoQuePisa({ inicio: null, fin: '2026-10-28' }, [tramo])).toEqual(tramo);
    expect(tramoQuePisa({ inicio: null, fin: null }, [tramo])).toBeNull();
    expect(tramoQuePisa({ inicio: '2026-10-27', fin: null }, undefined)).toBeNull();
  });
  it('textoVacaciones usa el primer nombre y d/m', () => {
    expect(textoVacaciones('Ana Pereyra', tramo)).toBe('Ana está de vacaciones del 26/10 al 28/10');
  });
});
