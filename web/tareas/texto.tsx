import { useEffect, useState } from 'react';
import type { Marked } from 'marked';
import { unir } from '../ui/clases.js';
import './markdown.css';

// Markdown de OpenProject (descripciones y comentarios) → HTML seguro. Lista cerrada de etiquetas y
// atributos: nada de script, style, iframe, object, embed, form ni atributos on*. Tampoco imágenes
// (Ruling 30): cargarlas haría que el navegador pida URLs ajenas (rastreo, o el mismo OpenProject).
const ETIQUETAS = [
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'del', 's', 'u', 'sub', 'sup', 'mark', 'kbd', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
];
const ATRIBUTOS = ['href', 'title', 'start', 'align'];
const ENLACES = /^(?:https?:|mailto:)/i;
const WEB = /^https?:/i;

type Purificador = ReturnType<typeof import('dompurify').default>;

function instalarGanchos(purificador: Purificador): void {
  // Cada imagen pasa a ser un enlace «Imagen: …» (solo si su dirección es http/https) o texto plano.
  // Se reemplaza dentro del documento inerte de DOMPurify, antes de que nada llegue a la página.
  purificador.addHook('uponSanitizeElement', (nodo) => {
    if (nodo.nodeName !== 'IMG' || !(nodo instanceof Element)) return;
    const documento = nodo.ownerDocument;
    const direccion = (nodo.getAttribute('src') ?? '').trim();
    const texto = `Imagen: ${(nodo.getAttribute('alt') ?? '').trim() || 'sin descripción'}`;
    // Dentro de otro enlace, solo el texto (no se anidan enlaces).
    if (WEB.test(direccion) && !nodo.closest('a')) {
      const enlace = documento.createElement('a');
      enlace.setAttribute('href', direccion);
      enlace.textContent = texto;
      nodo.replaceWith(enlace);
    } else {
      nodo.replaceWith(documento.createTextNode(texto));
    }
  });

  purificador.addHook('afterSanitizeAttributes', (nodo) => {
    if (nodo.tagName !== 'A') return;
    if (!ENLACES.test(nodo.getAttribute('href') ?? '')) {
      nodo.removeAttribute('href');
      return;
    }
    nodo.setAttribute('target', '_blank');
    nodo.setAttribute('rel', 'noopener noreferrer');
  });
}

interface Motor {
  marked: Marked;
  purificador: Purificador;
}

// `marked` y DOMPurify pesan más que el resto de la pantalla: se bajan la primera vez que hay texto
// para mostrar. Hasta entonces el texto se ve plano; una vez cargados, el render es inmediato.
let motor: Motor | null = null;
let carga: Promise<Motor> | null = null;

function cargarMotor(): Promise<Motor> {
  carga ??= Promise.all([import('marked'), import('dompurify')]).then(([{ Marked }, { default: DOMPurify }]) => {
    const marked = new Marked({ gfm: true, breaks: true });
    // Instancia propia: los ganchos no tocan al DOMPurify global.
    const purificador = DOMPurify(window);

    instalarGanchos(purificador);
    motor = { marked, purificador };
    return motor;
  }).catch((error: unknown) => {
    // Una carga fallida no se guarda: la próxima llamada vuelve a intentar.
    carga = null;
    throw error;
  });
  return carga;
}

function convertir({ marked, purificador }: Motor, texto: string): string {
  const html = marked.parse(texto, { async: false });
  return purificador.sanitize(html, {
    ALLOWED_TAGS: ETIQUETAS,
    ALLOWED_ATTR: ATRIBUTOS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

/** Markdown → HTML saneado (espera a que se carguen `marked` y DOMPurify la primera vez). */
export async function markdownSeguro(texto: string): Promise<string> {
  return convertir(motor ?? (await cargarMotor()), texto);
}

export interface TextoMarkdownProps {
  texto: string;
  className?: string;
}

/**
 * Muestra markdown ya saneado; es el único lugar de la app que inserta HTML.
 * Mientras se cargan las librerías (o si no cargan) se ve el texto plano, nunca HTML sin sanear.
 */
export function TextoMarkdown({ texto, className }: TextoMarkdownProps) {
  const [listo, setListo] = useState(motor !== null);
  useEffect(() => {
    if (listo) return;
    let vigente = true;
    cargarMotor().then(() => vigente && setListo(true), (error: unknown) => {
      // Se avisa en la consola; la carga fallida ya se soltó, así que el próximo montaje reintenta.
      console.error('No se pudieron cargar marked y DOMPurify; el texto se ve plano.', error);
    });
    return () => {
      vigente = false;
    };
  }, [listo]);
  if (!listo || motor === null) return <div className={unir('markdown', className)} style={{ whiteSpace: 'pre-wrap' }}>{texto}</div>;
  return <div className={unir('markdown', className)} dangerouslySetInnerHTML={{ __html: convertir(motor, texto) }} />;
}
