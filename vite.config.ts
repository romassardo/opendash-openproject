import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

/** «2026-10-25 · abc1234»: fecha y commit del build; `sin-git` si no hay git. */
function versionDelBuild(): string {
  try {
    const commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return commit === '' ? 'sin-git' : `${new Date().toISOString().slice(0, 10)} · ${commit}`;
  } catch {
    return 'sin-git';
  }
}

// Las fuentes de web/api/ también se sirven bajo /api: al servidor solo va lo que no es un módulo.
// Se mira solo el camino (sin `?import`, `?t=…` ni el resto de la consulta).
const esModulo = (url = ''): boolean => /\.(?:[cm]?[jt]sx?|css)$/.test(new URL(url, 'http://vite.local').pathname);

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  define: { __VERSION_OPENDASH__: JSON.stringify(versionDelBuild()) },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:5174', bypass: (req) => (esModulo(req.url) ? req.url : undefined) },
    },
  },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
