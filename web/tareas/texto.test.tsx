import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { markdownSeguro, TextoMarkdown } from './texto.js';

// Muestra el texto y espera a que `marked` y DOMPurify estén cargados.
async function mostrar(texto: string) {
  const vista = render(<TextoMarkdown texto={texto} />);
  await act(() => markdownSeguro(''));
  return vista;
}

afterEach(() => {
  cleanup();
  delete (window as { __xss?: unknown }).__xss;
});

describe('TextoMarkdown', () => {
  // Va primero: es la única prueba que ve el módulo antes de que carguen las librerías.
  it('mientras se cargan marked y DOMPurify muestra el texto plano, sin HTML', async () => {
    const { container } = render(<TextoMarkdown texto={'**negrita** <b>x</b>'} />);
    expect(container.textContent).toBe('**negrita** <b>x</b>');
    expect(container.querySelector('strong, b')).toBeNull();
    await act(() => markdownSeguro(''));
    expect(container.querySelector('strong')?.textContent).toBe('negrita');
  });

  it('no ejecuta HTML inyectado en un comentario', async () => {
    const { container } = await mostrar('hola <img src=x onerror="window.__xss=1"><script>window.__xss=2</script> **negrita**');
    expect(container.querySelector('script')).toBeNull();
    // Ruling 30: ninguna imagen llega al DOM (antes: el <img> quedaba sin onerror).
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.textContent).toContain('Imagen: sin descripción');
    expect(container.querySelector('strong')?.textContent).toBe('negrita');
    expect((window as any).__xss).toBeUndefined();
  });

  it('convierte el markdown de OpenProject en HTML', async () => {
    const { container } = await mostrar('# Pasos\n\n- uno\n- *dos*\n\n`código`');
    expect(screen.getByRole('heading', { name: 'Pasos' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(container.querySelector('em')?.textContent).toBe('dos');
    expect(container.querySelector('code')?.textContent).toBe('código');
  });

  it('los enlaces se abren aparte y sin acceso a la ventana de origen', async () => {
    await mostrar('[OpenDash](https://ejemplo.com/a) y [correo](mailto:hola@ejemplo.com)');
    const enlace = screen.getByRole('link', { name: 'OpenDash' });
    expect(enlace).toHaveAttribute('href', 'https://ejemplo.com/a');
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'correo' })).toHaveAttribute('href', 'mailto:hola@ejemplo.com');
  });

  it('solo deja direcciones http(s) y mailto', async () => {
    const html = await markdownSeguro(
      '[a](javascript:alert(1)) [b](data:text/html,hola) <a href="vbscript:x">c</a> [d](/relativa) <a href="JaVaScRiPt:alert(1)">e</a>',
    );
    expect(html).not.toMatch(/javascript:|vbscript:|data:|\/relativa/i);
    expect(html).toContain('>a<');
  });

  it('saca etiquetas peligrosas, estilos y atributos on*', async () => {
    const html = await markdownSeguro([
      '<style>body{display:none}</style>',
      '<iframe src="https://ejemplo.com"></iframe>',
      '<object data="x"></object><embed src="x">',
      '<form action="https://ejemplo.com"><input name="clave"><button>Enviar</button></form>',
      '<p style="color:red" onclick="alert(1)" class="boton">texto</p>',
      '<svg><script>alert(1)</script></svg>',
      '<a href="https://ejemplo.com" target="_self" onmouseover="alert(1)">x</a>',
    ].join('\n\n'));
    expect(html).not.toMatch(/<style|<iframe|<object|<embed|<form|<input|<button|<svg|<script/i);
    expect(html).not.toMatch(/\son\w+=|style=|class=/i);
    expect(html).toContain('texto');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('_self');
  });

  it('una imagen remota (un píxel de rastreo) se vuelve un enlace y no carga nada', async () => {
    const { container } = await mostrar('![píxel](https://rastreo.ejemplo.com/p.gif) y <img src="https://ejemplo.com/foto.png" alt="foto del depósito">');
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/\ssrc=/i);
    const pixel = screen.getByRole('link', { name: 'Imagen: píxel' });
    expect(pixel).toHaveAttribute('href', 'https://rastreo.ejemplo.com/p.gif');
    expect(pixel).toHaveAttribute('target', '_blank');
    expect(pixel).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Imagen: foto del depósito' })).toHaveAttribute('href', 'https://ejemplo.com/foto.png');
  });

  it('una imagen data: (o sin dirección válida) queda como texto, sin enlace', async () => {
    const { container } = await mostrar('![logo](data:image/png;base64,AAAA) <img src="javascript:alert(1)">');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Imagen: logo');
    expect(container.textContent).toContain('Imagen: sin descripción');
    expect(container.innerHTML).not.toMatch(/data:|javascript:/i);
  });

  it('una imagen dentro de un enlace queda como texto del enlace', async () => {
    const { container } = await mostrar('[![logo](https://ejemplo.com/logo.png)](https://ejemplo.com)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Imagen: logo' })).toHaveAttribute('href', 'https://ejemplo.com');
  });

  it('una imagen del OpenProject del equipo es solo un enlace: el navegador no la pide', async () => {
    const { container } = await mostrar('<img src="http://192.0.2.10:8080/api/v3/attachments/7/content">');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Imagen: sin descripción' })).toHaveAttribute(
      'href',
      'http://192.0.2.10:8080/api/v3/attachments/7/content',
    );
  });

  it('respeta el número inicial de una lista y la alineación de una tabla', async () => {
    const { container } = await mostrar(['3. tres', '4. cuatro', '', '| Monto |', '|:-:|', '| 10 |'].join('\n'));
    expect(container.querySelector('ol')).toHaveAttribute('start', '3');
    expect(container.querySelector('th')).toHaveAttribute('align', 'center');
  });

  it('el texto vacío no muestra nada', async () => {
    const { container } = await mostrar("");
    expect(container.textContent).toBe('');
  });
});
