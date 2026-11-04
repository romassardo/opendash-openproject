import type { CSSProperties } from 'react';
import {
  Briefcase, ChartNoAxesColumn, Code, Flame, Folder, Globe, LayoutGrid, Leaf, Rocket, Settings, ShieldCheck, Smartphone,
  type LucideIcon,
} from 'lucide-react';
import type { EstiloProyecto, IconoProyecto as NombreIcono } from '../../compartido/estilos.js';

const ICONOS: Record<NombreIcono, LucideIcon> = {
  carpeta: Folder,
  cohete: Rocket,
  celular: Smartphone,
  cuadricula: LayoutGrid,
  hoja: Leaf,
  llama: Flame,
  grafico: ChartNoAxesColumn,
  escudo: ShieldCheck,
  engranaje: Settings,
  maletin: Briefcase,
  globo: Globe,
  codigo: Code,
};

export interface IconoProyectoProps {
  estilo: EstiloProyecto;
  tamano?: number;
}

/** Cuadrado redondeado con el degradado del color del proyecto y su ícono (decorativo: el nombre va al lado). */
export function IconoProyecto({ estilo, tamano = 48 }: IconoProyectoProps) {
  const Icono = ICONOS[estilo.icono];
  return (
    <span
      className="icono-proyecto"
      aria-hidden="true"
      style={{ width: tamano, height: tamano, '--icono-tono': `var(--tono-${estilo.color})` } as CSSProperties}
    >
      <Icono size={Math.round(tamano * 0.46)} strokeWidth={1.9} />
    </span>
  );
}
