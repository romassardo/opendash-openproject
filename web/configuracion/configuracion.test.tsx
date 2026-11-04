import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../App.js';
import { AJUSTES, falla, limpiarEntorno, ok, prepararEntorno, simularApi, YO } from '../../pruebas/fabricas/web.js';

afterEach(() => {
  cleanup();
  limpiarEntorno();
});

async function abrir(rutas: Parameters<typeof simularApi>[0] = {}) {
  prepararEntorno('/configuracion');
  const api = simularApi(rutas);
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Configuración' });
  await screen.findByRole('heading', { level: 2, name: 'Mi cuenta' });
  return { api, usuario: userEvent.setup() };
}

/** El «Guardado» anunciado (el marco tiene otro `status`, vacío, para la conexión). */
const avisoGuardado = () => screen.findByText('Guardado', { selector: '[role="status"]' });

const llamadasA = (api: { llamadas: { metodo: string; ruta: string; cuerpo: unknown }[] }, metodo: string, ruta: string) =>
  api.llamadas.filter((l) => l.metodo === metodo && l.ruta === ruta);

describe('Pantalla Configuración', () => {
  it('guardar la capacidad muestra Guardado y actualiza yo', async () => {
    const { api, usuario } = await abrir({
      'PATCH /api/cuenta': (cuerpo) => ok({ ...YO, ...(cuerpo as object) }),
    });
    const campo = await screen.findByLabelText('Capacidad semanal');
    await usuario.clear(campo);
    await usuario.type(campo, '32,5');
    await usuario.tab();
    expect(await avisoGuardado()).toBeInTheDocument();
    expect(llamadasA(api, 'PATCH', '/api/cuenta')[0]?.cuerpo).toEqual({ capacidadHoras: 32.5 });
    await waitFor(() => expect(screen.getByLabelText('Capacidad semanal')).toHaveValue('32,5'));
  });

  it('Configuración guarda jornada y varias a la vez', async () => {
    const { api, usuario } = await abrir({
      'PUT /api/ajustes/horas': (cuerpo) => ok(cuerpo),
      'PATCH /api/cuenta': (cuerpo) => ok({ ...YO, ...(cuerpo as object) }),
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Horas de trabajo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Meta diaria de foco')).not.toBeInTheDocument();
    const jornada = await screen.findByLabelText('Horas por día');
    expect(jornada).toHaveValue('8');
    await usuario.clear(jornada);
    await usuario.type(jornada, '7,5');
    await usuario.tab();
    expect(await avisoGuardado()).toBeInTheDocument();
    expect(llamadasA(api, 'PUT', '/api/ajustes/horas')[0]?.cuerpo).toEqual({ jornadaHoras: 7.5 });

    const varias = screen.getByRole('switch', { name: 'Varias tareas a la vez' });
    expect(varias).toHaveAttribute('aria-checked', 'false');
    await usuario.click(varias);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Varias tareas a la vez' })).toHaveAttribute('aria-checked', 'true'));
    expect(llamadasA(api, 'PATCH', '/api/cuenta')[0]?.cuerpo).toEqual({ variasALaVez: true });
  });

  it('Configuración muestra el aviso de reunión con 5 elegido y guarda «No»', async () => {
    const { api, usuario } = await abrir({
      'PATCH /api/cuenta': (cuerpo) => ok({ ...YO, ...(cuerpo as object) }),
    });
    const grupo = await screen.findByRole('radiogroup', { name: 'Avisarme antes de cada reunión' });
    expect(within(grupo).getAllByRole('radio').map((r) => r.textContent)).toEqual(['No', '1 min', '5 min', '10 min', '15 min']);
    expect(within(grupo).getByRole('radio', { name: '5 min' })).toHaveAttribute('aria-checked', 'true');
    await usuario.click(within(grupo).getByRole('radio', { name: 'No' }));
    await waitFor(() => expect(llamadasA(api, 'PATCH', '/api/cuenta')[0]?.cuerpo).toEqual({ avisoReunionMin: null }));
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Avisarme antes de cada reunión' })).getByRole('radio', { name: 'No' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('una jornada fuera de 1 a 12 no se envía', async () => {
    const { api, usuario } = await abrir();
    const jornada = await screen.findByLabelText('Horas por día');
    await usuario.clear(jornada);
    await usuario.type(jornada, '13');
    await usuario.tab();
    expect(await screen.findByText(/Ingresá un número entre 1 y 12/)).toBeInTheDocument();
    expect(llamadasA(api, 'PUT', '/api/ajustes/horas')).toHaveLength(0);
  });

  it('una capacidad fuera de rango no se envía y muestra el error', async () => {
    const { api, usuario } = await abrir();
    const campo = await screen.findByLabelText('Capacidad semanal');
    await usuario.clear(campo);
    await usuario.type(campo, '95');
    await usuario.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 y 80');
    expect(llamadasA(api, 'PATCH', '/api/cuenta')).toHaveLength(0);
  });

  it('la contraseña nueva distinta de la repetida no se envía', async () => {
    const { api, usuario } = await abrir();
    await usuario.type(await screen.findByLabelText('Contraseña actual'), 'vieja-clave');
    await usuario.type(screen.getByLabelText('Contraseña nueva'), 'clave-nueva-1');
    await usuario.type(screen.getByLabelText('Repetir contraseña nueva'), 'clave-nueva-2');
    await usuario.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no coinciden');
    expect(llamadasA(api, 'PUT', '/api/cuenta/contrasena')).toHaveLength(0);
  });

  it('la contraseña actual incorrecta muestra el error del servidor', async () => {
    const { usuario } = await abrir({
      'PUT /api/cuenta/contrasena': falla(401, 'credenciales', 'La contraseña actual no es correcta'),
    });
    await usuario.type(await screen.findByLabelText('Contraseña actual'), 'equivocada');
    await usuario.type(screen.getByLabelText('Contraseña nueva'), 'clave-nueva-1');
    await usuario.type(screen.getByLabelText('Repetir contraseña nueva'), 'clave-nueva-1');
    await usuario.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña actual no es correcta');
  });

  it('un enlace se guarda y nunca se muestra', async () => {
    const { api, usuario } = await abrir({
      'PUT /api/cuenta/calendario': ok({ tieneCalendario: true, calendario: { leido: null, falla: null } }),
    });
    const campo = await screen.findByLabelText('Enlace ICS');
    await usuario.type(campo, 'https://outlook.office365.com/owa/calendar/secreto.ics');
    await usuario.click(screen.getByRole('button', { name: 'Guardar enlace' }));
    expect(await avisoGuardado()).toBeInTheDocument();
    expect(llamadasA(api, 'PUT', '/api/cuenta/calendario')[0]?.cuerpo).toEqual({ url: 'https://outlook.office365.com/owa/calendar/secreto.ics' });
    expect(screen.getByLabelText('Enlace ICS')).toHaveValue('');
    expect(screen.queryByText(/secreto\.ics/)).toBeNull();
    expect(await screen.findByRole('button', { name: 'Quitar enlace' })).toBeInTheDocument();
  });

  it('guardar un enlace que no devuelve calendario muestra el motivo del servidor', async () => {
    const { usuario } = await abrir({
      'PUT /api/cuenta/calendario': falla(400, 'validacion', 'Ese enlace no devuelve un calendario. Revisá que esté publicado con todos los detalles y copiá el enlace ICS'),
    });
    await usuario.type(await screen.findByLabelText('Enlace ICS'), 'https://outlook.office365.com/owa/calendar/x.ics');
    await usuario.click(screen.getByRole('button', { name: 'Guardar enlace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese enlace no devuelve un calendario');
  });

  it('con el calendario guardado dice cuándo se actualizó', async () => {
    await abrir({
      'GET /api/auth/yo': ok({ ...YO, tieneCalendario: true, calendario: { leido: '2026-10-22T17:05:00Z', falla: null } }),
    });
    expect(await screen.findByText('Guardado · actualizado 14:05')).toBeInTheDocument();
  });

  it('con el calendario sin actualizar dice desde cuándo y por qué', async () => {
    await abrir({
      'GET /api/auth/yo': ok({ ...YO, tieneCalendario: true, calendario: { leido: '2026-10-22T17:05:00Z', falla: 'enlace-caido' } }),
    });
    expect(await screen.findByText(/Sin actualizar desde 14:05: el enlace ya no devuelve un calendario/)).toBeInTheDocument();
  });

  it('sin conexión y sin lectura previa dice solo el motivo', async () => {
    await abrir({
      'GET /api/auth/yo': ok({ ...YO, tieneCalendario: true, calendario: { leido: null, falla: 'sin-conexion' } }),
    });
    expect(await screen.findByText('Sin actualizar: no se pudo conectar con Outlook')).toBeInTheDocument();
  });

  it('agrega vacaciones y las lista como «5 – 9 ene»', async () => {
    const { api, usuario } = await abrir({
      'POST /api/cuenta/vacaciones': ok([{ id: 1, desde: '2027-01-05', hasta: '2027-01-09' }]),
    });
    await usuario.type(await screen.findByLabelText('Desde'), '2027-01-05');
    await usuario.type(screen.getByLabelText('Hasta'), '2027-01-09');
    await usuario.click(within(screen.getByRole('form', { name: 'Agregar vacaciones' })).getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('5 – 9 ene')).toBeInTheDocument();
    expect(llamadasA(api, 'POST', '/api/cuenta/vacaciones')[0]?.cuerpo).toEqual({ desde: '2027-01-05', hasta: '2027-01-09' });
  });

  it('las vacaciones que cruzan de mes muestran los dos meses', async () => {
    await abrir({ 'GET /api/cuenta/vacaciones': ok([{ id: 2, desde: '2026-12-28', hasta: '2027-01-09' }]) });
    expect(await screen.findByText('28 dic – 9 ene')).toBeInTheDocument();
  });

  it('quita unas vacaciones', async () => {
    const { api, usuario } = await abrir({
      'GET /api/cuenta/vacaciones': ok([{ id: 4, desde: '2027-01-05', hasta: '2027-01-09' }]),
      'DELETE /api/cuenta/vacaciones/4': ok([]),
    });
    await screen.findByText('5 – 9 ene');
    await usuario.click(screen.getByRole('button', { name: 'Quitar vacaciones del 5 – 9 ene' }));
    await waitFor(() => expect(screen.queryByText('5 – 9 ene')).toBeNull());
    expect(llamadasA(api, 'DELETE', '/api/cuenta/vacaciones/4')).toHaveLength(1);
  });

  it('muestra el error del servidor cuando las vacaciones se pisan', async () => {
    const { usuario } = await abrir({
      'POST /api/cuenta/vacaciones': falla(400, 'validacion', 'Se pisan con otras vacaciones tuyas'),
    });
    await usuario.type(await screen.findByLabelText('Desde'), '2027-01-05');
    await usuario.type(screen.getByLabelText('Hasta'), '2027-01-09');
    await usuario.click(within(screen.getByRole('form', { name: 'Agregar vacaciones' })).getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Se pisan con otras vacaciones tuyas');
  });

  it('lista los feriados con Puente y Agregado a mano', async () => {
    await abrir({
      'GET /api/feriados': ok({
        feriados: [
          { fecha: '2099-12-25', nombre: 'Navidad', puente: false, manual: false },
          { fecha: '2099-12-24', nombre: 'Día puente', puente: true, manual: false },
          { fecha: '2099-12-31', nombre: 'Cierre del equipo', puente: false, manual: true },
        ],
        actualizado: null,
      }),
    });
    const tabla = await screen.findByRole('table', { name: 'Feriados' });
    const filaPuente = within(tabla).getByRole('row', { name: /Día puente/ });
    expect(within(filaPuente).getByText('Puente')).toBeInTheDocument();
    expect(within(filaPuente).queryByText('Agregado a mano')).toBeNull();
    expect(within(within(tabla).getByRole('row', { name: /Cierre del equipo/ })).getByText('Agregado a mano')).toBeInTheDocument();
    expect(within(tabla).getByRole('row', { name: /Navidad/ })).toHaveTextContent('25 dic');
  });

  it('atenúa los feriados que ya pasaron', async () => {
    await abrir({
      'GET /api/feriados': ok({
        feriados: [
          { fecha: '2020-05-25', nombre: 'Pasado', puente: false, manual: false },
          { fecha: '2099-05-25', nombre: 'Futuro', puente: false, manual: false },
        ],
        actualizado: null,
      }),
    });
    const tabla = await screen.findByRole('table', { name: 'Feriados' });
    expect(within(tabla).getByRole('row', { name: /Pasado/ })).toHaveAttribute('data-pasado', 'true');
    expect(within(tabla).getByRole('row', { name: /Futuro/ })).not.toHaveAttribute('data-pasado');
  });

  it('agrega un feriado a mano y quita otro', async () => {
    const nuevo = { fecha: '2099-03-10', nombre: 'Aniversario', puente: false, manual: true };
    const viejo = { fecha: '2099-12-25', nombre: 'Navidad', puente: false, manual: false };
    const { api, usuario } = await abrir({
      'GET /api/feriados': ok({ feriados: [viejo], actualizado: null }),
      'POST /api/feriados': ok({ feriados: [nuevo, viejo], actualizado: null }),
      'DELETE /api/feriados/2099-12-25': ok({ feriados: [nuevo], actualizado: null }),
    });
    await screen.findByText('Navidad');
    await usuario.type(screen.getByLabelText('Fecha del feriado'), '2099-03-10');
    await usuario.type(screen.getByLabelText('Nombre del feriado'), 'Aniversario');
    await usuario.click(within(screen.getByRole('form', { name: 'Agregar feriado' })).getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('Aniversario')).toBeInTheDocument();
    expect(llamadasA(api, 'POST', '/api/feriados')[0]?.cuerpo).toEqual({ fecha: '2099-03-10', nombre: 'Aniversario' });
    await usuario.click(screen.getByRole('button', { name: 'Quitar feriado Navidad del 25 dic 2099' }));
    await waitFor(() => expect(screen.queryByText('Navidad')).toBeNull());
    expect(llamadasA(api, 'DELETE', '/api/feriados/2099-12-25')).toHaveLength(1);
  });

  it('dice cuándo se actualizó la lista de feriados', async () => {
    await abrir({ 'GET /api/feriados': ok({ feriados: [], actualizado: '2026-10-22T15:00:00Z' }) });
    expect(await screen.findByText('Lista actualizada el 22 oct')).toBeInTheDocument();
  });

  it('dice que todavía no se bajó la lista de feriados', async () => {
    await abrir();
    expect(await screen.findByText('Todavía no se bajó la lista')).toBeInTheDocument();
  });

  it('si fallan los feriados lo dice y Reintentar vuelve a pedirlos', async () => {
    let intentos = 0;
    const { usuario } = await abrir({
      'GET /api/feriados': () => (++intentos === 1
        ? falla(400, 'validacion', 'x')
        : ok({ feriados: [{ fecha: '2099-12-25', nombre: 'Navidad', puente: false, manual: false }], actualizado: null })),
    });
    const aviso = await screen.findByText('No se pudieron cargar los feriados.');
    const seccion = aviso.closest('section')!;
    await usuario.click(within(seccion).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('table', { name: 'Feriados' })).toBeInTheDocument();
    expect(screen.queryByText('No se pudieron cargar los feriados.')).toBeNull();
  });

  it('si fallan las vacaciones lo dice y Reintentar vuelve a pedirlas', async () => {
    let intentos = 0;
    const { usuario } = await abrir({
      'GET /api/cuenta/vacaciones': () => (++intentos === 1 ? falla(400, 'validacion', 'x') : ok([{ id: 4, desde: '2027-01-05', hasta: '2027-01-09' }])),
    });
    const aviso = await screen.findByText('No se pudieron cargar tus vacaciones.');
    await usuario.click(within(aviso.closest('section')!).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'Quitar vacaciones del 5 – 9 ene' })).toBeInTheDocument();
  });

  it('con el catálogo caído Feriados igual aparece', async () => {
    prepararEntorno('/configuracion');
    simularApi({ 'GET /api/catalogo': falla(500, 'interno', 'x') });
    render(<App />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Feriados' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Secciones de configuración' })).getByRole('link', { name: 'Feriados' })).toBeInTheDocument();
  });

  it('Restar las reuniones viene apagado y al prenderlo manda restarReuniones true', async () => {
    const { api, usuario } = await abrir({ 'PUT /api/ajustes/metricas': (cuerpo) => ok(cuerpo) });
    const interruptor = await screen.findByRole('switch', { name: 'Restar las reuniones de la capacidad' });
    expect(interruptor).toHaveAttribute('aria-checked', 'false');
    await usuario.click(interruptor);
    await waitFor(() => expect(llamadasA(api, 'PUT', '/api/ajustes/metricas')).toHaveLength(1));
    expect(llamadasA(api, 'PUT', '/api/ajustes/metricas')[0]?.cuerpo).toEqual({ horasPorDefecto: 4, horasSemanaLargas: 4, capacidadPorDefecto: 40, restarReuniones: true });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Restar las reuniones de la capacidad' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('si falla guardar Restar las reuniones, vuelve a apagado y muestra el error', async () => {
    const { usuario } = await abrir({ 'PUT /api/ajustes/metricas': falla(500, 'interno', 'No se pudo guardar') });
    const interruptor = await screen.findByRole('switch', { name: 'Restar las reuniones de la capacidad' });
    await usuario.click(interruptor);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
    expect(screen.getByRole('switch', { name: 'Restar las reuniones de la capacidad' })).toHaveAttribute('aria-checked', 'false');
  });

  it('cambiar el token lo envía y cierra el formulario', async () => {
    const { api, usuario } = await abrir({ 'PUT /api/auth/token': ok({}) });
    expect(await screen.findByText('Vigente')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Cambiar token' }));
    await usuario.type(screen.getByLabelText('Token nuevo'), ' token-nuevo ');
    await usuario.click(screen.getByRole('button', { name: 'Guardar token' }));
    expect(await avisoGuardado()).toBeInTheDocument();
    expect(llamadasA(api, 'PUT', '/api/auth/token')[0]?.cuerpo).toEqual({ token: 'token-nuevo' });
    expect(screen.queryByLabelText('Token nuevo')).toBeNull();
  });

  it('el interruptor «Es una plantilla» guarda', async () => {
    const { api, usuario } = await abrir({
      'PUT /api/proyectos/11/plantilla': (cuerpo) => ok(cuerpo),
    });
    const interruptores = await screen.findAllByRole('switch', { name: 'Es una plantilla' });
    expect(interruptores[0]).toHaveAttribute('aria-checked', 'false');
    await usuario.click(interruptores[0]!);
    await waitFor(() => expect(llamadasA(api, 'PUT', '/api/proyectos/11/plantilla')).toHaveLength(1));
    expect(llamadasA(api, 'PUT', '/api/proyectos/11/plantilla')[0]?.cuerpo).toEqual({ plantilla: true });
  });

  it('elegir un tono guarda el estilo del proyecto', async () => {
    const { api, usuario } = await abrir({
      'PUT /api/proyectos/11/estilo': (cuerpo) => ok(cuerpo),
    });
    const tonos = await screen.findByRole('radiogroup', { name: 'Tono de Portal de clientes' });
    await usuario.click(within(tonos).getByRole('radio', { name: 'rosa' }));
    await waitFor(() => expect(llamadasA(api, 'PUT', '/api/proyectos/11/estilo')).toHaveLength(1));
    expect(llamadasA(api, 'PUT', '/api/proyectos/11/estilo')[0]?.cuerpo).toEqual({ color: 'rosa', icono: 'carpeta' });
    await waitFor(() =>
      expect(within(screen.getByRole('radiogroup', { name: 'Tono de Portal de clientes' })).getByRole('radio', { name: 'rosa' })).toBeChecked());
  });

  it('elegir un estado para En curso guarda el tablero', async () => {
    const { api, usuario } = await abrir({
      'PUT /api/ajustes/tablero': (cuerpo) => ok(cuerpo),
    });
    const desplegable = await screen.findByLabelText('En curso');
    expect(within(desplegable).getByRole('option', { name: 'Automático (por nombre)' })).toBeInTheDocument();
    expect(within(desplegable).queryByRole('option', { name: 'Closed' })).toBeNull();
    await usuario.selectOptions(desplegable, 'In progress');
    await waitFor(() => expect(llamadasA(api, 'PUT', '/api/ajustes/tablero')).toHaveLength(1));
    expect(llamadasA(api, 'PUT', '/api/ajustes/tablero')[0]?.cuerpo).toEqual({ nuevo: null, curso: 7, pausa: null, cerrado: null });
    expect(await avisoGuardado()).toBeInTheDocument();
  });

  it('cambiar a Claro aplica el tema y lo guarda en el servidor', async () => {
    const { api, usuario } = await abrir({ 'PATCH /api/cuenta': ok({ ...YO, tema: 'claro' }) });
    await usuario.click(await screen.findByRole('radio', { name: 'Claro' }));
    expect(document.documentElement.dataset.tema).toBe('claro');
    await waitFor(() => expect(llamadasA(api, 'PATCH', '/api/cuenta')).toHaveLength(1));
    expect(llamadasA(api, 'PATCH', '/api/cuenta')[0]?.cuerpo).toEqual({ tema: 'claro' });
  });

  it('el botón de la barra superior también guarda el tema en el servidor', async () => {
    const { api, usuario } = await abrir({ 'PATCH /api/cuenta': ok({ ...YO, tema: 'claro' }) });
    await usuario.click(screen.getByRole('button', { name: 'Cambiar a tema claro' }));
    expect(document.documentElement.dataset.tema).toBe('claro');
    await waitFor(() => expect(llamadasA(api, 'PATCH', '/api/cuenta')[0]?.cuerpo).toEqual({ tema: 'claro' }));
  });

  it('guardar una métrica del equipo manda las tres', async () => {
    const { api, usuario } = await abrir({ 'PUT /api/ajustes/metricas': (cuerpo) => ok(cuerpo) });
    const campo = await screen.findByLabelText('Horas para tareas sin estimación');
    await usuario.clear(campo);
    await usuario.type(campo, '6');
    await usuario.tab();
    await waitFor(() => expect(llamadasA(api, 'PUT', '/api/ajustes/metricas')).toHaveLength(1));
    expect(llamadasA(api, 'PUT', '/api/ajustes/metricas')[0]?.cuerpo).toEqual({ horasPorDefecto: 6, horasSemanaLargas: 4, capacidadPorDefecto: 40, restarReuniones: false });
  });

  it('la navegación marca la sección visible', async () => {
    let avisar: IntersectionObserverCallback = () => {};
    class Observador {
      constructor(alVer: IntersectionObserverCallback) { avisar = alVer; }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', Observador);
    const { usuario } = await abrir();
    const nav = screen.getByRole('navigation', { name: 'Secciones de configuración' });
    expect(within(nav).getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('aria-current', 'true');
    // El observador avisa que «Apariencia» entró en la zona visible.
    const destino = document.getElementById('configuracion-apariencia')!;
    avisar([{ isIntersecting: true, target: destino } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Apariencia' })).toHaveAttribute('aria-current', 'true'));
    expect(within(nav).getByRole('link', { name: 'Mi cuenta' })).not.toHaveAttribute('aria-current');
    // Y al elegir una, queda marcada enseguida.
    await usuario.click(within(nav).getByRole('link', { name: 'Métricas' }));
    expect(within(nav).getByRole('link', { name: 'Métricas' })).toHaveAttribute('aria-current', 'true');
  });

  describe('ancla en la dirección', () => {
    const desplazar = vi.fn<(this: Element) => void>();
    const original = Element.prototype.scrollIntoView;
    beforeEach(() => {
      desplazar.mockClear();
      Element.prototype.scrollIntoView = desplazar;
    });
    afterEach(() => {
      Element.prototype.scrollIntoView = original;
    });

    it('entrar a /configuracion#configuracion-cuenta baja a esa sección y la marca en la navegación', async () => {
      prepararEntorno('/configuracion#configuracion-cuenta');
      simularApi();
      render(<App />);
      await screen.findByRole('heading', { level: 2, name: 'Mi cuenta' });
      await waitFor(() => expect(desplazar).toHaveBeenCalled());
      expect(desplazar.mock.contexts[0]).toBe(document.getElementById('configuracion-cuenta'));
      expect(within(screen.getByRole('navigation', { name: 'Secciones de configuración' })).getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('aria-current', 'true');
    });

    it('si la sección espera datos, baja cuando aparece', async () => {
      prepararEntorno('/configuracion#configuracion-feriados');
      simularApi();
      render(<App />);
      await screen.findByRole('heading', { level: 2, name: 'Feriados' });
      await waitFor(() => expect(desplazar).toHaveBeenCalled());
      expect(desplazar.mock.contexts.at(-1)).toBe(document.getElementById('configuracion-feriados'));
      expect(within(screen.getByRole('navigation', { name: 'Secciones de configuración' })).getByRole('link', { name: 'Feriados' })).toHaveAttribute('aria-current', 'true');
    });
  });
});

describe('Configuración · Avisos de problemas', () => {
  const equipo = [5, 9].map((personaId) => ({
    personaId, presencia: 'conectado', rol: '', capacidadHoras: 40, trabajandoEn: [], vacaciones: [], reunionesPorSemana: null,
  }));
  const conAvisos = (receptores: number[]) => ({
    'GET /api/equipo': ok(equipo),
    'GET /api/ajustes': ok({ ...AJUSTES, avisos: { receptores } }),
  });

  it('con la lista vacía cualquiera la completa y se guarda', async () => {
    const { api, usuario } = await abrir({
      ...conAvisos([]),
      'PUT /api/ajustes/avisos': (cuerpo) => ok(cuerpo),
    });
    await usuario.click(await screen.findByRole('switch', { name: 'Martín Gómez' }));
    await waitFor(() => expect(llamadasA(api, 'PUT', '/api/ajustes/avisos')[0]?.cuerpo).toEqual({ receptores: [5] }));
  });

  it('quien no está en la lista de receptores no la puede cambiar', async () => {
    const { api, usuario } = await abrir(conAvisos([5]));
    const interruptor = await screen.findByRole('switch', { name: 'Ana Pereyra' });
    expect(interruptor).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Solo la cambian quienes ya reciben los avisos.')).toBeInTheDocument();
    await usuario.click(interruptor);
    expect(llamadasA(api, 'PUT', '/api/ajustes/avisos')).toHaveLength(0);
  });

  describe('notas bajo «Avisarme antes de cada reunión»', () => {
    const SIN_HTTPS = 'Sin HTTPS el navegador no deja avisar desde otra pestaña: solo vas a ver el aviso dentro de OpenDash.';
    const BLOQUEADO = 'El navegador tiene bloqueados los avisos de OpenDash; se habilitan desde el candado de la barra de direcciones.';
    const AHORA_NO = 'Elegiste no recibir avisos del navegador: solo vas a ver el aviso dentro de OpenDash.';
    let permiso = 'default';
    const seguro = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

    beforeEach(() => {
      permiso = 'default';
      vi.stubGlobal('Notification', class { static get permission() { return permiso; } static async requestPermission() { permiso = 'granted'; return 'granted'; } });
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      if (seguro) Object.defineProperty(window, 'isSecureContext', seguro);
      else delete (window as unknown as { isSecureContext?: boolean }).isSecureContext;
    });

    it('con permiso dado no hay nota', async () => {
      permiso = 'granted';
      await abrir();
      await screen.findByRole('radiogroup', { name: 'Avisarme antes de cada reunión' });
      expect(screen.queryByText(SIN_HTTPS)).not.toBeInTheDocument();
      expect(screen.queryByText(BLOQUEADO)).not.toBeInTheDocument();
      expect(screen.queryByText(AHORA_NO)).not.toBeInTheDocument();
    });

    it('sin HTTPS explica que solo se ve dentro de OpenDash', async () => {
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
      await abrir();
      expect(await screen.findByText(SIN_HTTPS)).toBeInTheDocument();
    });

    it('sin Notification también', async () => {
      vi.stubGlobal('Notification', undefined);
      await abrir();
      expect(await screen.findByText(SIN_HTTPS)).toBeInTheDocument();
    });

    it('con el permiso negado explica cómo habilitarlo', async () => {
      permiso = 'denied';
      await abrir();
      expect(await screen.findByText(BLOQUEADO)).toBeInTheDocument();
    });

    it('tras «Ahora no» explica y deja volver a pedir el permiso', async () => {
      // `abrir` vacía el almacenamiento: el «Ahora no» se simula en la lectura.
      let guardado: string | null = 'ahora-no';
      const leer = Storage.prototype.getItem;
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
        return k === 'opendash.reuniones.permiso' ? guardado : leer.call(this, k);
      });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((k: string) => {
        if (k === 'opendash.reuniones.permiso') guardado = null;
      });
      const { usuario } = await abrir();
      expect(await screen.findByText(AHORA_NO)).toBeInTheDocument();
      await usuario.click(screen.getByRole('button', { name: 'Permitir avisos' }));
      await waitFor(() => expect(screen.queryByText(AHORA_NO)).not.toBeInTheDocument());
      expect(guardado).toBeNull();
      expect(permiso).toBe('granted');
    });

    it('elegir la opción que ya está activa no manda el PATCH', async () => {
      const { api, usuario } = await abrir();
      const grupo = await screen.findByRole('radiogroup', { name: 'Avisarme antes de cada reunión' });
      await usuario.click(within(grupo).getByRole('radio', { name: '5 min' }));
      expect(llamadasA(api, 'PATCH', '/api/cuenta')).toHaveLength(0);
    });
  });
});
