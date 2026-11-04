import { useActualizarCuenta } from '../api/mutaciones.js';
import { aplicarTema, type Tema } from './tema.js';

/**
 * Cambia el tema en este navegador al instante y lo guarda en el servidor (para la primera vez en otro
 * navegador). La promesa falla si el servidor no lo guardó; el tema de este navegador queda aplicado igual.
 */
export function useCambiarTema(): (tema: Tema) => Promise<unknown> {
  const { mutateAsync } = useActualizarCuenta();
  return (tema) => {
    aplicarTema(tema);
    return mutateAsync({ tema });
  };
}
