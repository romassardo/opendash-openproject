import { useEffect, useState, type KeyboardEvent } from 'react';
import { Campo } from '../ingreso/Campo.js';
import { ResultadoGuardado, useGuardado } from './guardado.js';

const numeroEs = (n: number): string => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });

/** Alcanza con Enter: sale del campo y el blur confirma. */
const confirmarConEnter = (evento: KeyboardEvent<HTMLInputElement>): void => {
  if (evento.key === 'Enter') evento.currentTarget.blur();
};

export interface CampoTextoGuardableProps {
  id: string;
  etiqueta: string;
  valor: string;
  maximo: number;
  ejemplo?: string;
  onGuardar(valor: string): Promise<unknown>;
}

/** Texto que se guarda al salir del campo o con Enter. */
export function CampoTextoGuardable({ id, etiqueta, valor, maximo, ejemplo, onGuardar }: CampoTextoGuardableProps) {
  const [texto, setTexto] = useState(valor);
  const estado = useGuardado();
  useEffect(() => setTexto(valor), [valor]);

  const confirmar = () => {
    const limpio = texto.trim();
    setTexto(limpio);
    if (limpio === valor) return;
    void estado.guardar(() => onGuardar(limpio));
  };

  return (
    <div className="guardable">
      <Campo
        id={id}
        etiqueta={etiqueta}
        value={texto}
        maxLength={maximo}
        placeholder={ejemplo}
        autoComplete="off"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={confirmarConEnter}
      />
      <ResultadoGuardado estado={estado} />
    </div>
  );
}

export interface CampoNumeroGuardableProps {
  id: string;
  etiqueta: string;
  valor: number;
  minimo: number;
  maximo: number;
  paso: number;
  /** Unidad o aclaración: va como ayuda debajo del campo. */
  ayuda?: string;
  onGuardar(valor: number): Promise<unknown>;
}

const multiploDe = (n: number, paso: number): boolean => Math.abs(n / paso - Math.round(n / paso)) < 1e-9;

/** Número (con coma decimal) que se guarda al salir del campo o con Enter; fuera de rango no se envía. */
export function CampoNumeroGuardable({ id, etiqueta, valor, minimo, maximo, paso, ayuda, onGuardar }: CampoNumeroGuardableProps) {
  const [texto, setTexto] = useState(numeroEs(valor));
  const estado = useGuardado();
  useEffect(() => setTexto(numeroEs(valor)), [valor]);

  const confirmar = () => {
    const numero = Number(texto.trim().replace(',', '.'));
    if (texto.trim() === '' || !Number.isFinite(numero) || numero < minimo || numero > maximo || !multiploDe(numero, paso)) {
      estado.rechazar(`Ingresá un número entre ${numeroEs(minimo)} y ${numeroEs(maximo)}, de a ${numeroEs(paso)}.`);
      return;
    }
    setTexto(numeroEs(numero));
    if (numero === valor) return;
    void estado.guardar(() => onGuardar(numero));
  };

  return (
    <div className="guardable">
      <Campo
        id={id}
        etiqueta={etiqueta}
        ayuda={ayuda}
        value={texto}
        inputMode="decimal"
        autoComplete="off"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={confirmarConEnter}
      />
      <ResultadoGuardado estado={estado} />
    </div>
  );
}
