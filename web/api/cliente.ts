import type { CodigoError, Respuesta } from '../../compartido/api.js';

export const EVENTO_TOKEN_VENCIDO = 'od:token-vencido';
export const EVENTO_SIN_SESION = 'od:sin-sesion';

export class ErrorApi extends Error {
  readonly codigo: CodigoError;
  readonly mensaje: string;
  /** Código HTTP; 0 si no hubo respuesta. */
  readonly estado: number;
  /** Campos de OpenProject que rechazaron el cambio (solo en validaciones); vacío si no se dijeron. */
  readonly atributos: readonly string[];

  constructor(codigo: CodigoError, mensaje: string, estado: number, atributos: readonly string[] = []) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.codigo = codigo;
    this.mensaje = mensaje;
    this.estado = estado;
    this.atributos = atributos;
  }
}

/** Valor observable chico: lo leen los hooks con useSyncExternalStore. */
function crearSenal<T>(inicial: T) {
  let valor = inicial;
  const oyentes = new Set<() => void>();
  return {
    leer: (): T => valor,
    poner(nuevo: T): void {
      if (Object.is(valor, nuevo)) return;
      valor = nuevo;
      oyentes.forEach((avisar) => avisar());
    },
    suscribir(avisar: () => void): () => void {
      oyentes.add(avisar);
      return () => oyentes.delete(avisar);
    },
  };
}

// Frescura de la última respuesta de cada consulta: alimenta la banda «Sin conexión con OpenProject».
// La clave no lleva parámetros ni ids (`/api/tareas/12` → `/api/tareas/:id`), así el registro no crece.
const desactualizadas = new Map<string, boolean>();
const hayViejas = crearSenal(false);

export function claveDeConsulta(ruta: string): string {
  return (ruta.split(/[?#]/)[0] ?? '').replace(/\/\d+(?=\/|$)/g, '/:id');
}

function anotarFrescura(clave: string, desactualizado: boolean): void {
  desactualizadas.set(clave, desactualizado);
  hayViejas.poner([...desactualizadas.values()].some(Boolean));
}

export const hayDesactualizados = hayViejas.leer;
export const suscribirFrescura = hayViejas.suscribir;

// Token de OpenProject vencido: mientras dure, los refrescos periódicos se pausan.
const vencido = crearSenal(false);
export const tokenVencido = vencido.leer;
export const suscribirTokenVencido = vencido.suscribir;

/** Olvida lo anotado de la sesión anterior (al entrar o salir). */
export function olvidarEstadoDeSesion(): void {
  desactualizadas.clear();
  hayViejas.poner(false);
  vencido.poner(false);
}

function esSobre(valor: unknown): valor is Respuesta<unknown> {
  if (typeof valor !== 'object' || valor === null || !('ok' in valor)) return false;
  if (valor.ok === true) return 'datos' in valor;
  const error = valor as { codigo?: unknown; mensaje?: unknown };
  return typeof error.codigo === 'string' && typeof error.mensaje === 'string';
}

// Estas lecturas salen solo de la base de OpenDash: que respondan no prueba nada sobre el token de OpenProject.
const SIN_TOKEN = /^\/api\/(horas(\/equipo)?|avisos-problema(\/.*)?|calendario)(\?|$)/;

async function llamar<T>(verbo: string, ruta: string, cuerpo: unknown, fondo: boolean): Promise<{ datos: T; desactualizado: boolean }> {
  const conCuerpo = cuerpo !== undefined;
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: verbo,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(conCuerpo ? { 'content-type': 'application/json' } : {}),
        // Pedido automático: el servidor no lo cuenta como actividad de la persona (presencia).
        ...(fondo ? { 'x-opendash-fondo': '1' } : {}),
      },
      body: conCuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi('sin-conexion', 'No hay conexión con OpenDash. Revisá la red y probá de nuevo.', 0);
  }

  // Un borrado responde 204 sin cuerpo: no hay sobre que leer.
  if (respuesta.status === 204) return { datos: undefined as T, desactualizado: false };

  let sobre: unknown;
  try {
    sobre = await respuesta.json();
  } catch {
    sobre = null;
  }
  return desarmar<T>(sobre, respuesta.status, ruta);
}

/** Valida el sobre de la API y avisa de token vencido o sesión caída; lanza ErrorApi si no fue ok. */
function desarmar<T>(sobre: unknown, estado: number, ruta: string): { datos: T; desactualizado: boolean } {
  if (!esSobre(sobre)) {
    throw new ErrorApi('interno', `El servidor respondió algo inesperado (${estado}).`, estado);
  }
  if (!sobre.ok) {
    if (sobre.codigo === 'token-vencido') {
      vencido.poner(true);
      window.dispatchEvent(new Event(EVENTO_TOKEN_VENCIDO));
    }
    if (sobre.codigo === 'no-sesion') window.dispatchEvent(new Event(EVENTO_SIN_SESION));
    throw new ErrorApi(sobre.codigo, sobre.mensaje, estado, sobre.atributos ?? []);
  }
  // Cualquier respuesta buena prueba que el token (si la ruta lo usa) vuelve a andar.
  if (!SIN_TOKEN.test(ruta)) vencido.poner(false);
  return { datos: sobre.datos as T, desactualizado: sobre.desactualizado === true };
}

/**
 * Sube un archivo como cuerpo crudo y avisa el progreso (0 a 1). Va con XMLHttpRequest porque
 * `fetch` no informa cuánto se subió.
 */
export function subirArchivo<T>(ruta: string, archivo: Blob, alProgreso: (fraccion: number) => void, senal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    if (senal?.aborted) {
      rechazar(new ErrorApi('sin-conexion', 'Se canceló la subida.', 0));
      return;
    }
    const pedido = new XMLHttpRequest();
    pedido.open('POST', ruta);
    pedido.withCredentials = true;
    pedido.setRequestHeader('Accept', 'application/json');
    pedido.setRequestHeader('Content-Type', archivo.type || 'application/octet-stream');
    pedido.upload.onprogress = (evento) => {
      if (evento.lengthComputable && evento.total > 0) alProgreso(evento.loaded / evento.total);
    };
    const cancelar = (): void => pedido.abort();
    senal?.addEventListener('abort', cancelar, { once: true });
    const terminar = (): void => senal?.removeEventListener('abort', cancelar);
    pedido.onerror = () => {
      terminar();
      rechazar(new ErrorApi('sin-conexion', 'No hay conexión con OpenDash. Revisá la red y probá de nuevo.', 0));
    };
    pedido.ontimeout = () => {
      terminar();
      rechazar(new ErrorApi('sin-conexion', 'La subida tardó demasiado. Probá de nuevo.', 0));
    };
    pedido.onabort = () => {
      terminar();
      rechazar(new ErrorApi('sin-conexion', 'Se canceló la subida.', 0));
    };
    pedido.onload = () => {
      terminar();
      let sobre: unknown;
      try {
        sobre = JSON.parse(pedido.responseText);
      } catch {
        sobre = null;
      }
      try {
        resolver(desarmar<T>(sobre, pedido.status, ruta).datos);
      } catch (error) {
        rechazar(error);
      }
    };
    pedido.send(archivo);
  });
}

/** Llama a la API propia (misma origen, con la cookie de sesión) y desarma el sobre. */
export async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, opciones: { fondo?: boolean } = {}): Promise<T> {
  const verbo = metodo.toUpperCase();
  const consulta = verbo === 'GET' ? claveDeConsulta(ruta) : null;
  try {
    const { datos, desactualizado } = await llamar<T>(verbo, ruta, cuerpo, opciones.fondo === true);
    if (consulta !== null) anotarFrescura(consulta, desactualizado);
    return datos;
  } catch (error) {
    // Una consulta que falla ya no está «mostrando lo último guardado»: su marca se limpia.
    if (consulta !== null) anotarFrescura(consulta, false);
    throw error;
  }
}
