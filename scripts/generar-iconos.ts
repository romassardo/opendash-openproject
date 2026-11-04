/**
 * Genera los íconos de la app instalable (marca de la barra lateral: LayoutDashboard sobre el acento).
 * Uso: npx tsx scripts/generar-iconos.ts   (los PNG se guardan en web/public y se commitean).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public');
const ACENTO = '#1f6fe6';

interface Icono { archivo: string; tamano: number; margen: number; redondeo: number }

// Maskable: la zona segura es el 80 % central, así que el dibujo se achica y el fondo ocupa todo.
const ICONOS: Icono[] = [
  { archivo: 'iconos/512.png', tamano: 512, margen: 0.2, redondeo: 0.22 },
  { archivo: 'iconos/192.png', tamano: 192, margen: 0.2, redondeo: 0.22 },
  { archivo: 'iconos/maskable-512.png', tamano: 512, margen: 0.3, redondeo: 0 },
  { archivo: 'iconos/180.png', tamano: 180, margen: 0.2, redondeo: 0 },
  { archivo: 'favicon.png', tamano: 32, margen: 0.12, redondeo: 0.22 },
];

// Trazos de lucide `LayoutDashboard` (viewBox 24).
const DIBUJO = `<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/>
<rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>`;

function pagina({ tamano, margen, redondeo }: Icono): string {
  const lado = tamano * (1 - margen * 2);
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${tamano}px;height:${tamano}px;display:grid;place-items:center;border-radius:${tamano * redondeo}px;
background:linear-gradient(145deg,color-mix(in srgb,${ACENTO} 70%,#fff),${ACENTO})">
<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 24 24" fill="none" stroke="#fff"
stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${DIBUJO}</svg></div></body></html>`;
}

const navegador = await chromium.launch({ channel: 'chrome' });
try {
  mkdirSync(join(raiz, 'iconos'), { recursive: true });
  for (const icono of ICONOS) {
    const pag = await navegador.newPage({ viewport: { width: icono.tamano, height: icono.tamano } });
    await pag.setContent(pagina(icono));
    writeFileSync(join(raiz, icono.archivo), await pag.screenshot({ omitBackground: true, type: 'png' }));
    await pag.close();
    console.log(`listo ${icono.archivo}`);
  }
} finally {
  await navegador.close();
}
