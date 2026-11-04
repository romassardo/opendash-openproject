import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { Avatar } from './Avatar.js';
import { Aviso } from './Aviso.js';
import { BarraProgreso } from './BarraProgreso.js';
import { Boton } from './Boton.js';
import { Contador } from './Contador.js';
import { Estrella } from './Estrella.js';
import { Interruptor } from './Interruptor.js';
import { Pildora } from './Pildora.js';
import { Segmentado } from './Segmentado.js';
import { Variacion } from './Variacion.js';
import { Vidrio } from './Vidrio.js';

afterEach(cleanup);

const ana = { id: 1, nombre: 'Ana Pereyra', login: null, email: null, avatarUrl: null };

describe('Avatar', () => {
  it('Avatar muestra iniciales sin foto y ? sin persona', () => {
    render(<><Avatar persona={ana} /><Avatar persona={null} /></>);
    expect(screen.getByText('AP')).toBeInTheDocument();
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('usa la foto cuando hay avatarUrl y la nombra', () => {
    render(<Avatar persona={{ ...ana, avatarUrl: '/api/avatar/1' }} tamano={48} />);
    const foto = screen.getByRole('img', { name: 'Ana Pereyra' });
    expect(foto).toHaveAttribute('src', '/api/avatar/1');
    expect(foto).toHaveStyle({ width: '48px', height: '48px' });
  });

  it('anuncia «conectado» cuando está en línea', () => {
    render(<Avatar persona={ana} enLinea />);
    expect(screen.getByRole('img', { name: 'Ana Pereyra, conectado' })).toBeInTheDocument();
  });

  it('el avatar trabajando lo dice en su nombre accesible', () => {
    render(<Avatar persona={ana} presencia="trabajando" />);
    expect(screen.getByRole('img', { name: 'Ana Pereyra, trabajando' })).toBeInTheDocument();
  });

  it('cada presencia suma su aviso al nombre y su estado al punto', () => {
    const { container } = render(
      <>
        <Avatar persona={{ ...ana, id: 1 }} presencia="conectado" />
        <Avatar persona={{ ...ana, id: 2, nombre: 'Martín Gómez' }} presencia="ausente" />
        <Avatar persona={{ ...ana, id: 3, nombre: 'Lucía Fernández' }} presencia="sin-opendash" />
        <Avatar persona={{ ...ana, id: 4, nombre: 'Daniel Ruiz' }} />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Ana Pereyra, conectado' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Martín Gómez, ausente' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Lucía Fernández, sin OpenDash' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Daniel Ruiz' })).toBeInTheDocument();
    const puntos = [...container.querySelectorAll('.avatar__presencia')].map((p) => p.getAttribute('data-presencia'));
    expect(puntos).toEqual(['conectado', 'ausente', 'sin-opendash']);
  });

  it('presencia manda sobre enLinea', () => {
    render(<Avatar persona={ana} enLinea presencia="trabajando" />);
    expect(screen.getByRole('img', { name: 'Ana Pereyra, trabajando' })).toBeInTheDocument();
  });

  it('si la foto no carga muestra las iniciales', () => {
    render(<Avatar persona={{ ...ana, avatarUrl: '/api/personas/1/avatar' }} />);
    fireEvent.error(screen.getByRole('img', { name: 'Ana Pereyra' }));
    expect(screen.getByText('AP')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('una sola palabra da una sola inicial', () => {
    render(<Avatar persona={{ ...ana, nombre: 'ramiro' }} />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });
});

describe('Segmentado', () => {
  const opciones = [{ valor: 'tablero', etiqueta: 'Tablero' }, { valor: 'lista', etiqueta: 'Lista' }] as const;

  it('Segmentado marca la opción activa y avisa el cambio', async () => {
    const onCambio = vi.fn();
    render(<Segmentado opciones={[{ valor: 'tablero', etiqueta: 'Tablero' }, { valor: 'lista', etiqueta: 'Lista' }]} valor="tablero" onCambio={onCambio} />);
    expect(screen.getByRole('radio', { name: 'Tablero' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Lista' }));
    expect(onCambio).toHaveBeenCalledWith('lista');
  });

  it('es un radiogroup con foco itinerante y se mueve con las flechas', async () => {
    function Envoltura() {
      const [valor, setValor] = useState<'tablero' | 'lista'>('tablero');
      return <Segmentado etiqueta="Vista" opciones={[...opciones]} valor={valor} onCambio={setValor} />;
    }
    render(<Envoltura />);
    expect(screen.getByRole('radiogroup', { name: 'Vista' })).toBeInTheDocument();
    const tablero = screen.getByRole('radio', { name: 'Tablero' });
    const lista = screen.getByRole('radio', { name: 'Lista' });
    expect(tablero).toHaveAttribute('tabindex', '0');
    expect(lista).toHaveAttribute('tabindex', '-1');
    await userEvent.tab();
    expect(tablero).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(lista).toBeChecked();
    expect(lista).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tablero).toBeChecked();
    await userEvent.keyboard('{ArrowLeft}');
    expect(lista).toBeChecked();
  });

  it('con un valor fuera de las opciones no marca ninguna y la primera sigue alcanzable', async () => {
    const onCambio = vi.fn();
    const { container } = render(<Segmentado<string> opciones={[...opciones]} valor="otra" onCambio={onCambio} />);
    const [tablero, lista] = screen.getAllByRole('radio');
    expect(tablero).toHaveAttribute('aria-checked', 'false');
    expect(lista).toHaveAttribute('aria-checked', 'false');
    expect(tablero).toHaveAttribute('tabindex', '0');
    expect(lista).toHaveAttribute('tabindex', '-1');
    expect(container.querySelector('.segmentado__lente')).toBeNull();
    await userEvent.tab();
    expect(tablero).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onCambio).toHaveBeenCalledWith('lista');
  });
});

describe('Contador', () => {
  it('Contador muestra valor y total', () => {
    render(<Contador etiqueta="Hechas hoy" valor={2} total={8} />);
    expect(screen.getByText('/ 8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Hechas hoy')).toBeInTheDocument();
  });

  it('sin total no muestra la barra', () => {
    render(<Contador etiqueta="Vencidas" valor={0} />);
    expect(screen.queryByText(/^\//)).not.toBeInTheDocument();
  });

  it('muestra la variación al lado del valor', () => {
    render(<Contador etiqueta="Completadas" valor={18} variacion={<Variacion valor={22} unidad="%" />} />);
    expect(screen.getByText('+22 %')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
  });
});

describe('Estrella', () => {
  it('la estrella mantiene su nombre y expone el estado con aria-pressed', async () => {
    const onCambio = vi.fn();
    const { rerender } = render(<Estrella activa={false} nombre="Portal de clientes" onCambio={onCambio} />);
    const boton = screen.getByRole('button', { name: 'Fijar Portal de clientes' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(boton);
    expect(onCambio).toHaveBeenCalledWith(true);

    rerender(<Estrella activa nombre="Portal de clientes" onCambio={onCambio} />);
    const fijada = screen.getByRole('button', { name: 'Fijar Portal de clientes' });
    expect(fijada).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(fijada);
    expect(onCambio).toHaveBeenLastCalledWith(false);
  });
});

describe('BarraProgreso', () => {
  it('la barra de progreso informa valor y máximo', () => {
    render(<BarraProgreso valor={3} maximo={8} etiqueta="Avance de Portal de clientes" />);
    const barra = screen.getByRole('progressbar', { name: 'Avance de Portal de clientes' });
    expect(barra).toHaveAttribute('aria-valuenow', '3');
    expect(barra).toHaveAttribute('aria-valuemin', '0');
    expect(barra).toHaveAttribute('aria-valuemax', '8');
  });

  it('el relleno es la fracción y no pasa del total aunque el valor lo supere', () => {
    const { container, rerender } = render(<BarraProgreso valor={2} maximo={8} etiqueta="Avance" />);
    expect(container.querySelector('.barra-progreso__relleno')).toHaveStyle({ transform: 'scaleX(0.25)' });
    rerender(<BarraProgreso valor={12} maximo={8} etiqueta="Avance" excedida />);
    expect(container.querySelector('.barra-progreso__relleno')).toHaveStyle({ transform: 'scaleX(1)' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '8');
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-excedida', 'true');
  });

  it('con máximo cero queda vacía en vez de dividir por cero', () => {
    const { container } = render(<BarraProgreso valor={0} maximo={0} etiqueta="Carga" />);
    expect(container.querySelector('.barra-progreso__relleno')).toHaveStyle({ transform: 'scaleX(0)' });
  });
});

describe('Variacion', () => {
  it('Variacion muestra — sin dato y el signo menos tipográfico', () => {
    render(
      <>
        <Variacion valor={null} unidad="%" />
        <Variacion valor={-3} unidad="pts" />
        <Variacion valor={22} unidad="%" />
        <Variacion valor={0.4} unidad="d" />
        <Variacion valor={-1.5} unidad="h" />
      </>,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('−3 pts')).toBeInTheDocument();
    expect(screen.getByText('+22 %')).toBeInTheDocument();
    expect(screen.getByText('+0,4 d')).toBeInTheDocument();
    expect(screen.getByText('−1,5 h')).toBeInTheDocument();
  });

  it('un cambio que redondea a cero no lleva signo', () => {
    render(<Variacion valor={-0.02} unidad="d" />);
    expect(screen.getByText('0 d')).toBeInTheDocument();
  });

  it('sube en verde y baja en rojo; con mejorSiBaja se invierte', () => {
    render(
      <>
        <Variacion valor={5} unidad="%" />
        <Variacion valor={-5} unidad="pts" />
        <Variacion valor={0.5} unidad="d" mejorSiBaja />
        <Variacion valor={-0.5} unidad="h" mejorSiBaja />
        <Variacion valor={0} unidad="%" />
      </>,
    );
    expect(screen.getByText('+5 %')).toHaveAttribute('data-sentido', 'sube');
    expect(screen.getByText('−5 pts')).toHaveAttribute('data-sentido', 'baja');
    expect(screen.getByText('+0,5 d')).toHaveAttribute('data-sentido', 'baja');
    expect(screen.getByText('−0,5 h')).toHaveAttribute('data-sentido', 'sube');
    expect(screen.getByText('0 %')).toHaveAttribute('data-sentido', 'neutro');
  });
});

describe('Boton', () => {
  it('es un botón real, de tipo button por defecto, con su variante', async () => {
    const alTocar = vi.fn();
    render(<Boton variante="primario" onClick={alTocar}>Nueva tarea</Boton>);
    const boton = screen.getByRole('button', { name: 'Nueva tarea' });
    expect(boton).toHaveAttribute('type', 'button');
    expect(boton).toHaveAttribute('data-variante', 'primario');
    await userEvent.click(boton);
    expect(alTocar).toHaveBeenCalledOnce();
  });

  it('respeta type y disabled', () => {
    render(<Boton variante="secundario" type="submit" disabled>Guardar</Boton>);
    const boton = screen.getByRole('button', { name: 'Guardar' });
    expect(boton).toHaveAttribute('type', 'submit');
    expect(boton).toBeDisabled();
  });
});

describe('Pildora, Aviso y Vidrio', () => {
  it('Pildora con color muestra el punto', () => {
    const { container } = render(<Pildora color="#ff8a3d">Campaña Q4</Pildora>);
    expect(screen.getByText('Campaña Q4')).toBeInTheDocument();
    expect(container.querySelector('.pildora__punto')).toBeInTheDocument();
  });

  it('Aviso de error es una alerta y el de info un estado', () => {
    render(<><Aviso tipo="error">No se pudo guardar</Aviso><Aviso tipo="info">Datos de hace 2 min</Aviso></>);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar');
    expect(screen.getByRole('status')).toHaveTextContent('Datos de hace 2 min');
  });

  it('Vidrio usa la etiqueta pedida y marca la entrada', () => {
    render(<Vidrio as="section" className="extra">Contenido</Vidrio>);
    const caja = screen.getByText('Contenido');
    expect(caja.tagName).toBe('SECTION');
    expect(caja).toHaveClass('vidrio', 'extra');
    expect(caja).toHaveAttribute('data-entra', 'vidrio');
  });
});

describe('Interruptor', () => {
  it('Interruptor es un switch con aria-checked que avisa el cambio', async () => {
    const alCambiar = vi.fn();
    const usuario = userEvent.setup();
    render(<Interruptor etiqueta="Restar reuniones" ayuda="Descuenta las horas" activo={false} onCambio={alCambiar} />);
    const interruptor = screen.getByRole('switch', { name: 'Restar reuniones' });
    expect(interruptor).toHaveAttribute('aria-checked', 'false');
    expect(interruptor).toHaveAccessibleDescription('Descuenta las horas');
    await usuario.click(interruptor);
    expect(alCambiar).toHaveBeenLastCalledWith(true);
    // Con teclado: Espacio y Enter lo accionan como cualquier botón.
    interruptor.focus();
    await usuario.keyboard(' ');
    await usuario.keyboard('{Enter}');
    expect(alCambiar).toHaveBeenCalledTimes(3);
  });

  it('prendido avisa que se apaga y deshabilitado no cambia', async () => {
    const alCambiar = vi.fn();
    const usuario = userEvent.setup();
    const { rerender } = render(<Interruptor etiqueta="Opción" activo onCambio={alCambiar} />);
    expect(screen.getByRole('switch', { name: 'Opción' })).toHaveAttribute('aria-checked', 'true');
    await usuario.click(screen.getByRole('switch', { name: 'Opción' }));
    expect(alCambiar).toHaveBeenLastCalledWith(false);
    rerender(<Interruptor etiqueta="Opción" activo deshabilitado onCambio={alCambiar} />);
    await usuario.click(screen.getByRole('switch', { name: 'Opción' }));
    expect(alCambiar).toHaveBeenCalledTimes(1);
  });

  it('deshabilitado usa aria-disabled, conserva el foco y no cambia', async () => {
    const alCambiar = vi.fn();
    const usuario = userEvent.setup();
    const { rerender } = render(<Interruptor etiqueta="Opción" activo={false} onCambio={alCambiar} />);
    screen.getByRole('switch', { name: 'Opción' }).focus();
    rerender(<Interruptor etiqueta="Opción" activo={false} deshabilitado onCambio={alCambiar} />);
    const deshabilitado = screen.getByRole('switch', { name: 'Opción' });
    expect(deshabilitado).toHaveAttribute('aria-disabled', 'true');
    expect(deshabilitado).not.toHaveAttribute('disabled');
    expect(deshabilitado).toHaveFocus();
    await usuario.click(deshabilitado);
    await usuario.keyboard(' ');
    expect(alCambiar).not.toHaveBeenCalled();
  });
});
