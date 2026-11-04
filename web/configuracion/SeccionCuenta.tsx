import type { Persona, Yo } from '../../compartido/tipos.js';
import { useActualizarCuenta } from '../api/mutaciones.js';
import { Avatar } from '../ui/Avatar.js';
import { CampoTextoGuardable } from './CampoGuardable.js';
import { FormularioCalendario, FormularioContrasena, FormularioToken, OpcionAvisoReunion } from './FormulariosCuenta.js';
import { FormularioVacaciones } from './FormularioVacaciones.js';
import { TarjetaSeccion } from './TarjetaSeccion.js';

const LARGO_MAXIMO_ROL = 60;

export function SeccionCuenta({ yo, persona }: { yo: Yo; persona: Persona }) {
  const actualizar = useActualizarCuenta();
  return (
    <TarjetaSeccion clave="cuenta" titulo="Mi cuenta" subtitulo="Cómo te ve el equipo y cómo entrás">
      <div className="configuracion__perfil">
        <Avatar persona={persona} tamano={72} />
        <div>
          <p className="configuracion__nombre">{yo.nombre}</p>
          <p className="tarjeta__sub">{yo.login}</p>
        </div>
      </div>
      <CampoTextoGuardable
        id="configuracion-rol"
        etiqueta="Rol"
        ejemplo="Soporte"
        valor={yo.rol}
        maximo={LARGO_MAXIMO_ROL}
        onGuardar={(rol) => actualizar.mutateAsync({ rol })}
      />
      <FormularioToken />
      <FormularioContrasena />
      <FormularioCalendario yo={yo} />
      <OpcionAvisoReunion yo={yo} />
      <FormularioVacaciones />
    </TarjetaSeccion>
  );
}
