// Bloqueo del fondo para los diálogos modales. Varios pueden estar abiertos a la vez (paleta, token,
// paneles): cada elemento lleva la cuenta de quién lo pidió inerte y solo se reactiva cuando nadie lo pide.
// Lo que ya era inerte antes del primer pedido (por otra razón) queda inerte al liberar.

interface Pedido { cuenta: number; yaInerte: boolean }

const pedidos = new Map<Element, Pedido>();

function pedir(el: Element): void {
  const previo = pedidos.get(el);
  if (previo) {
    pedidos.set(el, { ...previo, cuenta: previo.cuenta + 1 });
    return;
  }
  pedidos.set(el, { cuenta: 1, yaInerte: el.hasAttribute('inert') });
  el.setAttribute('inert', '');
}

function soltar(el: Element): void {
  const pedido = pedidos.get(el);
  if (!pedido) return;
  if (pedido.cuenta > 1) {
    pedidos.set(el, { ...pedido, cuenta: pedido.cuenta - 1 });
    return;
  }
  pedidos.delete(el);
  if (!pedido.yaInerte) el.removeAttribute('inert');
}

/**
 * Vuelve inertes todos los elementos que rodean a `excepto` (los hermanos de él y de cada uno de sus
 * ancestros hasta el body), sin tocar a `excepto` ni a lo que lo contiene. Devuelve la función que libera el bloqueo.
 */
export function bloquearFondo(excepto: HTMLElement): () => void {
  const tomados: Element[] = [];
  for (let actual: HTMLElement = excepto; actual.parentElement; actual = actual.parentElement) {
    for (const hermano of actual.parentElement.children) {
      // La capa de avisos queda activa: ahí vive el «Deshacer» que un gesto del modal pudo publicar.
      if (hermano !== actual && !hermano.hasAttribute('data-capa-avisos')) tomados.push(hermano);
    }
    if (actual.parentElement === document.body) break;
  }
  tomados.forEach(pedir);
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    tomados.forEach(soltar);
  };
}
