import { useState, type FormEvent } from 'react';
import type { Vacaciones } from '../../compartido/tipos.js';
import { useVacaciones } from '../api/consultas.js';
import { useAgregarVacaciones, useQuitarVacaciones } from '../api/mutaciones.js';
import { diaMesCorto, mesDe } from '../fechas.js';
import { Campo } from '../ingreso/Campo.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { ResultadoGuardado, useGuardado } from './guardado.js';

/** «5 – 9 ene», o «28 dic – 9 ene» si cruza de mes. */
export function rangoCorto({ desde, hasta }: Pick<Vacaciones, 'desde' | 'hasta'>): string {
  if (desde === hasta) return diaMesCorto(desde);
  if (mesDe(desde) === mesDe(hasta)) return `${Number(desde.slice(8))} – ${diaMesCorto(hasta)}`;
  return `${diaMesCorto(desde)} – ${diaMesCorto(hasta)}`;
}

/** Vacaciones propias: las que vienen, para quitarlas, y un formulario para agregar. */
export function FormularioVacaciones() {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const estado = useGuardado();
  const lista = useVacaciones();
  const agregar = useAgregarVacaciones();
  const quitar = useQuitarVacaciones();

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (desde === '' || hasta === '') return estado.rechazar('Elegí el primer y el último día de las vacaciones.');
    if (await estado.guardar(() => agregar.mutateAsync({ desde, hasta }))) {
      setDesde('');
      setHasta('');
    }
  };

  const vacaciones = lista.data ?? [];
  return (
    <section className="configuracion__bloque" aria-labelledby="configuracion-vacaciones-titulo">
      <h3 id="configuracion-vacaciones-titulo" className="configuracion__rotulo">Vacaciones</h3>
      <p className="tarjeta__sub">En esos días no se te cuenta capacidad y el equipo te ve de vacaciones.</p>
      {lista.isError && (
        <div className="configuracion__falla">
          <Aviso tipo="error">No se pudieron cargar tus vacaciones.</Aviso>
          <Boton variante="secundario" onClick={() => void lista.refetch()}>Reintentar</Boton>
        </div>
      )}
      {vacaciones.length > 0 && (
        <ul className="configuracion__lista">
          {vacaciones.map((v) => (
            <li key={v.id} className="configuracion__item">
              <span>{rangoCorto(v)}</span>
              <Boton
                variante="fantasma"
                aria-label={`Quitar vacaciones del ${rangoCorto(v)}`}
                disabled={quitar.isPending}
                onClick={() => void estado.guardar(() => quitar.mutateAsync(v.id))}
              >
                Quitar
              </Boton>
            </li>
          ))}
        </ul>
      )}
      <form className="formulario" aria-label="Agregar vacaciones" onSubmit={(e) => void enviar(e)} noValidate>
        <div className="configuracion__par">
          <Campo id="configuracion-vacaciones-desde" etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <Campo id="configuracion-vacaciones-hasta" etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="configuracion__acciones">
          <Boton variante="secundario" type="submit" disabled={agregar.isPending}>Agregar</Boton>
        </div>
      </form>
      <ResultadoGuardado estado={estado} />
    </section>
  );
}
