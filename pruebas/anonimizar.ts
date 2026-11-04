// Anonimiza respuestas HAL de OpenProject antes de guardarlas como fixtures.
type Json = any;

const DETALLE_CONSERVADO = /^(Estado|Status|Versión|Version|Prioridad|Priority)\b/;

function idDeHref(href: string): number | null {
  const m = /\/(\d+)\/?$/.exec(href);
  return m ? Number(m[1]) : null;
}

/** Devuelve una función pura-por-llamada: numera personas, tareas y proyectos de forma estable por id. */
export function crearAnonimizador(): (json: Json) => Json {
  const numeros = { persona: new Map<number, number>(), tarea: new Map<number, number>(), proyecto: new Map<number, number>() };
  const numero = (clase: keyof typeof numeros, id: number): number => {
    const mapa = numeros[clase];
    if (!mapa.has(id)) mapa.set(id, mapa.size + 1);
    return mapa.get(id)!;
  };

  function claseDeHref(href: string): keyof typeof numeros | null {
    if (/\/(users|groups|principals)\/\d+\/?$/.test(href)) return 'persona';
    if (/\/work_packages\/\d+\/?$/.test(href)) return 'tarea';
    if (/\/projects\/\d+\/?$/.test(href)) return 'proyecto';
    return null;
  }

  const ROTULO = { persona: 'Persona', tarea: 'Tarea', proyecto: 'Proyecto' } as const;

  function recorrer(valor: Json): Json {
    if (Array.isArray(valor)) return valor.map(recorrer);
    if (valor === null || typeof valor !== 'object') return valor;

    const salida: Record<string, Json> = {};
    for (const [clave, v] of Object.entries(valor)) {
      if (clave.startsWith('customField')) continue;
      salida[clave] = recorrer(v);
    }

    if (typeof salida.href === 'string' && typeof salida.title === 'string') {
      const clase = claseDeHref(salida.href);
      const id = idDeHref(salida.href);
      if (clase && id !== null) salida.title = `${ROTULO[clase]} ${numero(clase, id)}`;
    }

    const tipo = typeof salida._type === 'string' ? salida._type : '';
    const id = typeof salida.id === 'number' ? salida.id : null;
    if (id !== null && (tipo === 'User' || tipo === 'Group' || tipo === 'PlaceholderUser')) {
      const n = numero('persona', id);
      salida.name = `Persona ${n}`;
      if ('firstName' in salida) salida.firstName = 'Persona';
      if ('lastName' in salida) salida.lastName = String(n);
      if (salida.login != null) salida.login = `persona${n}`;
      if (salida.email != null) salida.email = `persona${n}@ejemplo.test`;
      delete salida.avatar;
    } else if (id !== null && tipo === 'WorkPackage') {
      const n = numero('tarea', id);
      const original = typeof valor.subject === 'string' ? valor.subject : null;
      salida.subject = `Tarea ${n}`;
      // Los enlaces de acción repiten el título («Log time on work package '…'», «Add child of …»).
      if (original && salida._links && typeof salida._links === 'object') {
        for (const enlace of Object.values(salida._links) as Json[]) {
          if (enlace && typeof enlace.title === 'string') enlace.title = enlace.title.split(original).join(salida.subject);
        }
      }
      if (salida.description && typeof salida.description === 'object') {
        const hay = Boolean(salida.description.raw);
        salida.description = { ...salida.description, raw: hay ? `Descripción de la tarea ${n}` : salida.description.raw, html: hay ? `<p>Descripción de la tarea ${n}</p>` : salida.description.html };
      }
    } else if (id !== null && tipo === 'Project') {
      const n = numero('proyecto', id);
      salida.name = `Proyecto ${n}`;
      if (typeof salida.identifier === 'string') salida.identifier = `proyecto-${n}`;
      if (salida.description && typeof salida.description === 'object') {
        salida.description = { ...salida.description, raw: '', html: '' };
      }
    } else if (id !== null && tipo.startsWith('Activity')) {
      if (salida.comment?.raw) salida.comment = { ...salida.comment, raw: `Comentario ${id}`, html: `<p>Comentario ${id}</p>` };
      if (Array.isArray(salida.details)) {
        salida.details = salida.details.map((d: Json, i: number) =>
          DETALLE_CONSERVADO.test(d?.raw ?? '') ? d : { ...d, raw: `Cambio ${id}.${i + 1}`, html: `Cambio ${id}.${i + 1}` });
      }
    }
    return salida;
  }

  return recorrer;
}
