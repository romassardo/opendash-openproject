import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { gsap } from 'gsap';
import { Anillos } from './Anillos.js';
import { AnilloAvance } from './AnilloAvance.js';
import { Barras } from './Barras.js';
import { BarraCarga } from './BarraCarga.js';
import { Dona } from './Dona.js';
import { LineaRitmo } from './LineaRitmo.js';

afterEach(cleanup);

describe('Anillos', () => {
  it('un anillo vivo no relanza la entrada con cada tic del reloj', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as typeof window.matchMedia;
    const espia = vi.spyOn(gsap, 'fromTo');
    try {
      const dibujar = (horas: number) => (
        <Anillos anillos={[{ valor: 1, total: 8, tono: 'rosa', etiqueta: 'T' }, { valor: horas, total: 8, tono: 'hoy-horas', etiqueta: 'H', unidad: 'h', vivo: true }]} />
      );
      const { rerender } = render(dibujar(1));
      const alMontar = espia.mock.calls.length;
      expect(alMontar).toBeGreaterThan(0);
      rerender(dibujar(1.01));
      rerender(dibujar(1.02));
      expect(espia.mock.calls.length).toBe(alMontar);
    } finally {
      espia.mockRestore();
      window.matchMedia = original;
    }
  });

  it('resume cada anillo en su nombre accesible', () => {
    render(
      <Anillos
        anillos={[
          { valor: 2, total: 8, tono: 'rosa', etiqueta: 'Tareas' },
          { valor: 1.1, total: 2, tono: 'verde', etiqueta: 'Foco', unidad: 'h' },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Tareas: 2 de 8. Foco: 1,1 de 2 h.' })).toBeInTheDocument();
  });

  it('el primero va afuera y el trazo se topa en una vuelta completa', () => {
    const { container } = render(
      <Anillos anillos={[{ valor: 20, total: 8, tono: 'rosa', etiqueta: 'A' }, { valor: 1, total: 2, tono: 'verde', etiqueta: 'B' }]} />,
    );
    const pistas = Array.from(container.querySelectorAll('circle')).map((c) => Number(c.getAttribute('r')));
    expect(pistas).toEqual([56, 41]);
    const arcos = container.querySelectorAll('path[data-trazo]');
    expect(arcos).toHaveLength(2);
    // El que pasó la meta se dibuja entero (un pelo menos de 360°), no se desborda.
    expect(arcos[0]!.getAttribute('d')).toContain('A 56 56 0 1 1');
  });

  it('un anillo sin avance dibuja solo la pista', () => {
    const { container } = render(<Anillos anillos={[{ valor: 0, total: 8, tono: 'rosa', etiqueta: 'A' }]} />);
    expect(container.querySelectorAll('path[data-trazo]')).toHaveLength(0);
  });

  it('los colores de «Hoy» usan sus propias variables', () => {
    const { container } = render(<Anillos anillos={[{ valor: 1, total: 2, tono: 'hoy-tareas', etiqueta: 'A' }, { valor: 1, total: 2, tono: 'azul', etiqueta: 'B' }]} />);
    const grupos = container.querySelectorAll<SVGGElement>('g');
    expect(grupos[0]?.style.color).toBe('var(--hoy-tareas)');
    expect(grupos[1]?.style.color).toBe('var(--tono-azul)');
  });
});

describe('AnilloAvance', () => {
  it('muestra el porcentaje en el centro', () => {
    render(<AnilloAvance porcentaje={45} tono="violeta" />);
    expect(screen.getByText('45 %')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Avance: 45 %' })).toBeInTheDocument();
  });
  it('limita el porcentaje a 0-100', () => {
    render(<AnilloAvance porcentaje={140} tono="azul" />);
    expect(screen.getByText('100 %')).toBeInTheDocument();
  });
});

describe('Dona', () => {
  const segmentos = [
    { valor: 5, tono: 'azul' as const, etiqueta: 'Portal' },
    { valor: 3, tono: 'rosa' as const, etiqueta: 'Turnero' },
  ];
  it('muestra total y leyenda en el centro y resume los tramos', () => {
    render(<Dona segmentos={segmentos} total={8} leyenda="tareas" />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('tareas')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '8 tareas: Portal 5, Turnero 3.' })).toBeInTheDocument();
  });
  it('con total 0 dibuja solo la pista', () => {
    const { container } = render(<Dona segmentos={[]} total={0} leyenda="tareas" />);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelectorAll('path')).toHaveLength(0);
  });
  it('deja un hueco entre un tramo y el siguiente', () => {
    const { container } = render(<Dona segmentos={segmentos} total={8} leyenda="tareas" />);
    const tramos = container.querySelectorAll('path[data-trazo]');
    expect(tramos).toHaveLength(2);
    expect(tramos[0]!.getAttribute('d')).not.toBe(tramos[1]!.getAttribute('d'));
  });
});

describe('LineaRitmo', () => {
  const puntos = [
    { fecha: '2026-10-17', actual: 3, anterior: 2 },
    { fecha: '2026-10-18', actual: 5, anterior: 4 },
    { fecha: '2026-10-19', actual: 0, anterior: 1 },
  ];
  const formatoFecha = (f: string) => `día ${f.slice(-2)}`;
  const props = { puntos, etiquetaActual: 'Esta semana', etiquetaAnterior: 'Semana anterior', formatoFecha };

  it('muestra el globo con la fecha y los dos valores al enfocar un día', () => {
    render(<LineaRitmo {...props} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => screen.getByLabelText('día 18: Esta semana 5, Semana anterior 4').focus());
    const globo = screen.getByRole('tooltip');
    expect(globo).toHaveTextContent('día 18');
    expect(globo).toHaveTextContent('Esta semana');
    expect(globo).toHaveTextContent('5');
    expect(globo).toHaveTextContent('Semana anterior');
    expect(globo).toHaveTextContent('4');
  });

  it('el globo también sale con el mouse y se va al salir', () => {
    render(<LineaRitmo {...props} />);
    const dia = screen.getByLabelText('día 17: Esta semana 3, Semana anterior 2');
    fireEvent.mouseEnter(dia);
    expect(screen.getByRole('tooltip')).toHaveTextContent('día 17');
    fireEvent.mouseLeave(dia);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('espacia los rótulos de fecha cuando hay muchos días', () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ fecha: `2026-09-${String(i + 1).padStart(2, '0')}`, actual: i, anterior: i }));
    const { container } = render(<LineaRitmo {...props} puntos={muchos} />);
    const rotulos = container.querySelectorAll('text[data-eje="x"]');
    expect(rotulos.length).toBeGreaterThan(0);
    expect(rotulos.length).toBeLessThan(30);
  });

  it.each([
    [1, ['0', '1']],
    [2, ['0', '1', '2']],
    [5, ['0', '1', '2', '3', '4', '5']],
    [8, ['0', '5', '10']],
  ])('el eje Y con máximo %i solo tiene marcas enteras', (maximo, esperado) => {
    const unico = [{ fecha: '2026-10-19', actual: maximo, anterior: 0 }];
    const { container } = render(<LineaRitmo {...props} puntos={unico} />);
    const marcas = Array.from(container.querySelectorAll('text[data-eje="y"]')).map((t) => t.textContent);
    expect(marcas).toEqual(esperado);
  });

  it('con datos vacíos no rompe', () => {
    render(<LineaRitmo {...props} puntos={[]} />);
    expect(screen.getByRole('group')).toBeInTheDocument();
  });
});

describe('Barras', () => {
  it('resume las barras con el formato dado', () => {
    render(<Barras barras={[{ etiqueta: 'Lun', valor: 1.5 }, { etiqueta: 'Mar', valor: 0 }]} formato={(v) => `${v} h`} />);
    expect(screen.getByRole('img', { name: 'Lun: 1.5 h. Mar: 0 h.' })).toBeInTheDocument();
  });
  it('destaca la última', () => {
    const { container } = render(<Barras barras={[{ etiqueta: 'a', valor: 1 }, { etiqueta: 'b', valor: 2 }]} formato={String} destacarUltima />);
    const rellenos = container.querySelectorAll('[data-barra]');
    expect(rellenos[0]).not.toHaveAttribute('data-destacada');
    expect(rellenos[1]).toHaveAttribute('data-destacada', 'true');
  });
  it('destaca la barra del índice dado y atenúa las demás', () => {
    const { container } = render(<Barras barras={[{ etiqueta: 'a', valor: 1 }, { etiqueta: 'b', valor: 2 }, { etiqueta: 'c', valor: 3 }]} formato={String} destacar={0} />);
    const rellenos = container.querySelectorAll('[data-barra]');
    expect(rellenos[0]).toHaveAttribute('data-destacada', 'true');
    expect(rellenos[1]).not.toHaveAttribute('data-destacada');
    expect(container.querySelectorAll('.grafico-barra[data-atenuada="true"]')).toHaveLength(2);
  });
});

describe('BarraCarga', () => {
  it('sin exceso no marca el tramo de más', () => {
    const { container } = render(<BarraCarga horas={20} capacidad={40} />);
    expect(container.querySelector('.barra-carga__exceso')).toBeNull();
    expect(screen.getByRole('meter', { name: '20 h de 40 h' })).toBeInTheDocument();
  });
  it('marca el exceso cuando las horas pasan la capacidad', () => {
    const { container } = render(<BarraCarga horas={44} capacidad={40} />);
    expect(container.querySelector('.barra-carga__exceso')).not.toBeNull();
    expect(screen.getByRole('meter', { name: '44 h de 40 h, excedida' })).toBeInTheDocument();
  });
});

describe('animación de entrada', () => {
  const anillos = [{ valor: 2, total: 8, tono: 'rosa' as const, etiqueta: 'Tareas' }];

  afterEach(() => vi.unstubAllGlobals());

  it('arranca con el trazo oculto y las barras sin crecer', () => {
    const { container } = render(<><Anillos anillos={anillos} /><Barras barras={[{ etiqueta: 'a', valor: 2 }]} formato={String} /></>);
    expect((container.querySelector('[data-trazo]') as SVGElement).style.strokeDashoffset).toBe('1');
    expect((container.querySelector('[data-barra]') as SVGElement).style.transform).toContain('scale');
  });

  it('con movimiento reducido muestra el estado final sin tocar nada', () => {
    vi.stubGlobal('matchMedia', (consulta: string) => ({ matches: consulta.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    const { container } = render(<><Anillos anillos={anillos} /><Barras barras={[{ etiqueta: 'a', valor: 2 }]} formato={String} /></>);
    expect((container.querySelector('[data-trazo]') as SVGElement).getAttribute('style')).toBeNull();
    expect((container.querySelector('[data-barra]') as SVGElement).getAttribute('style')).toBeNull();
  });

  it('re-renderizar con los mismos datos en arrays nuevos no reinicia la animación', () => {
    const { container, rerender } = render(<Anillos anillos={[{ valor: 2, total: 8, tono: 'rosa' as const, etiqueta: 'Tareas' }]} />);
    const trazo = container.querySelector('[data-trazo]') as SVGElement;
    expect(trazo.style.strokeDashoffset).toBe('1');
    trazo.style.strokeDashoffset = '0';
    rerender(<Anillos anillos={[{ valor: 2, total: 8, tono: 'rosa' as const, etiqueta: 'Tareas' }]} />);
    expect((container.querySelector('[data-trazo]') as SVGElement).style.strokeDashoffset).toBe('0');
    rerender(<Anillos anillos={[{ valor: 5, total: 8, tono: 'rosa' as const, etiqueta: 'Tareas' }]} />);
    expect((container.querySelector('[data-trazo]') as SVGElement).style.strokeDashoffset).toBe('1');
  });
});
