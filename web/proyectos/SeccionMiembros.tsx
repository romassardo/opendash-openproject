import { useId, useState } from 'react';
import { Plus, UserMinus } from 'lucide-react';
import { ErrorApi } from '../api/cliente.js';
import { useCatalogo, useMiembros, type ListaMiembros, type MiembroDeGestion } from '../api/consultas.js';
import { useAgregarMiembro, useCambiarRolMiembro, useSacarMiembro } from '../api/mutaciones.js';
import { Aviso } from '../ui/Aviso.js';
import { Avatar } from '../ui/Avatar.js';
import { Boton } from '../ui/Boton.js';
import { useConfirmacion } from '../ui/confirmacion.js';
import { useValorDiferido } from '../ui/valorDiferido.js';
import { DialogoSacarMiembro } from './DialogoSacarMiembro.js';

const textoDeError = (error: unknown, porDefecto: string): string => (error instanceof ErrorApi ? error.mensaje : porDefecto);

function FormularioAgregar({ proyectoId, datos, alCerrar }: { proyectoId: number; datos: ListaMiembros; alCerrar(): void }) {
  const agregar = useAgregarMiembro(proyectoId);
  const [persona, setPersona] = useState('');
  // Sin rol elegido de entrada: el primero de OpenProject suele ser «Project admin» y se daba sin querer.
  const [rol, setRol] = useState('');
  const listo = persona !== '' && rol !== '';
  return (
    <>
      <form
        className="versiones__formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (!listo) return;
          agregar.mutate({ personaId: Number(persona), rolId: Number(rol) }, { onSuccess: alCerrar });
        }}
      >
        <select className="versiones__campo" aria-label="Persona" value={persona} onChange={(e) => setPersona(e.target.value)}>
          <option value="">Elegí una persona</option>
          {datos.candidatos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select className="versiones__campo" aria-label="Rol" value={rol} onChange={(e) => setRol(e.target.value)}>
          <option value="">Elegí un rol</option>
          {datos.roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        <Boton variante="primario" type="submit" disabled={!listo || agregar.isPending}>Agregar</Boton>
        <Boton variante="fantasma" disabled={agregar.isPending} onClick={alCerrar}>Cancelar</Boton>
      </form>
      {agregar.error && <Aviso tipo="error">{textoDeError(agregar.error, 'No se pudo agregar a la persona.')}</Aviso>}
    </>
  );
}

function FilaMiembro({ miembro, proyectoId, datos }: { miembro: MiembroDeGestion; proyectoId: number; datos: ListaMiembros }) {
  const catalogo = useCatalogo();
  const cambiar = useCambiarRolMiembro(proyectoId);
  const sacar = useSacarMiembro(proyectoId);
  const { confirmando, boton, abrir, cerrar } = useConfirmacion();
  const rolActual = miembro.roles[0];
  const [rolElegido, elegirRol, soltarRol] = useValorDiferido(
    rolActual?.id ?? '',
    (valor) => cambiar.mutate({ id: miembro.id, rolId: Number(valor) }, { onSettled: soltarRol }),
  );
  const personas = catalogo.data?.personas ?? [];
  const idsDestino = catalogo.data?.asignables[proyectoId] ?? [];
  const destinos = personas.filter((p) => idsDestino.includes(p.id) && p.id !== miembro.personaId);
  const error = cambiar.error;
  return (
    <li className="version">
      <Avatar persona={{ id: miembro.personaId, nombre: miembro.nombre, login: null, email: null, avatarUrl: miembro.avatarUrl }} tamano={32} />
      <div className="version__datos">
        <span className="version__nombre">{miembro.nombre}</span>
        {error && <Aviso tipo="error">{textoDeError(error, 'No se pudo cambiar el rol.')}</Aviso>}
      </div>
      {datos.puede.cambiar && datos.roles.length > 0 ? (
        <select
          className="version__estado" aria-label={`Cambiar rol de ${miembro.nombre}`} value={rolElegido}
          aria-busy={cambiar.isPending}
          onChange={(e) => elegirRol(e.target.value)}
        >
          {rolActual === undefined && <option value="">Sin rol</option>}
          {datos.roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
      ) : (
        <span className="version__estado version__estado--fijo">{rolActual?.nombre ?? 'Sin rol'}</span>
      )}
      {datos.puede.quitar && !confirmando && (
        <button ref={boton} type="button" className="detalle__quitar" aria-label={`Sacar a ${miembro.nombre}`} onClick={abrir}>
          <UserMinus size={16} aria-hidden="true" />
        </button>
      )}
      {confirmando && (
        <DialogoSacarMiembro
          nombre={miembro.nombre}
          tareasAbiertas={miembro.tareasAbiertas}
          destinos={destinos}
          pendiente={sacar.isPending}
          error={sacar.error ? textoDeError(sacar.error, 'No se pudo sacar a la persona.') : null}
          alCancelar={() => { sacar.reset(); cerrar(); }}
          alConfirmar={(pasarA) => sacar.mutate({ id: miembro.id, pasarA }, { onSuccess: cerrar })}
        />
      )}
    </li>
  );
}

/** Miembros de un proyecto. Sin permiso para ver los miembros (403) la sección no se dibuja. */
export function SeccionMiembros({ proyectoId }: { proyectoId: number }) {
  const consulta = useMiembros(proyectoId);
  const [agregando, setAgregando] = useState(false);
  const titulo = useId();
  const datos = consulta.data;
  if (consulta.error instanceof ErrorApi && consulta.error.estado === 403) return null;
  return (
    <section className="versiones" aria-labelledby={titulo}>
      <header className="versiones__cabeza">
        <h2 id={titulo} className="versiones__titulo">Miembros</h2>
        {datos?.puede.agregar && !agregando && (
          <Boton variante="secundario" icono={<Plus size={16} />} onClick={() => setAgregando(true)}>Agregar persona</Boton>
        )}
      </header>
      {consulta.error && <Aviso tipo="error">{textoDeError(consulta.error, 'No se pudieron cargar los miembros.')}</Aviso>}
      {datos && agregando && <FormularioAgregar proyectoId={proyectoId} datos={datos} alCerrar={() => setAgregando(false)} />}
      {datos && datos.miembros.length === 0 && <p className="detalle__vacio">Este proyecto no tiene miembros</p>}
      {datos && datos.miembros.length > 0 && (
        <ul className="versiones__lista" aria-label="Miembros del proyecto">
          {datos.miembros.map((m) => <FilaMiembro key={m.id} miembro={m} proyectoId={proyectoId} datos={datos} />)}
        </ul>
      )}
    </section>
  );
}
