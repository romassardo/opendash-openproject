// Se corre una vez por suite: deja el OpenProject de prueba en un estado conocido (proyecto «Prueba» nuevo).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function preparar(): void {
  const script = fileURLToPath(new URL('../../scripts/preparar-op-prueba.ts', import.meta.url));
  // Sin shell: la ruta puede tener espacios; tsx se carga como módulo de Node.
  execFileSync(process.execPath, ['--import', 'tsx', script], { stdio: 'inherit' });
}
