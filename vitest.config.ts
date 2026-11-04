import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['servidor/**', 'compartido/**', 'web/**'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'web/muestras/**', 'servidor/main.ts', '**/*.d.ts', '**/*.html'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
    projects: [
      {
        test: {
          name: 'servidor',
          environment: 'node',
          include: ['servidor/**/*.test.ts', 'compartido/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/**/*.test.tsx', 'web/**/*.test.ts'],
          setupFiles: ['@testing-library/jest-dom/vitest'],
        },
      },
    ],
  },
});
