import type { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useCambiarTema } from '../marco/useCambiarTema.js';
import { useTema, type Tema } from '../marco/tema.js';
import { Segmentado } from '../ui/Segmentado.js';
import { ResultadoGuardado, useGuardado } from './guardado.js';
import { TarjetaSeccion } from './TarjetaSeccion.js';

const OPCIONES = [
  { valor: 'oscuro', etiqueta: 'Oscuro', icono: <Moon size={16} /> },
  { valor: 'claro', etiqueta: 'Claro', icono: <Sun size={16} /> },
] satisfies { valor: Tema; etiqueta: string; icono: ReactNode }[];

export function SeccionApariencia() {
  const tema = useTema();
  const cambiarTema = useCambiarTema();
  const estado = useGuardado();
  return (
    <TarjetaSeccion clave="apariencia" titulo="Apariencia" subtitulo="El tema se recuerda en este navegador y en tu cuenta">
      <div className="configuracion__fila">
        <div>
          <h3 className="configuracion__rotulo">Tema</h3>
          <p className="tarjeta__sub">Oscuro o claro; el botón de la barra superior hace lo mismo.</p>
        </div>
        <Segmentado
          etiqueta="Tema"
          opciones={OPCIONES}
          valor={tema}
          onCambio={(nuevo) => void estado.guardar(() => cambiarTema(nuevo))}
        />
      </div>
      <ResultadoGuardado estado={estado} />
    </TarjetaSeccion>
  );
}
