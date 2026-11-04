import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { EstiloProyecto } from '../../compartido/estilos.js';
import type { EstadoVersion, Version, Ajustes, AjustesAvisos, AjustesHoras, EstadoAviso, AjustesMetricas, EstadoCalendario, ListaFeriados, EstadoHoras, MapeoTablero, Tema, Vacaciones, Yo } from '../../compartido/tipos.js';
import { pedir } from './cliente.js';
import { CLAVES, type ListaTareas } from './consultas.js';

export interface CambiosCuenta { rol?: string; capacidadHoras?: number; variasALaVez?: boolean; tema?: Tema; avisoReunionMin?: number | null }

/** Suma a `yo` (si ya está cargado) lo que devolvió el servidor, sin pisar el resto. */
function mezclarEnYo(cliente: QueryClient, cambios: Partial<Yo>): void {
  cliente.setQueryData<Yo>(CLAVES.yo, (previo) => (previo ? { ...previo, ...cambios } : previo));
}

export function useActualizarCuenta() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (cambios: CambiosCuenta) => pedir<Yo>('PATCH', '/api/cuenta', cambios),
    onSuccess: (yo) => mezclarEnYo(cliente, yo),
  });
}

export function useCambiarContrasena() {
  return useMutation({
    mutationFn: (datos: { actual: string; nueva: string }) => pedir<Record<string, never>>('PUT', '/api/cuenta/contrasena', datos),
  });
}

/** `url: null` borra el enlace guardado. */
export function useGuardarCalendario() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: { url: string | null }) =>
      pedir<{ tieneCalendario: boolean; calendario: EstadoCalendario | null }>('PUT', '/api/cuenta/calendario', datos),
    onSuccess: ({ tieneCalendario, calendario }) => {
      mezclarEnYo(cliente, { tieneCalendario, calendario });
      void cliente.invalidateQueries({ queryKey: CLAVES.calendarioTodos });
      // Las reuniones cambian la presencia y las horas por semana del equipo.
      void cliente.invalidateQueries({ queryKey: CLAVES.equipo });
    },
  });
}

/** Las vacaciones cambian la presencia y la capacidad del equipo. */
function guardarVacaciones(cliente: QueryClient, lista: Vacaciones[]): void {
  cliente.setQueryData(CLAVES.vacaciones, lista);
  void cliente.invalidateQueries({ queryKey: ['vacaciones', 'desde'] });
  void cliente.invalidateQueries({ queryKey: CLAVES.equipo });
}

export function useAgregarVacaciones() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: { desde: string; hasta: string }) => pedir<Vacaciones[]>('POST', '/api/cuenta/vacaciones', datos),
    onSuccess: (lista) => guardarVacaciones(cliente, lista),
  });
}

export function useQuitarVacaciones() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => pedir<Vacaciones[]>('DELETE', `/api/cuenta/vacaciones/${id}`),
    onSuccess: (lista) => guardarVacaciones(cliente, lista),
  });
}

/** Los feriados cambian los días hábiles y la capacidad del equipo. */
function guardarFeriados(cliente: QueryClient, lista: ListaFeriados): void {
  cliente.setQueryData(CLAVES.feriados, lista);
  void cliente.invalidateQueries({ queryKey: CLAVES.equipo });
}

export function useAgregarFeriado() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: { fecha: string; nombre: string }) => pedir<ListaFeriados>('POST', '/api/feriados', datos),
    onSuccess: (lista) => guardarFeriados(cliente, lista),
  });
}

export function useQuitarFeriado() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (fecha: string) => pedir<ListaFeriados>('DELETE', `/api/feriados/${fecha}`),
    onSuccess: (lista) => guardarFeriados(cliente, lista),
  });
}

/** Token nuevo de OpenProject: con el guardado vuelve a pedir todos los datos. */
export function useGuardarToken() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => pedir<unknown>('PUT', '/api/auth/token', { token }),
    onSuccess: () => {
      void cliente.invalidateQueries();
    },
  });
}

interface CambioFijado { proyectoId: number; fijado: boolean }

/** El fijado se ve al instante en `yo`; si el servidor lo rechaza, vuelve a como estaba. */
export function useFijarProyecto() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (cambio: CambioFijado) => pedir<{ fijados: number[] }>('PUT', '/api/cuenta/fijados', cambio),
    onMutate: async ({ proyectoId, fijado }) => {
      await cliente.cancelQueries({ queryKey: CLAVES.yo });
      const previo = cliente.getQueryData<Yo>(CLAVES.yo);
      if (previo) {
        const sinEste = previo.fijados.filter((id) => id !== proyectoId);
        mezclarEnYo(cliente, { fijados: fijado ? [...sinEste, proyectoId] : sinEste });
      }
      return { previo };
    },
    onError: (_error, _cambio, contexto) => {
      if (contexto?.previo) cliente.setQueryData(CLAVES.yo, contexto.previo);
    },
    onSuccess: ({ fijados }) => mezclarEnYo(cliente, { fijados }),
  });
}

export function useGuardarEstilo() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ proyectoId, estilo }: { proyectoId: number; estilo: EstiloProyecto }) =>
      pedir<EstiloProyecto>('PUT', `/api/proyectos/${proyectoId}/estilo`, estilo),
    onSuccess: (estilo, { proyectoId }) => {
      cliente.setQueryData<Ajustes>(CLAVES.ajustes, (previo) =>
        (previo ? { ...previo, estilos: { ...previo.estilos, [proyectoId]: estilo } } : previo));
    },
  });
}

export function useMarcarPlantilla() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ proyectoId, plantilla }: { proyectoId: number; plantilla: boolean }) =>
      pedir<{ plantilla: boolean }>('PUT', `/api/proyectos/${proyectoId}/plantilla`, { plantilla }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVES.catalogo }),
  });
}

export function useGuardarAjustesMetricas() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (metricas: AjustesMetricas) => pedir<AjustesMetricas>('PUT', '/api/ajustes/metricas', metricas),
    onSuccess: (metricas) => {
      cliente.setQueryData<Ajustes>(CLAVES.ajustes, (previo) => (previo ? { ...previo, metricas } : previo));
      // Prender o apagar las reuniones cambia las horas por semana que trae el equipo.
      void cliente.invalidateQueries({ queryKey: CLAVES.equipo });
    },
  });
}

export function useGuardarAjustesHoras() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (horas: AjustesHoras) => pedir<AjustesHoras>('PUT', '/api/ajustes/horas', horas),
    onSuccess: (horas) => {
      cliente.setQueryData<Ajustes>(CLAVES.ajustes, (previo) => (previo ? { ...previo, horas } : previo));
      // La jornada es el tope del cronómetro y la meta del anillo de Inicio.
      void cliente.invalidateQueries({ queryKey: CLAVES.horas });
    },
  });
}

export function useMarcarAviso() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, estado }: { id: number; estado: EstadoAviso }) => pedir<{ estado: EstadoAviso }>('PATCH', `/api/avisos-problema/${id}`, { estado }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVES.avisosTodos }),
  });
}

/** Quién recibe los avisos de problemas: cambia `recibeAvisos` de la persona y lo que ve en la barra. */
export function useGuardarReceptores() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (avisos: AjustesAvisos) => pedir<AjustesAvisos>('PUT', '/api/ajustes/avisos', avisos),
    onSuccess: async (avisos, _enviado) => {
      cliente.setQueryData<Ajustes>(CLAVES.ajustes, (previo) => (previo ? { ...previo, avisos } : previo));
      await Promise.all([
        cliente.invalidateQueries({ queryKey: CLAVES.yo }),
        cliente.invalidateQueries({ queryKey: CLAVES.avisosTodos }),
      ]);
    },
  });
}

/** El mapeo cambia en qué columna cae cada tarea: se vuelve a pedir el catálogo y las tareas. */
export function useGuardarTablero() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (mapeo: MapeoTablero) => pedir<MapeoTablero>('PUT', '/api/ajustes/tablero', mapeo),
    onSuccess: async () => {
      await Promise.all([
        cliente.invalidateQueries({ queryKey: CLAVES.catalogo }),
        cliente.invalidateQueries({ queryKey: CLAVES.tareas }),
      ]);
    },
  });
}

export interface AccionesHoras {
  trabajar(tareaId: number): Promise<void>;
  pausar(id: number): Promise<void>;
  seguir(id: number): Promise<void>;
  terminar(id: number): Promise<void>;
  corregir(id: number, segundos: number): Promise<void>;
  pasar(id: number, tareaId: number): Promise<void>;
  descartar(id: number): Promise<void>;
  reintentar(id: number): Promise<void>;
  vistoAviso(id: number): Promise<void>;
  inactividad(desde: string, seguia: boolean): Promise<void>;
  /** Hoy se sigue después del tope, como horas extra. */
  horasExtra(): Promise<void>;
  /** `true` mientras alguna acción espera al servidor. */
  pendiente: boolean;
}

interface PedidoHoras { metodo: 'POST' | 'PATCH'; ruta: string; cuerpo?: unknown }

/** Las acciones del cronómetro: después de cada una se vuelve a pedir el estado y lo que depende de él. */
export function useAccionesHoras(): AccionesHoras {
  const cliente = useQueryClient();
  const mutacion = useMutation({
    mutationFn: ({ metodo, ruta, cuerpo }: PedidoHoras) => (cuerpo === undefined ? pedir<unknown>(metodo, ruta) : pedir<unknown>(metodo, ruta, cuerpo)),
    onSuccess: async (respuesta, pedido) => {
      // La pregunta de inactividad y las horas extra devuelven el estado completo.
      if (pedido.ruta === '/api/horas/inactividad' || pedido.ruta === '/api/horas/extra') cliente.setQueryData<EstadoHoras>(CLAVES.horas, respuesta as EstadoHoras);
      await Promise.all([
        cliente.invalidateQueries({ queryKey: CLAVES.horas }),
        cliente.invalidateQueries({ queryKey: CLAVES.equipo }),
        cliente.invalidateQueries({ queryKey: CLAVES.tareas }),
      ]);
    },
  });
  const { mutateAsync, isPending } = mutacion;
  const enviar = async (pedido: PedidoHoras): Promise<void> => {
    await mutateAsync(pedido);
  };
  const sobre = (id: number, accion: string): Promise<void> => enviar({ metodo: 'POST', ruta: `/api/horas/${id}/${accion}` });
  return {
    trabajar: (tareaId) => enviar({ metodo: 'POST', ruta: '/api/horas', cuerpo: { tareaId } }),
    pausar: (id) => sobre(id, 'pausa'),
    seguir: (id) => sobre(id, 'seguir'),
    terminar: (id) => sobre(id, 'terminar'),
    corregir: (id, segundos) => enviar({ metodo: 'PATCH', ruta: `/api/horas/${id}`, cuerpo: { segundos } }),
    pasar: (id, tareaId) => enviar({ metodo: 'PATCH', ruta: `/api/horas/${id}`, cuerpo: { tareaId } }),
    descartar: (id) => sobre(id, 'descartar'),
    reintentar: (id) => sobre(id, 'reintentar'),
    vistoAviso: (id) => sobre(id, 'aviso-visto'),
    inactividad: (desde, seguia) => enviar({ metodo: 'POST', ruta: '/api/horas/inactividad', cuerpo: { desde, seguia } }),
    horasExtra: () => enviar({ metodo: 'POST', ruta: '/api/horas/extra' }),
    pendiente: isPending,
  };
}

export function useBorrarAdjunto(tareaId: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => pedir<Record<string, never>>('DELETE', `/api/adjuntos/${id}`),
    onSettled: () => cliente.invalidateQueries({ queryKey: CLAVES.adjuntos(tareaId) }),
  });
}

/** Borra la tarea y la saca ya de la lista y del detalle, sin esperar el próximo refresco. */
export function useBorrarTarea() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => pedir<undefined>('DELETE', `/api/tareas/${id}`),
    onSuccess: (_datos, id) => {
      quitarTareaDeLaCache(cliente, id);
      void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
    },
  });
}

/** Saca la tarea y sus descendientes de la lista, y olvida sus detalles, para que nadie la siga viendo ni guardando contra ella. */
export function quitarTareaDeLaCache(cliente: QueryClient, id: number): void {
  const lista = cliente.getQueryData<ListaTareas>(CLAVES.tareas);
  const ids = new Set([id]);
  for (let creció = lista !== undefined; creció;) {
    creció = false;
    for (const t of lista?.tareas ?? []) {
      if (t.madreId !== null && ids.has(t.madreId) && !ids.has(t.id)) { ids.add(t.id); creció = true; }
    }
  }
  // Las sucesoras pierden su «espera a» (y OpenProject puede reprogramarlas) y los tramos de horas pasan a «rechazado».
  for (const d of lista?.dependencias ?? []) {
    if (ids.has(d.predecesoraId) && !ids.has(d.sucesoraId)) void cliente.invalidateQueries({ queryKey: CLAVES.tarea(d.sucesoraId) });
  }
  void cliente.invalidateQueries({ queryKey: CLAVES.horas });
  cliente.setQueryData<ListaTareas>(CLAVES.tareas, (previa) => previa && {
    ...previa,
    tareas: previa.tareas.filter((t) => !ids.has(t.id)),
    dependencias: previa.dependencias.filter((d) => !ids.has(d.sucesoraId) && !ids.has(d.predecesoraId)),
  });
  // Lo de la tarea misma queda en la caché sin observar (el detalle se cierra); los descendientes se olvidan.
  for (const i of ids) {
    if (i === id) continue;
    cliente.removeQueries({ queryKey: CLAVES.tarea(i) });
    cliente.removeQueries({ queryKey: CLAVES.adjuntos(i) });
    cliente.removeQueries({ queryKey: CLAVES.borrado(i) });
  }
}

export interface DatosVersion { nombre: string; inicio: string | null; fin: string | null }
export type CambiosVersion = Partial<DatosVersion & { estado: EstadoVersion }>;

/** Cada cambio de una versión recarga la lista del proyecto y el catálogo (el campo «Versión» y el tablero la leen de ahí). */
function recargarVersiones(cliente: QueryClient, proyectoId: number): void {
  void cliente.invalidateQueries({ queryKey: CLAVES.versiones(proyectoId) });
  void cliente.invalidateQueries({ queryKey: CLAVES.catalogo });
}

export function useCrearVersion(proyectoId: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: DatosVersion) => pedir<Version>('POST', `/api/proyectos/${proyectoId}/versiones`, datos),
    onSettled: () => recargarVersiones(cliente, proyectoId),
  });
}

export function useCambiarVersion(proyectoId: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cambios }: { id: number; cambios: CambiosVersion }) => pedir<Version>('PATCH', `/api/versiones/${id}`, cambios),
    onSettled: () => recargarVersiones(cliente, proyectoId),
  });
}

export function useBorrarVersion(proyectoId: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => pedir<Record<string, never>>('DELETE', `/api/versiones/${id}`),
    onSettled: () => recargarVersiones(cliente, proyectoId),
  });
}

/** Cada cambio de miembros recarga la lista, el catálogo (asignables) y las tareas (pudieron cambiar de responsable). */
function recargarMiembros(cliente: QueryClient, proyectoId: number): void {
  void cliente.invalidateQueries({ queryKey: CLAVES.miembros(proyectoId) });
  void cliente.invalidateQueries({ queryKey: CLAVES.catalogo });
  void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
}

export function useAgregarMiembro(proyectoId: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: { personaId: number; rolId: number }) => pedir<unknown>('POST', `/api/proyectos/${proyectoId}/miembros`, datos),
    onSettled: () => recargarMiembros(cliente, proyectoId),
  });
}

export function useCambiarRolMiembro(proyectoId: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rolId }: { id: number; rolId: number }) => pedir<unknown>('PATCH', `/api/miembros/${id}`, { rolId }),
    onSettled: () => recargarMiembros(cliente, proyectoId),
  });
}

export function useSacarMiembro(proyectoId: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pasarA }: { id: number; pasarA: number | null }) => pedir<Record<string, never>>('DELETE', `/api/miembros/${id}`, { pasarA }),
    onSettled: () => recargarMiembros(cliente, proyectoId),
  });
}

/** Arranca la creación en segundo plano; devuelve el trabajo que se consulta después. */
export function useArrancarProyectoNuevo() {
  return useMutation({
    mutationFn: (datos: { nombre: string; plantillaId: number | null }) => pedir<{ trabajo: string }>('POST', '/api/proyectos/nuevo', datos),
  });
}

/** Cuando el proyecto nuevo ya existe, el catálogo y las tareas lo incluyen. */
export function recargarTrasProyectoNuevo(cliente: QueryClient): void {
  void cliente.invalidateQueries({ queryKey: CLAVES.catalogo });
  void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
}
