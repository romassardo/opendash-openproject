import { defineConfig } from 'vitest/config';

// Pruebas de integración contra el OpenProject de Docker (docker-compose.prueba.yml).
// No forman parte de `npx vitest run`; se corren con `npm run test:integracion`.
export default defineConfig({
  test: {
    name: 'integracion',
    environment: 'node',
    include: ['pruebas/integracion/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    globalSetup: ['pruebas/integracion/preparacion.ts'],
  },
});
