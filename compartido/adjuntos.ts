// Textos de tamaño de los adjuntos: los usan el servidor (rechazo) y la web (aviso antes de subir).

const BYTES_POR_MB = 1024 * 1024;

/** «7 MB» o «4,3 MB» (desde 1 MB), «12 KB» debajo: siempre redondea para arriba, así un archivo apenas más grande no parece igual al máximo. */
export function textoMb(bytes: number): string {
  if (bytes < BYTES_POR_MB) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  const mb = Math.ceil((bytes / BYTES_POR_MB) * 10) / 10;
  return `${Number.isInteger(mb) ? String(mb) : String(mb).replace('.', ',')} MB`;
}

export function textoArchivoGrande(nombre: string, bytes: number, maximo: number): string {
  return `“${nombre}” pesa ${textoMb(bytes)} y el máximo es ${textoMb(maximo)}`;
}

export function textoMaximo(maximo: number): string {
  return `Máximo ${textoMb(maximo)} por archivo`;
}

/** Tipos que el navegador puede abrir en otra pestaña sin riesgo; el resto (html, svg, js…) se baja. */
export const TIPOS_EN_LINEA: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
