import { useCallback, useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import type { CambiosTarea, Catalogo, Columna, Dependencia, MotivoSinReleer, RespuestaComentario, Tarea } from '../../compartido/tipos.js';
import { ErrorApi, pedir } from '../api/cliente.js';
import { CLAVES, type DetalleTarea, type ListaTareas } from '../api/consultas.js';
import { mensajeDeError, ponerTarea, yaNoExiste, useAvisoDeCierre, useCrearTarea, useMoverTarea } from './acciones.js';
import { comentariosDe, MSG_CONFLICTO_DETALLE, MSG_CONFLICTO_SUBTAREA } from './edicion.js';

export const MSG_COMENTARIO_SIN_RELEER = 'Se guardó el comentario; va a aparecer cuando vuelva la conexión con OpenProject.';
export const MSG_COMENTARIO_TOKEN = 'Tu comentario se guardó. Para verlo, cargá un token nuevo de OpenProject.';
export const MSG_COMENTARIO_SIN_ACCESO = 'Tu comentario se guardó, pero ya no podés ver esta tarea.';

const AVISO_SIN_RELEER: Record<MotivoSinReleer, string> = {
  'sin-conexion': MSG_COMENTARIO_SIN_RELEER,
  'token-vencido': MSG_COMENTARIO_TOKEN,
  'sin-acceso': MSG_COMENTARIO_SIN_ACCESO,
};

const esConflicto = (error: unknown): boolean => error instanceof ErrorApi && error.codigo === 'conflicto';

export type TipoAviso = 'error' | 'info';

/** Avisos del panel. Cada uno es de un campo: una escritura nueva solo borra el aviso de su propio campo. */
export interface Avisos {
  avisar(campo: string, mensaje: string, tipo?: TipoAviso): void;
  limpiar(campo: string): void;
}

/** Cómo terminó una escritura: el campo decide qué hacer con lo escrito según esto. */
export type Resultado = 'guardado' | 'conflicto' | 'fallo';

/** Valores que el campo vio al empezar a editar; si el servidor ya tiene otros, no se manda (Ruling 29). */
export type Esperado = Partial<Pick<Tarea, 'titulo' | 'descripcion'>>;

/**
 * Cola de escrituras de una tarea: cada una espera a la anterior, así siempre sale con el
 * lockVersion que dejó la última (dos cambios seguidos no chocan entre sí).
 */
function useCola() {
  const cola = useRef<Promise<unknown>>(Promise.resolve());
  const [pendientes, setPendientes] = useState(0);
  const encolar = useCallback(<T>(trabajo: () => Promise<T>): Promise<T> => {
    setPendientes((n) => n + 1);
    const turno = cola.current.then(trabajo).finally(() => setPendientes((n) => n - 1));
    cola.current = turno.catch(() => undefined);
    return turno;
  }, []);
  const esperar = useCallback(() => cola.current, []);
  return { encolar, esperar, ocupada: pendientes > 0 };
}

export interface EdicionTarea {
  /** `true` mientras haya escrituras sin responder. */
  ocupada: boolean;
  /** `true` mientras se relee la tarea (por ejemplo, después de un conflicto). */
  releyendo: boolean;
  /** Termina cuando terminaron todas las escrituras pendientes. */
  esperar(): Promise<unknown>;
  /** PATCH solo con lo que cambió y el lockVersion vigente; con `esperado`, solo si el servidor no cambió ese campo. */
  guardar(cambios: CambiosTarea, esperado?: Esperado): Promise<Resultado>;
  /** Cambia el estado con la misma acción que el tablero (`mover`). */
  mover(columna: Columna, catalogo: Catalogo): Promise<boolean>;
  moverSubtarea(subtarea: Tarea, columna: Columna, catalogo: Catalogo): Promise<boolean>;
  crearSubtarea(titulo: string, proyectoId: number): Promise<boolean>;
  agregarEspera(predecesoraId: number): Promise<boolean>;
  quitarEspera(dependencia: Dependencia): Promise<boolean>;
  comentar(texto: string): Promise<boolean>;
}

/** Escrituras del panel de detalle de la tarea `id`. Los errores llegan a `avisos` con su texto. */
export function useEdicionTarea(id: number, avisos: Avisos): EdicionTarea {
  const cliente = useQueryClient();
  const { encolar, esperar, ocupada } = useCola();
  const releyendo = useIsFetching({ queryKey: CLAVES.tarea(id) }) > 0;
  const crear = useCrearTarea();
  const { avisar, limpiar } = avisos;
  const alFallarMover = useCallback(
    (mensaje: string, error: unknown) => avisar('estado', esConflicto(error) ? MSG_CONFLICTO_DETALLE : mensaje),
    [avisar],
  );
  const alFallarSubtarea = useCallback(
    (mensaje: string, error: unknown) => avisar('subtareas', esConflicto(error) ? MSG_CONFLICTO_SUBTAREA : mensaje),
    [avisar],
  );
  const moverTarea = useMoverTarea(alFallarMover);
  const moverHija = useMoverTarea(alFallarSubtarea);
  const publicarCierre = useAvisoDeCierre();

  const actual = (): Tarea | undefined => cliente.getQueryData<DetalleTarea>(CLAVES.tarea(id))?.tarea;
  // La tarea pudo cambiar en OpenProject por lo que se hizo (hijas, dependencias): se relee antes de seguir.
  const releer = () => cliente.invalidateQueries({ queryKey: CLAVES.tarea(id) });
  // Una lectura de la lista en curso traería la versión anterior: se cancela antes de escribir en ella.
  const cambiarLista = async (cambio: (lista: ListaTareas) => ListaTareas) => {
    await cliente.cancelQueries({ queryKey: CLAVES.tareas });
    cliente.setQueryData<ListaTareas>(CLAVES.tareas, (lista) => (lista ? cambio(lista) : lista));
  };

  const fallar = (campo: string, error: unknown): Resultado => {
    if (esConflicto(error)) {
      avisar(campo, MSG_CONFLICTO_DETALLE);
      void cliente.invalidateQueries({ queryKey: CLAVES.tarea(id) });
      void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
      return 'conflicto';
    }
    if (error instanceof ErrorApi && error.codigo === 'no-encontrado') yaNoExiste(cliente, id);
    avisar(campo, mensajeDeError(error));
    return 'fallo';
  };

  // Corre `trabajo` en la cola, limpia el aviso anterior de ese campo y convierte cualquier error en aviso.
  const correr = (campo: string, trabajo: () => Promise<Resultado>): Promise<Resultado> =>
    encolar(async () => {
      limpiar(campo);
      try {
        return await trabajo();
      } catch (error) {
        return fallar(campo, error);
      }
    });
  const escribir = async (campo: string, trabajo: () => Promise<boolean>): Promise<boolean> =>
    (await correr(campo, async () => ((await trabajo()) ? 'guardado' : 'fallo'))) === 'guardado';

  return {
    ocupada,
    releyendo,
    esperar,
    guardar: (cambios, esperado = {}) => {
      const campo = Object.keys(cambios).join(',');
      return correr(campo, async () => {
        const tarea = actual();
        if (!tarea) return 'fallo';
        // Alguien cambió ese campo desde que se empezó a editar: no se pisa, se trata como un conflicto.
        const cambiado = (Object.keys(esperado) as (keyof Esperado)[]).some((clave) => tarea[clave] !== esperado[clave]);
        if (cambiado) {
          avisar(campo, MSG_CONFLICTO_DETALLE);
          return 'conflicto';
        }
        const guardada = await pedir<Tarea>('PATCH', `/api/tareas/${id}`, { lockVersion: tarea.lockVersion, cambios });
        // Una lectura en curso traería la versión anterior: se cancela antes de poner la nueva.
        await Promise.all([cliente.cancelQueries({ queryKey: CLAVES.tarea(id) }), cliente.cancelQueries({ queryKey: CLAVES.tareas })]);
        ponerTarea(cliente, guardada);
        // Se relee para traer el historial con el cambio.
        void releer();
        return 'guardado';
      });
    },
    mover: (columna, catalogo) => escribir('estado', async () => {
      const tarea = actual();
      return tarea ? (await moverTarea(tarea, columna, catalogo)) !== null : false;
    }),
    moverSubtarea: (subtarea, columna, catalogo) => escribir('subtareas', async () => {
      const guardada = await moverHija(subtarea, columna, catalogo);
      if (guardada === null) return false;
      await releer();
      publicarCierre(subtarea, columna !== 'cerrado', guardada);
      return true;
    }),
    crearSubtarea: (titulo, proyectoId) => escribir('subtareas', async () => {
      await crear.mutateAsync({ titulo, proyectoId, madreId: id });
      await releer();
      return true;
    }),
    agregarEspera: (predecesoraId) => escribir('espera', async () => {
      const nueva = await pedir<Dependencia>('POST', `/api/tareas/${id}/dependencias`, { esperaA: predecesoraId });
      await cambiarLista((lista) => ({ ...lista, dependencias: [...lista.dependencias.filter((d) => d.id !== nueva.id), nueva] }));
      await releer();
      return true;
    }),
    quitarEspera: (dependencia) => escribir('espera', async () => {
      await pedir<null>('DELETE', `/api/dependencias/${dependencia.id}`);
      await cambiarLista((lista) => ({ ...lista, dependencias: lista.dependencias.filter((d) => d.id !== dependencia.id) }));
      await releer();
      return true;
    }),
    // Comentar no cambia el lockVersion: no hace falta la cola ni releer la tarea.
    comentar: async (texto) => {
      limpiar('comentario');
      let respuesta: RespuestaComentario;
      try {
        respuesta = await pedir<RespuestaComentario>('POST', `/api/tareas/${id}/comentarios`, { texto });
      } catch (error) {
        fallar('comentario', error);
        return false;
      }
      // Desde acá el comentario ya está en OpenProject: si falla actualizar lo que se ve, no se informa
      // como error (invitaría a reenviarlo y duplicarlo); se vuelve a pedir lo que se muestra.
      try {
        const { actividades, sinReleer } = respuesta;
        if (sinReleer !== null) {
          avisar('comentario', AVISO_SIN_RELEER[sinReleer], 'info');
        } else {
          cliente.setQueryData<DetalleTarea>(CLAVES.tarea(id), (detalle) => (detalle ? { ...detalle, actividades } : detalle));
        }
        await cambiarLista((lista) => ({
          ...lista,
          tareas: lista.tareas.map((t) => (t.id === id
            ? { ...t, comentarios: sinReleer === null ? comentariosDe(actividades).length : (t.comentarios ?? 0) + 1 }
            : t)),
        }));
      } catch {
        void cliente.invalidateQueries({ queryKey: CLAVES.tareas });
        void cliente.invalidateQueries({ queryKey: CLAVES.tarea(id) });
      }
      return true;
    },
  };
}
