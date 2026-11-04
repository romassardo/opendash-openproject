import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface OpcionGrupo<T extends string> {
  valor: T;
  /** Nombre accesible de la opción. */
  etiqueta: string;
  contenido: ReactNode;
}

export interface GrupoOpcionesProps<T extends string> {
  etiqueta: string;
  opciones: readonly OpcionGrupo<T>[];
  valor: NoInfer<T>;
  onElegir(valor: NoInfer<T>): void;
  className?: string;
}

const SALTO: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Grupo de opciones sueltas (tonos, íconos): `radiogroup` con foco itinerante y flechas. */
export function GrupoOpciones<T extends string>({ etiqueta, opciones, valor, onElegir, className }: GrupoOpcionesProps<T>) {
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const activo = Math.max(0, opciones.findIndex((o) => o.valor === valor));

  const alTeclear = (evento: KeyboardEvent, i: number) => {
    const paso = SALTO[evento.key];
    if (paso === undefined) return;
    evento.preventDefault();
    const destino = (i + paso + opciones.length) % opciones.length;
    botones.current[destino]?.focus();
    const opcion = opciones[destino];
    if (opcion) onElegir(opcion.valor);
  };

  return (
    <div role="radiogroup" aria-label={etiqueta} className={className}>
      {opciones.map((opcion, i) => (
        <button
          key={opcion.valor}
          ref={(nodo) => { botones.current[i] = nodo; }}
          type="button"
          role="radio"
          aria-checked={opcion.valor === valor}
          aria-label={opcion.etiqueta}
          tabIndex={i === activo ? 0 : -1}
          className="opcion-grupo"
          onClick={() => onElegir(opcion.valor)}
          onKeyDown={(evento) => alTeclear(evento, i)}
        >
          {opcion.contenido}
        </button>
      ))}
    </div>
  );
}
