import { useState, type FormEvent } from 'react';
import { useFeriados } from '../api/consultas.js';
import { useAgregarFeriado, useQuitarFeriado } from '../api/mutaciones.js';
import { diaMesCorto, fechaArgentina, hoyArgentina, aUtc } from '../fechas.js';
import { Campo } from '../ingreso/Campo.js';
import { Aviso } from '../ui/Aviso.js';
import { Boton } from '../ui/Boton.js';
import { Pildora } from '../ui/Pildora.js';
import { NotaEquipo, ResultadoGuardado, useGuardado } from './guardado.js';
import { TarjetaSeccion } from './TarjetaSeccion.js';

const LARGO_MAXIMO_NOMBRE = 80;
const diaSemana = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' });

const textoActualizado = (actualizado: string | null): string =>
  actualizado ? `Lista actualizada el ${diaMesCorto(fechaArgentina(actualizado))}` : 'Todavía no se bajó la lista';

export function SeccionFeriados() {
  const [fecha, setFecha] = useState('');
  const [nombre, setNombre] = useState('');
  const estado = useGuardado();
  const lista = useFeriados();
  const agregar = useAgregarFeriado();
  const quitar = useQuitarFeriado();
  const hoy = hoyArgentina();

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    const limpio = nombre.trim();
    if (fecha === '' || limpio === '') return estado.rechazar('Elegí la fecha y escribí el nombre del feriado.');
    if (await estado.guardar(() => agregar.mutateAsync({ fecha, nombre: limpio }))) {
      setFecha('');
      setNombre('');
    }
  };

  const feriados = lista.data?.feriados ?? [];
  return (
    <TarjetaSeccion clave="feriados" titulo="Feriados" subtitulo="Días en los que no se cuenta capacidad">
      <NotaEquipo>Estos ajustes son del equipo: se ven igual para todos.</NotaEquipo>
      {lista.isError && (
        <div className="configuracion__falla">
          <Aviso tipo="error">No se pudieron cargar los feriados.</Aviso>
          <Boton variante="secundario" onClick={() => void lista.refetch()}>Reintentar</Boton>
        </div>
      )}
      {lista.data && <p className="tarjeta__sub">{textoActualizado(lista.data.actualizado)}</p>}
      {feriados.length > 0 && (
        <div className="configuracion__tabla-caja">
          <table className="configuracion__tabla" aria-label="Feriados">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Nombre</th>
                <th scope="col"><span className="configuracion__solo-lectores">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {feriados.map((f) => (
                <tr key={f.fecha} data-pasado={f.fecha < hoy ? 'true' : undefined}>
                  <td className="tnum">{`${diaSemana.format(aUtc(f.fecha)).replace(/\./g, '')} ${diaMesCorto(f.fecha)}`}</td>
                  <td>
                    <div className="configuracion__nombre-caja">
                      <span className="configuracion__nombre-feriado">{f.nombre}</span>
                      {f.puente && <Pildora>Puente</Pildora>}
                      {f.manual && <Pildora>Agregado a mano</Pildora>}
                    </div>
                  </td>
                  <td>
                    <Boton
                      variante="fantasma"
                      aria-label={`Quitar feriado ${f.nombre} del ${diaMesCorto(f.fecha)} ${f.fecha.slice(0, 4)}`}
                      disabled={quitar.isPending}
                      onClick={() => void estado.guardar(() => quitar.mutateAsync(f.fecha))}
                    >
                      Quitar
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="configuracion__bloque formulario" aria-label="Agregar feriado" onSubmit={(e) => void enviar(e)} noValidate>
        <div className="configuracion__par">
          <Campo id="configuracion-feriado-fecha" etiqueta="Fecha del feriado" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <Campo
            id="configuracion-feriado-nombre"
            etiqueta="Nombre del feriado"
            autoComplete="off"
            maxLength={LARGO_MAXIMO_NOMBRE}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="configuracion__acciones">
          <Boton variante="secundario" type="submit" disabled={agregar.isPending}>Agregar</Boton>
        </div>
        <ResultadoGuardado estado={estado} />
      </form>
    </TarjetaSeccion>
  );
}
