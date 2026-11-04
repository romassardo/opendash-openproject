import { useRef } from 'react';
import type { Tarea } from '../../compartido/tipos.js';
import type { Avisos, EdicionTarea, Resultado } from './accionesDetalle.js';
import { escapeDescarta, useBorrador, useEstadoVivo, vaHaciaConservar } from './borradores.js';
import { MSG_TITULO_VACIO } from './edicion.js';
import { TuVersion } from './TuVersion.js';

/**
 * Título. Lo escrito no se pierde nunca:
 * - si guardar falla queda en el campo (Enter lo reintenta, Escape lo descarta) — Ruling 28;
 * - si el servidor ya tiene otro título (un conflicto, o un cambio ajeno que llegó mientras se escribía,
 *   Ruling 29) no se manda: se ve el título nuevo y lo escrito pasa a «Tu versión».
 */
export function CampoTitulo({ tarea, edicion, avisos }: { tarea: Tarea; edicion: EdicionTarea; avisos: Avisos }) {
  // null: se ve el título del servidor.
  const [borrador, setBorrador, borradorVivo] = useEstadoVivo<string | null>(null);
  const [suya, setSuya, suyaViva] = useEstadoVivo<string | null>(null);
  const servidor = useRef(tarea.titulo);
  servidor.current = tarea.titulo;
  // Título del servidor cuando se empezó a escribir: si cambió al guardar, no se pisa.
  const base = useRef<string | null>(null);
  const enviando = useRef<string | null>(null);
  // Lo último que el servidor rechazó: salir del campo no lo vuelve a mandar.
  const rechazado = useRef<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const mandar = async (texto: string, esperado: string): Promise<Resultado> => {
    enviando.current = texto;
    setBorrador(texto);
    const resultado = await edicion.guardar({ titulo: texto }, { titulo: esperado });
    enviando.current = null;
    if (resultado === 'fallo') {
      rechazado.current = texto;
      return resultado;
    }
    rechazado.current = null;
    // Lo que se siga escribiendo se compara contra lo guardado; tras un conflicto, contra la base de antes.
    if (resultado === 'guardado') base.current = texto;
    if (resultado === 'conflicto') setSuya(texto);
    if (borradorVivo.current === texto) setBorrador(null);
    return resultado;
  };

  const editar = (texto: string) => {
    if (borradorVivo.current === null) base.current = servidor.current;
    setBorrador(texto);
  };

  const descartar = () => {
    rechazado.current = null;
    base.current = null;
    setBorrador(null);
  };

  const confirmar = (alSalir: boolean): Promise<Resultado> | null => {
    const actual = borradorVivo.current;
    if (actual === null) return null;
    const limpio = actual.trim();
    if (enviando.current === limpio || (alSalir && rechazado.current === limpio)) return null;
    if (limpio === servidor.current) {
      descartar();
      return null;
    }
    if (limpio === '') {
      avisos.avisar('titulo', MSG_TITULO_VACIO);
      descartar();
      return null;
    }
    return mandar(limpio, base.current ?? servidor.current);
  };

  // Se compara contra el título que se ve al reaplicar.
  const reaplicar = async (): Promise<Resultado> => {
    const texto = suyaViva.current;
    if (texto === null) return 'guardado';
    setSuya(null);
    return mandar(texto, servidor.current);
  };

  const sucio = () => suyaViva.current !== null
    || (borradorVivo.current !== null && borradorVivo.current.trim() !== servidor.current);

  useBorrador('titulo', {
    sucio,
    async guardar() {
      if (suyaViva.current !== null) return (await reaplicar()) === 'guardado';
      const enCamino = confirmar(false);
      return enCamino ? (await enCamino) === 'guardado' : !sucio();
    },
    descartar() {
      setSuya(null);
      descartar();
    },
    enfocar: () => campo.current?.focus(),
  });

  return (
    <>
      <textarea
        ref={campo}
        className="detalle__titulo"
        aria-label="Título"
        rows={1}
        maxLength={255}
        spellCheck={false}
        value={borrador ?? tarea.titulo}
        // Una sola línea: los saltos (también los pegados) pasan a ser espacios.
        onChange={(e) => editar(e.target.value.replace(/\s*\n\s*/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void confirmar(false);
          }
          escapeDescarta(e, borrador !== null && borrador !== tarea.titulo, descartar);
        }}
        onBlur={(e) => {
          // Hacia la pregunta de cambios sin guardar no se guarda solo: decide la persona.
          if (!vaHaciaConservar(e.relatedTarget)) void confirmar(true);
        }}
      />
      {suya !== null && (
        <TuVersion
          etiqueta="Tu versión del título"
          ocupada={edicion.ocupada || edicion.releyendo}
          alReaplicar={() => void reaplicar()}
          alDescartar={() => setSuya(null)}
        >
          <p className="detalle-version__titulo">{suya}</p>
        </TuVersion>
      )}
    </>
  );
}
