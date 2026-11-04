const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** Elementos de `caja` que reciben el foco con Tab, en orden. */
export function enfocables(caja: HTMLElement): HTMLElement[] {
  return [...caja.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((el) => el.tabIndex >= 0);
}

/**
 * Tab y Shift+Tab dan la vuelta dentro de `caja` (un diálogo modal). Si el foco quedó afuera
 * (o en la propia caja), lo trae al primer o al último elemento.
 */
export function atraparTab(evento: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>, caja: HTMLElement): void {
  if (evento.key !== 'Tab') return;
  const lista = enfocables(caja);
  const primero = lista[0];
  const ultimo = lista[lista.length - 1];
  if (!primero || !ultimo) {
    evento.preventDefault();
    return;
  }
  const activo = document.activeElement;
  const adentro = activo instanceof HTMLElement && activo !== caja && caja.contains(activo);
  if (evento.shiftKey && (!adentro || activo === primero)) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && (!adentro || activo === ultimo)) {
    evento.preventDefault();
    primero.focus();
  }
}
