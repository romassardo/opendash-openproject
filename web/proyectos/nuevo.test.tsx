import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { CATALOGO, falla, limpiarEntorno, ok, prepararEntorno, simularApi, type Manejador } from '../../pruebas/fabricas/web.js';
import { App } from '../App.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

const OPCIONES = { vacio: true, plantillas: [{ id: 17, nombre: 'Proyectos Template' }] };

async function abrir(extra: Record<string, Manejador>, opciones: unknown = OPCIONES) {
  prepararEntorno('/proyectos');
  const api = simularApi({
    'GET /api/catalogo': ok(CATALOGO),
    'GET /api/tareas': ok({ tareas: [], dependencias: [] }),
    'GET /api/proyectos/nuevo': ok(opciones),
    ...extra,
  });
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Proyectos' });
  return { api, usuario: userEvent.setup() };
}

/** Respuestas sucesivas del trabajo; la última se repite. */
const secuencia = (...estados: unknown[]): Manejador => {
  let i = 0;
  return () => ok(estados[Math.min(i++, estados.length - 1)]);
};

describe('Nuevo proyecto', () => {
  it('sin permisos para crear ni copiar no hay botón', async () => {
    await abrir({}, { vacio: false, plantillas: [] });
    expect(screen.queryByRole('button', { name: 'Nuevo proyecto' })).toBeNull();
  });

  it('el diálogo muestra los pasos y navega al terminar', async () => {
    const { api, usuario } = await abrir({
      'POST /api/proyectos/nuevo': ok({ trabajo: 'j1' }),
      'GET /api/proyectos/nuevo/j1': secuencia(
        { paso: 'copiando', proyectoId: null, noCopiado: [], mensaje: null },
        { paso: 'listo', proyectoId: 30, noCopiado: [], mensaje: null },
      ),
    });
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo proyecto' });
    await usuario.type(within(dialogo).getByLabelText('Nombre'), 'Del modelo');
    await usuario.selectOptions(within(dialogo).getByLabelText('Empezar de'), '17');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    expect(await within(dialogo).findByText('Creando el proyecto…')).toBeInTheDocument();
    const copiando = (await within(dialogo).findByText('Copiando la plantilla…')).closest('li')!;
    const creando = within(dialogo).getByText('Creando el proyecto…').closest('li')!;
    // El paso hecho lleva la marca de hecho; el que corre, el giro.
    expect(creando).toHaveClass('nuevo-proyecto__paso--hecho');
    expect(creando.querySelector('.nuevo-proyecto__giro')).toBeNull();
    expect(copiando).not.toHaveClass('nuevo-proyecto__paso--hecho');
    expect(copiando.querySelector('.nuevo-proyecto__giro')).not.toBeNull();
    expect(api.llamadas).toContainEqual({ metodo: 'POST', ruta: '/api/proyectos/nuevo', cuerpo: { nombre: 'Del modelo', plantillaId: 17 } });
    await waitFor(() => expect(window.location.pathname).toBe('/proyectos/30'), { timeout: 4000 });
  });

  it('si hubo cosas sin copiar, las lista antes de ir', async () => {
    const { usuario } = await abrir({
      'POST /api/proyectos/nuevo': ok({ trabajo: 'j1' }),
      'GET /api/proyectos/nuevo/j1': ok({ paso: 'listo', proyectoId: 31, noCopiado: ['Los adjuntos'], mensaje: null }),
    });
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo proyecto' });
    await usuario.type(within(dialogo).getByLabelText('Nombre'), 'Nuevo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    expect(await within(dialogo).findByText('Los adjuntos')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/proyectos');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Abrir el proyecto' }));
    expect(window.location.pathname).toBe('/proyectos/31');
  });

  it('un fallo muestra el mensaje y el proyecto que quedó', async () => {
    const { usuario } = await abrir({
      'POST /api/proyectos/nuevo': ok({ trabajo: 'j1' }),
      'GET /api/proyectos/nuevo/j1': ok({ paso: 'fallo', proyectoId: 32, noCopiado: [], mensaje: 'Se rompió' }),
    });
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo proyecto' });
    await usuario.type(within(dialogo).getByLabelText('Nombre'), 'Nuevo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/^Se rompió$/);
    expect(within(dialogo).getByRole('button', { name: 'Abrir el proyecto' })).toBeInTheDocument();
  });

  it('nombre repetido: muestra el error y no pasa a los pasos', async () => {
    const { usuario } = await abrir({ 'POST /api/proyectos/nuevo': falla(400, 'validacion', 'Ya hay un proyecto que se llama «X»') });
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo proyecto' });
    await usuario.type(within(dialogo).getByLabelText('Nombre'), 'X');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Ya hay un proyecto que se llama «X»');
    expect(within(dialogo).getByRole('button', { name: 'Crear' })).toBeInTheDocument();
  });

  it('al abrir el cursor está en Nombre y al cerrar el foco vuelve a «Nuevo proyecto»', async () => {
    const { usuario } = await abrir({});
    const abrirBoton = await screen.findByRole('button', { name: 'Nuevo proyecto' });
    await usuario.click(abrirBoton);
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo proyecto' });
    expect(within(dialogo).getByLabelText('Nombre')).toHaveFocus();
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuevo proyecto' })).toBeNull());
    expect(abrirBoton).toHaveFocus();
  });

  it('al pasar a los pasos el foco no se pierde y los pasos se anuncian', async () => {
    const { usuario } = await abrir({
      'POST /api/proyectos/nuevo': ok({ trabajo: 'j1' }),
      'GET /api/proyectos/nuevo/j1': ok({ paso: 'creando', proyectoId: null, noCopiado: [], mensaje: null }),
    });
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo proyecto' });
    await usuario.type(within(dialogo).getByLabelText('Nombre'), 'Nuevo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    const pasos = await within(dialogo).findByRole('list', { name: 'Pasos' });
    expect(pasos.closest('[role="status"]')).not.toBeNull();
    expect(dialogo.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('un pedido perdido del seguimiento se reintenta y, si igual se corta, se puede seguir esperando', async () => {
    let llamadas = 0;
    const { usuario } = await abrir({
      'POST /api/proyectos/nuevo': ok({ trabajo: 'j1' }),
      'GET /api/proyectos/nuevo/j1': () => {
        llamadas += 1;
        return llamadas <= 3 ? falla(502, 'interno', 'Bad gateway') : ok({ paso: 'listo', proyectoId: 30, noCopiado: ['Wiki'], mensaje: null });
      },
    });
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo proyecto' });
    await usuario.type(within(dialogo).getByLabelText('Nombre'), 'Nuevo');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Crear' }));
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Seguir esperando' }, { timeout: 8000 }));
    expect(await within(dialogo).findByRole('button', { name: 'Abrir el proyecto' })).toBeInTheDocument();
  }, 15000);

  describe('desde el «+» de la barra superior', () => {
    const barra = () => document.querySelector<HTMLElement>('.herramientas')!;

    it('sin permiso para crear proyectos, el «+» crea la tarea de una', async () => {
      await abrir({}, { vacio: false, plantillas: [] });
      expect(within(barra()).getByRole('button', { name: 'Nueva tarea' })).toBeInTheDocument();
      expect(within(barra()).queryByRole('button', { name: 'Crear tarea o proyecto' })).toBeNull();
    });

    it('con permiso abre un menú con «Nueva tarea» y «Nuevo proyecto»', async () => {
      const { usuario } = await abrir({});
      const mas = await within(barra()).findByRole('button', { name: 'Crear tarea o proyecto' });
      expect(mas).toHaveAttribute('aria-expanded', 'false');
      await usuario.click(mas);
      const menu = screen.getByRole('menu', { name: 'Crear' });
      expect(within(menu).getAllByRole('menuitem').map((o) => o.textContent)).toEqual(['Nueva tarea', 'Nuevo proyecto']);
      expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Nueva tarea' }));
      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('menu', { name: 'Crear' })).toBeNull();
      expect(document.activeElement).toBe(mas);
    });

    it('«Nuevo proyecto» abre el mismo diálogo y al cerrarlo el foco vuelve al «+»', async () => {
      const { usuario } = await abrir({});
      const mas = await within(barra()).findByRole('button', { name: 'Crear tarea o proyecto' });
      await usuario.click(mas);
      await usuario.click(screen.getByRole('menuitem', { name: 'Nuevo proyecto' }));
      expect(screen.queryByRole('menu', { name: 'Crear' })).toBeNull();
      const dialogo = await screen.findByRole('dialog', { name: 'Nuevo proyecto' });
      expect(within(dialogo).getByLabelText('Nombre')).toBeInTheDocument();
      await usuario.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuevo proyecto' })).toBeNull());
      expect(document.activeElement).toBe(mas);
    });

    it('«Nueva tarea» lleva al alta de Tareas', async () => {
      const { usuario } = await abrir({});
      await usuario.click(await within(barra()).findByRole('button', { name: 'Crear tarea o proyecto' }));
      await usuario.click(screen.getByRole('menuitem', { name: 'Nueva tarea' }));
      await waitFor(() => expect(window.location.pathname).toBe('/tareas'));
      expect(await screen.findByRole('form', { name: 'Nueva tarea' })).toBeInTheDocument();
    });
  });
});
