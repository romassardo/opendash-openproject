import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { Dependencia, Tarea } from '../../compartido/tipos.js';
import { CATALOGO } from '../../pruebas/fabricas/web.js';
import { tareaDe } from '../../pruebas/fabricas/sync.js';
import type { Tramo } from './ausencias.js';
import { armarFilas, type OpcionesFilas } from './filas.js';
import type { CambiosLinea } from './useCambiosLinea.js';
import { LineaDeTiempo } from './LineaDeTiempo.js';
import { ventanaDesde, type Zoom } from './modelo.js';
import { ANCHO_LISTA } from './medidas.js';

afterEach(cleanup);

const HOY = '2026-10-19';
const OPCIONES: OpcionesFilas = { vista: 'proyecto', soloConDependencias: false, proyectoId: null, personaId: null, plegados: new Set(), orden: {}, yoId: null, terminadasVisibles: new Set(['proyecto-11', 'proyecto-12', 'persona-9', 'persona-5', 'todas']) };
const VENTANA = ventanaDesde('2026-10-12', 'mes', 1200);
const dep = (id: number, predecesoraId: number, sucesoraId: number): Dependencia => ({ id, predecesoraId, sucesoraId, lag: 0 });

interface Extras {
  alAbrir?: (id: number) => void;
  irAFecha?: (fecha: string) => void;
  hoy?: string;
  opciones?: Partial<OpcionesFilas>;
  feriados?: Map<string, string>;
  vacaciones?: Map<number, Tramo[]>;
  zoom?: Zoom;
  alternarGrupo?: (id: number) => void;
  alternarTerminadas?: (franja: string) => void;
  /** Con él las barras libres son editables; sin él la línea es de solo lectura. */
  cambios?: CambiosLinea;
}

/** Cambios simulados: lo justo para que las barras se vean editables. */
const CAMBIOS_FALSOS = { guardar: async () => null, guardando: () => false } as unknown as CambiosLinea;

function dibujar(tareas: Tarea[], dependencias: Dependencia[] = [], extras: Extras = {}) {
  const zoom = extras.zoom ?? 'mes';
  const ventana = zoom === 'mes' ? VENTANA : ventanaDesde('2026-10-12', zoom, 48 * 14);
  const filas = armarFilas(tareas, dependencias, CATALOGO, ventana, { ...OPCIONES, ...extras.opciones });
  return render(
    <LineaDeTiempo
      filas={filas} ventana={ventana} zoom={zoom} tareas={tareas} dependencias={dependencias} catalogo={CATALOGO} hoy={extras.hoy ?? HOY}
      alAbrir={extras.alAbrir ?? (() => {})} feriados={extras.feriados ?? new Map()} vacaciones={extras.vacaciones ?? new Map()} alternarGrupo={extras.alternarGrupo ?? (() => {})} alternarTerminadas={extras.alternarTerminadas ?? (() => {})} irAFecha={extras.irAFecha} cambios={extras.cambios}
    />,
  );
}

const boton = (id: number): HTMLElement => document.querySelector<HTMLElement>(`[data-tarea-id="${id}"]`)!;
const renglon = (id: number): HTMLElement => document.querySelector<HTMLElement>(`[data-renglon="${id}"]`)!;

describe('LineaDeTiempo', () => {
  it('dibuja un encabezado por proyecto, un renglón por tarea y la línea de hoy', () => {
    dibujar([
      tareaDe(1, { titulo: 'Relevamiento', proyectoId: 11, inicio: '2026-10-13', fin: '2026-10-19', estadoId: 12 }),
      tareaDe(2, { titulo: 'Cobranzas', proyectoId: 11, inicio: '2026-10-20', fin: '2026-11-03', estadoId: 7 }),
      tareaDe(3, { titulo: 'Migración', proyectoId: 12, inicio: '2026-10-21', fin: '2026-10-30' }),
      tareaDe(4, { titulo: 'Sin fechas', proyectoId: 12 }),
    ]);
    expect(screen.getByText('Portal de clientes')).toBeInTheDocument();
    expect(screen.getByText('Migración del ERP')).toBeInTheDocument();
    expect(screen.getByText('1 abierta')).toBeInTheDocument();
    expect(screen.getByText('1 abierta · 1 sin fechas')).toBeInTheDocument();
    expect(boton(1)).toHaveAttribute('aria-label', 'Relevamiento, Cerrado, del 13 oct al 19 oct');
    expect(boton(2)).toHaveAttribute('aria-label', 'Cobranzas, En curso, del 20 oct al 3 nov');
    expect(document.querySelectorAll('[data-tarea-id]')).toHaveLength(3);
    expect(screen.getByTestId('linea-hoy-rotulo')).toHaveTextContent('Hoy');
  });

  it('cada tarea es un renglón con su nombre a la izquierda y su barra a la derecha, sin título en la barra', () => {
    dibujar([tareaDe(1, { titulo: 'Cobranzas', inicio: '2026-10-20', fin: '2026-11-03', responsableId: 9 })]);
    const fila = renglon(1);
    const lista = fila.querySelector<HTMLElement>('.renglon__lista')!;
    const pista = fila.querySelector('.renglon__pista')!;
    expect(within(lista).getByRole('button', { name: 'Abrir «Cobranzas»' })).toHaveTextContent('Cobranzas');
    expect(pista.contains(boton(1))).toBe(true);
    expect(boton(1)).not.toHaveTextContent('Cobranzas');
  });

  it('no dibuja la línea de hoy si cae fuera de la ventana', () => {
    dibujar([tareaDe(1, { inicio: '2026-10-20', fin: '2026-10-22' })], [], { hoy: '2030-01-01' });
    expect(screen.queryByTestId('linea-hoy')).toBeNull();
  });

  it('el hito es un rombo sin nombre al costado', () => {
    dibujar([tareaDe(4, { titulo: 'Salida a producción', tipoId: 2, inicio: '2026-11-12', fin: '2026-11-12' })]);
    expect(boton(4).querySelector('[data-rombo]')).not.toBeNull();
    expect(within(boton(4)).queryByText('Salida a producción')).toBeNull();
    expect(within(renglon(4)).getByRole('button', { name: 'Abrir «Salida a producción»' })).toBeInTheDocument();
  });

  it('una dependencia en conflicto se dibuja roja y punteada y su sucesora muestra el signo de exclamación en la lista', () => {
    dibujar(
      [
        tareaDe(1, { titulo: 'Base', inicio: '2026-10-20', fin: '2026-10-30' }),
        tareaDe(2, { titulo: 'Se pisa', inicio: '2026-10-27', fin: '2026-11-04' }),
        tareaDe(3, { titulo: 'Bien', inicio: '2026-11-05', fin: '2026-11-10' }),
      ],
      [dep(1, 1, 2), dep(2, 1, 3)],
    );
    const rojas = document.querySelectorAll('path.flecha--conflicto');
    expect(rojas).toHaveLength(1);
    expect(rojas[0]).toHaveAttribute('stroke-dasharray', '5 4');
    expect(document.querySelectorAll('path.flecha')).toHaveLength(2);
    expect(document.querySelector('path.flecha:not(.flecha--conflicto)')).not.toHaveAttribute('stroke-dasharray');
    expect(within(renglon(2)).getByText('!')).toBeInTheDocument();
    expect(boton(2).getAttribute('aria-label')).toMatch(/, en conflicto$/);
    expect(within(renglon(3)).queryByText('!')).toBeNull();
  });

  it('el «!» es un botón con su texto y corre la tarea detrás de la anterior', async () => {
    const correrDetras = vi.fn(async () => undefined);
    dibujar(
      [
        tareaDe(1, { titulo: 'Base', inicio: '2026-10-20', fin: '2026-10-30' }),
        tareaDe(2, { titulo: 'Se pisa', inicio: '2026-10-27', fin: '2026-11-04' }),
      ],
      [dep(1, 1, 2)],
      { cambios: { ...CAMBIOS_FALSOS, correrDetras, ocupado: false } as unknown as CambiosLinea },
    );
    const alerta = within(renglon(2)).getByRole('button', { name: 'Empieza antes de que termine «Base». Clic para correrla detrás.' });
    expect(alerta).toHaveAttribute('title', 'Empieza antes de que termine «Base». Clic para correrla detrás.');
    await userEvent.setup().click(alerta);
    expect(correrDetras).toHaveBeenCalledWith(2);
  });

  it('al enfocar una barra se resalta su cadena y el panel dice a quién espera y a quién frena', () => {
    dibujar(
      [
        tareaDe(1, { titulo: 'Primera', inicio: '2026-10-13', fin: '2026-10-16', estadoId: 12 }),
        tareaDe(2, { titulo: 'Segunda', inicio: '2026-10-20', fin: '2026-10-23', responsableId: 9 }),
        tareaDe(3, { titulo: 'Tercera', inicio: '2026-10-26', fin: '2026-10-30' }),
        tareaDe(4, { titulo: 'Aparte', inicio: '2026-10-20', fin: '2026-10-22' }),
      ],
      [dep(1, 1, 2), dep(2, 2, 3)],
    );
    const panel = screen.getByTestId('info-cadena');
    expect(panel).toHaveTextContent('Pasá el mouse o el foco por una tarea para ver de qué depende y a quién frena.');
    expect(panel).toHaveAttribute('aria-live', 'polite');
    fireEvent.focus(boton(2));
    expect(boton(1)).toHaveAttribute('data-en-cadena', 'true');
    expect(boton(3)).toHaveAttribute('data-en-cadena', 'true');
    expect(boton(4)).toHaveAttribute('data-en-cadena', 'false');
    expect(document.querySelector('[data-foco="true"]')).not.toBeNull();
    expect(panel).toHaveTextContent('Segunda');
    expect(panel).toHaveTextContent('Ana Pereyra');
    expect(panel).toHaveTextContent('Nuevo');
    expect(panel).toHaveTextContent('Espera a: Primera (✓ ya está cerrada)');
    expect(panel).toHaveTextContent('Frena a: Tercera');
    expect(document.querySelectorAll('path.flecha--en-cadena')).toHaveLength(2);
    fireEvent.blur(boton(2));
    expect(document.querySelector('[data-foco="true"]')).toBeNull();
    expect(document.querySelectorAll('path.flecha--en-cadena')).toHaveLength(0);
    fireEvent.mouseEnter(boton(3));
    expect(panel).toHaveTextContent('Tercera');
    fireEvent.mouseLeave(boton(3));
    expect(panel).not.toHaveTextContent('Tercera');
  });

  it('una barra cortada a la derecha dice hasta cuándo sigue', () => {
    dibujar([tareaDe(1, { inicio: '2026-10-19', fin: '2027-02-20' })]);
    expect(within(boton(1)).getByText('sigue hasta 20 feb')).toBeInTheDocument();
  });

  it('Enter sobre una barra la abre, y un clic en el nombre o un doble clic en la barra también', async () => {
    const alAbrir = vi.fn();
    dibujar([tareaDe(7, { titulo: 'Siete', inicio: '2026-10-20', fin: '2026-10-22' })], [], { alAbrir });
    boton(7).focus();
    await userEvent.keyboard('{Enter}');
    expect(alAbrir).toHaveBeenCalledWith(7);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir «Siete»' }));
    expect(alAbrir).toHaveBeenCalledTimes(2);
    await userEvent.dblClick(boton(7));
    expect(alAbrir.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('LineaDeTiempo: horas, grupos y esperas', () => {
  it('«~5 h» va dentro de una barra ancha y al lado de una de un día', () => {
    dibujar([
      tareaDe(1, { inicio: '2026-10-20', fin: '2026-10-30', estimacionHoras: 5 }),
      tareaDe(2, { inicio: '2026-10-20', fin: '2026-10-20', estimacionHoras: 5 }),
    ]);
    expect(within(boton(1)).getByText('~5 h')).toBeInTheDocument();
    expect(within(boton(2)).queryByText('~5 h')).toBeNull();
    const afuera = renglon(2).querySelector<HTMLElement>('.barra__horas--afuera')!;
    expect(afuera).toHaveTextContent('~5 h');
    expect(parseFloat(afuera.style.left)).toBe(parseFloat(boton(2).style.left) + parseFloat(boton(2).style.width) + 10);
  });

  it('una cerrada muestra «✓ » delante del nombre y «3 h ✓» en la barra', () => {
    dibujar([tareaDe(1, { titulo: 'Hecha', estadoId: 12, inicio: '2026-10-13', fin: '2026-10-26', horasReales: 3, estimacionHoras: 8 })], [], { cambios: CAMBIOS_FALSOS });
    expect(within(renglon(1)).getByRole('button', { name: 'Abrir «Hecha»' })).toHaveTextContent('✓ Hecha');
    expect(within(boton(1)).getByText('3 h ✓')).toBeInTheDocument();
    expect(boton(1).querySelector('[data-gesto]')).toBeNull();
  });

  it('sin horas no se muestra nada', () => {
    dibujar([tareaDe(1, { inicio: '2026-10-20', fin: '2026-10-30' })]);
    expect(document.querySelector('.barra__horas')).toBeNull();
  });

  it('el grupo muestra su avance y, al plegarlo, sus hijas dejan de verse', async () => {
    const tareas = [
      tareaDe(10, { titulo: 'Madre', inicio: '2026-10-19', fin: '2026-10-30' }),
      tareaDe(11, { titulo: 'Hija uno', madreId: 10, estadoId: 12, inicio: '2026-10-19', fin: '2026-10-21' }),
      tareaDe(12, { titulo: 'Hija dos', madreId: 10, inicio: '2026-10-22', fin: '2026-10-30' }),
    ];
    const alternarGrupo = vi.fn();
    const { unmount } = dibujar(tareas, [], { alternarGrupo });
    expect(within(renglon(10)).getByText('1/2')).toBeInTheDocument();
    expect(renglon(11)).not.toBeNull();
    const plegar = within(renglon(10)).getByRole('button', { name: 'Plegar «Madre»' });
    expect(plegar).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(plegar);
    expect(alternarGrupo).toHaveBeenCalledWith(10);
    unmount();
    dibujar(tareas, [], { opciones: { plegados: new Set([10]) } });
    expect(within(renglon(10)).getByRole('button', { name: 'Desplegar «Madre»' })).toHaveAttribute('aria-expanded', 'false');
    expect(renglon(11)).toBeNull();
    expect(renglon(12)).toBeNull();
  });

  it('una madre automática lleva una barra de resumen con el avance relleno', () => {
    dibujar([
      tareaDe(1, { inicio: '2026-10-20', fin: '2026-10-30', programacionManual: false }),
      tareaDe(2, { madreId: 1, estadoId: 12, inicio: '2026-10-20', fin: '2026-10-22' }),
      tareaDe(3, { inicio: '2026-10-20', fin: '2026-10-30', programacionManual: true }),
      tareaDe(4, { madreId: 3, inicio: '2026-10-20', fin: '2026-10-22' }),
    ]);
    expect(boton(1)).toHaveClass('barra--resumen');
    expect(boton(1).querySelector('.barra__relleno')).toHaveStyle({ width: '100%' });
    expect(boton(3)).not.toHaveClass('barra--resumen');
  });

  it('una tarea con predecesora lleva la descripción de que va sola detrás y no se puede arrastrar', () => {
    dibujar(
      [
        tareaDe(1, { titulo: 'Primera', inicio: '2026-10-13', fin: '2026-10-16', estadoId: 12 }),
        tareaDe(2, { titulo: 'Segunda', inicio: '2026-10-20', fin: '2026-10-23' }),
        tareaDe(3, { titulo: 'Libre', inicio: '2026-10-20', fin: '2026-10-30' }),
      ],
      [dep(1, 1, 2)],
      { cambios: CAMBIOS_FALSOS },
    );
    expect(boton(2)).toHaveAttribute('aria-description', 'Va sola detrás de «Primera»');
    expect(boton(2)).toHaveAttribute('title', 'Va sola detrás de «Primera»');
    expect(boton(2).querySelector('svg')).not.toBeNull();
    expect(boton(2).querySelector('[data-gesto]')).toBeNull();
    expect(boton(1)).not.toHaveAttribute('aria-description');
    expect(boton(3)).not.toHaveAttribute('aria-description');
    // Control positivo: una abierta y libre sí se puede arrastrar.
    expect(boton(3).querySelector('[data-gesto]')).not.toBeNull();
  });
});

describe('LineaDeTiempo: edición', () => {
  it('en Por persona una madre automática no se arrastra, y sus hijas sí', () => {
    dibujar(
      [
        tareaDe(1, { titulo: 'Madre', responsableId: 9, inicio: '2026-10-20', fin: '2026-10-30', programacionManual: false }),
        tareaDe(2, { titulo: 'Hija', responsableId: 9, madreId: 1, inicio: '2026-10-20', fin: '2026-10-30', programacionManual: false }),
      ],
      [],
      { opciones: { vista: 'persona' }, cambios: CAMBIOS_FALSOS },
    );
    expect(boton(1).querySelector('[data-gesto]')).toBeNull();
    expect(boton(2).querySelector('[data-gesto]')).not.toBeNull();
  });

  it('sin edición no se dibuja el asa de ordenar, ni en tareas ni en grupos', () => {
    dibujar([
      tareaDe(1, { titulo: 'Madre', inicio: '2026-10-20', fin: '2026-10-30' }),
      tareaDe(2, { titulo: 'Hija', madreId: 1, inicio: '2026-10-20', fin: '2026-10-30' }),
      tareaDe(3, { titulo: 'Suelta', inicio: '2026-10-20', fin: '2026-10-30' }),
    ]);
    expect(document.querySelectorAll('.renglon__orden')).toHaveLength(0);
  });
});

describe('LineaDeTiempo: feriados y vacaciones', () => {
  it('el feriado tiñe la columna del día y el encabezado de Semana lo dice', () => {
    dibujar([tareaDe(1, { inicio: '2026-10-13', fin: '2026-10-16' })], [], { zoom: 'semana', feriados: new Map([['2026-10-12', 'Diversidad Cultural']]) });
    expect(document.querySelector('.linea__feriado')).toHaveAttribute('title', 'Diversidad Cultural');
    expect(document.querySelector('.linea__marca[title="Diversidad Cultural"]')).toHaveTextContent('Feriado');
    expect(document.querySelectorAll('.linea__marca-feriado')).toHaveLength(1);
  });

  it('sábados y domingos van sombreados (sin pisar el feriado) y la leyenda lo dice; en Trimestre no', () => {
    // Semana de 14 días desde el lunes 12: sábados y domingos 17, 18, 24 y 25.
    dibujar([tareaDe(1, { inicio: '2026-10-13', fin: '2026-10-16' })], [], { zoom: 'semana', feriados: new Map([['2026-10-12', 'Diversidad Cultural']]) });
    const columnas = [...document.querySelectorAll<HTMLElement>('.linea__no-laborable')].map((c) => c.style.left);
    expect(columnas).toEqual([5, 6, 12, 13].map((d) => `${ANCHO_LISTA + d * 48}px`));
    expect(screen.getByText('Fin de semana')).toBeInTheDocument();
    cleanup();
    dibujar([tareaDe(1, { inicio: '2026-10-13', fin: '2026-10-16' })], [], { zoom: 'trimestre' });
    expect(document.querySelector('.linea__no-laborable')).toBeNull();
    expect(screen.queryByText('Fin de semana')).toBeNull();
  });

  it('las vacaciones van rayadas en las tareas abiertas de esa persona y el aviso solo en la que cae adentro', () => {
    dibujar(
      [
        tareaDe(1, { titulo: 'Pisada', responsableId: 9, inicio: '2026-10-20', fin: '2026-10-30' }),
        tareaDe(2, { titulo: 'Después', responsableId: 9, inicio: '2026-11-09', fin: '2026-11-13' }),
        tareaDe(3, { titulo: 'De otro', responsableId: 5, inicio: '2026-10-20', fin: '2026-10-30' }),
      ],
      [],
      { vacaciones: new Map([[9, [{ desde: '2026-10-26', hasta: '2026-10-28' }]]]) },
    );
    expect(renglon(1).querySelectorAll('.renglon__vacaciones')).toHaveLength(1);
    expect(renglon(2).querySelectorAll('.renglon__vacaciones')).toHaveLength(1);
    expect(renglon(3).querySelectorAll('.renglon__vacaciones')).toHaveLength(0);
    expect(within(renglon(1)).getByText('⚠')).toHaveAttribute('title', 'Ana está de vacaciones del 26/10 al 28/10');
    expect(within(renglon(2)).queryByText('⚠')).toBeNull();
    const raya = renglon(1).querySelector<HTMLElement>('.renglon__vacaciones')!;
    expect(parseFloat(raya.style.left)).toBe(14 * 16);
    expect(parseFloat(raya.style.width)).toBe(3 * 16);
  });

  it('en Por persona el encabezado de la persona lleva sus rayas', () => {
    dibujar(
      [tareaDe(1, { responsableId: 9, inicio: '2026-10-20', fin: '2026-10-30' })],
      [],
      { opciones: { vista: 'persona' }, vacaciones: new Map([[9, [{ desde: '2026-10-26', hasta: '2026-10-28' }]]]) },
    );
    expect(document.querySelector('.renglon--encabezado')!.querySelectorAll('.renglon__vacaciones')).toHaveLength(1);
    // Una sola vez, en el renglón de la persona: los de sus tareas no repiten las rayas.
    expect(renglon(1).querySelectorAll('.renglon__vacaciones')).toHaveLength(0);
    expect(document.querySelectorAll('.renglon__vacaciones')).toHaveLength(1);
  });
});

describe('LineaDeTiempo: ajustes vistos en el navegador', () => {
  it('el rótulo Hoy no se superpone con el texto de las marcas', () => {
    dibujar([tareaDe(1, { inicio: '2026-10-20', fin: '2026-10-22' })]);
    const rotulo = screen.getByTestId('linea-hoy-rotulo');
    const encabezado = document.querySelector('.linea__encabezado')!;
    expect(encabezado.contains(rotulo)).toBe(false);
    expect(encabezado.textContent).not.toContain('Hoy');
    // Va en su propio renglón, antes del encabezado de fechas.
    expect(rotulo.parentElement!.compareDocumentPosition(encabezado) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('linea-hoy')).toHaveTextContent('');
  });

  it('una barra de un día nunca baja de 10 px y no lleva nada adentro', () => {
    dibujar([tareaDe(1, { titulo: 'Un día', inicio: '2026-10-20', fin: '2026-10-20', responsableId: 9 })]);
    expect(parseFloat(boton(1).style.width)).toBe(16);
    expect(boton(1).children).toHaveLength(0);
  });

  it('por persona las tareas no llevan el punto del proyecto', () => {
    const tareas = [tareaDe(1, { inicio: '2026-10-20', fin: '2026-10-30' }), tareaDe(2, { responsableId: 9, inicio: '2026-10-20', fin: '2026-10-30' })];
    dibujar(tareas, [], { opciones: { vista: 'persona' } });
    expect(document.querySelector('.renglon__punto')).toBeNull();
    expect(renglon(2).querySelector('.renglon__lista [role="img"], .renglon__lista .avatar')).toBeNull();
    cleanup();
    dibujar(tareas);
    expect(renglon(2).querySelector('.renglon__punto')).toBeNull();
  });

  it('solo las tareas con contenedor llevan el ⠿ para ordenar', () => {
    const tareas = [tareaDe(1, { titulo: 'Una', inicio: '2026-10-20', fin: '2026-10-30' })];
    dibujar(tareas, [], { cambios: CAMBIOS_FALSOS });
    expect(screen.getByRole('button', { name: 'Ordenar «Una»' })).toBeInTheDocument();
    cleanup();
    dibujar(tareas, [], { opciones: { vista: 'todas' }, cambios: CAMBIOS_FALSOS });
    expect(screen.queryByRole('button', { name: 'Ordenar «Una»' })).toBeNull();
  });

  it('por persona tampoco las summary tasks llevan el ⠿', () => {
    const tareas = [
      tareaDe(1, { titulo: 'Madre', responsableId: 9, inicio: '2026-10-20', fin: '2026-10-30' }),
      tareaDe(2, { titulo: 'Hija', responsableId: 9, madreId: 1, inicio: '2026-10-21', fin: '2026-10-22' }),
    ];
    dibujar(tareas, [], { cambios: CAMBIOS_FALSOS });
    expect(screen.getByRole('button', { name: 'Ordenar «Madre»' })).toBeInTheDocument();
    cleanup();
    dibujar(tareas, [], { opciones: { vista: 'persona' }, cambios: CAMBIOS_FALSOS });
    expect(screen.queryByRole('button', { name: 'Ordenar «Madre»' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ordenar «Hija»' })).toBeNull();
  });

  it('el panel de la cadena queda fijo al pie', () => {
    dibujar([tareaDe(1, { inicio: '2026-10-20', fin: '2026-10-22' })]);
    expect(screen.getByTestId('info-cadena')).toHaveClass('linea__info--fijo');
  });
});

describe('LineaDeTiempo: lista legible', () => {
  const TAREAS_9 = [
    tareaDe(1, { titulo: 'Una', proyectoId: 11, responsableId: 9, inicio: '2026-10-20', fin: '2026-10-30' }),
    tareaDe(2, { titulo: 'Dos', proyectoId: 11, responsableId: 9, inicio: '2026-10-21', fin: '2026-10-30' }),
  ];

  it('la franja de quien mira dice «vos» y las abiertas', () => {
    dibujar(TAREAS_9, [], { opciones: { vista: 'persona', yoId: 9 } });
    const franja = document.querySelector<HTMLElement>('.renglon--encabezado')!;
    expect(within(franja).getByText('vos')).toBeInTheDocument();
    expect(within(franja).getByText('2 abiertas')).toBeInTheDocument();
  });

  it('el renglón del proyecto lleva el nombre y su tono', () => {
    dibujar(TAREAS_9, [], { opciones: { vista: 'persona' } });
    const fila = screen.getByText('Portal de clientes').closest<HTMLElement>('.renglon--proyecto')!;
    expect(fila.getAttribute('style')).toMatch(/--tono-fila: var\(--tono-[a-z]+\)/);
  });

  it('terminadas: mostrar llama a alternar con la franja', async () => {
    const alternar = vi.fn();
    const cerrada = tareaDe(3, { titulo: 'Vieja', proyectoId: 11, responsableId: 9, inicio: '2026-10-14', fin: '2026-10-16', estadoId: 12 });
    const props = { opciones: { vista: 'persona' as const, terminadasVisibles: new Set<string>() }, alternarTerminadas: alternar };
    dibujar([...TAREAS_9, cerrada], [], props);
    const mostrar = screen.getByRole('button', { name: /mostrar/ });
    expect(mostrar).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/1 terminada/)).toBeInTheDocument();
    await userEvent.click(mostrar);
    expect(alternar).toHaveBeenCalledWith('persona-9');
    cleanup();
    dibujar([...TAREAS_9, cerrada], [], { ...props, opciones: { vista: 'persona', terminadasVisibles: new Set(['persona-9']) } });
    const ocultar = screen.getByRole('button', { name: /ocultar/ });
    expect(ocultar).toHaveAttribute('aria-expanded', 'true');
  });

  it('terminadas fuera de la ventana: cuentan, y a la vista llevan una marca en el borde que lleva la línea hasta ellas', async () => {
    const irA = vi.fn();
    const vieja = tareaDe(3, { titulo: 'Vieja', proyectoId: 11, responsableId: 9, inicio: '2026-09-07', fin: '2026-09-18', estadoId: 12 });
    const futura = tareaDe(4, { titulo: 'Futura', proyectoId: 11, responsableId: 9, inicio: '2027-02-01', fin: '2027-02-05', estadoId: 12 });
    dibujar([...TAREAS_9, vieja, futura], [], { opciones: { vista: 'persona', terminadasVisibles: new Set<string>() }, irAFecha: irA });
    expect(screen.getByText('2 terminadas')).toBeInTheDocument();
    expect(screen.queryByText(/terminó el/)).toBeNull();
    cleanup();
    dibujar([...TAREAS_9, vieja, futura], [], { opciones: { vista: 'persona' }, irAFecha: irA });
    // Las abiertas siguen ahí, con su barra; las de fuera no tienen barra.
    expect(boton(1)).not.toBeNull();
    expect(boton(3)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '◂ terminó el 18 sept' }));
    expect(irA).toHaveBeenCalledWith('2026-09-18');
    await userEvent.click(screen.getByRole('button', { name: 'empieza el 1 feb ▸' }));
    expect(irA).toHaveBeenLastCalledWith('2027-02-01');
  });

  it('grupo ajeno: título apagado y la cara de quien lo tiene', () => {
    const tareas = [
      tareaDe(87, { titulo: 'Madre', proyectoId: 11, responsableId: 5, inicio: '2026-10-20', fin: '2026-10-30', programacionManual: true }),
      tareaDe(88, { titulo: 'Hija', proyectoId: 11, responsableId: 9, madreId: 87, inicio: '2026-10-21', fin: '2026-10-30' }),
    ];
    dibujar(tareas, [], { opciones: { vista: 'persona' } });
    const franja = renglon(87);
    expect(franja).toHaveClass('renglon--ajeno');
    expect(within(franja).getByLabelText('Martín Gómez')).toBeInTheDocument();
    cleanup();
    dibujar([{ ...tareas[0]!, responsableId: null }, tareas[1]!], [], { opciones: { vista: 'persona' } });
    expect(within(renglon(87)).getByLabelText('Sin asignar')).toBeInTheDocument();
  });

  it('el nombre de la tarea muestra el título completo al pasar el mouse', () => {
    dibujar([tareaDe(1, { titulo: 'Un título bien largo', responsableId: 9, inicio: '2026-10-20', fin: '2026-10-30' })]);
    expect(renglon(1).querySelector('.renglon__nombre')).toHaveAttribute('title', 'Un título bien largo');
  });
});
