import type { Plataforma } from '../../compartido/tipos.js';

// El enlace termina en espacio, `>`, `"`, `)` o fin de línea.
const CANDIDATO = /https:\/\/[^\s>")]+/g;

// La puntuación de la frase que rodea al enlace no es parte del enlace.
const PUNTUACION_FINAL = /[.,;:!?]+$/;

const PATRONES: { plataforma: Plataforma; patron: RegExp }[] = [
  { plataforma: 'teams', patron: /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\/./ },
  { plataforma: 'meet', patron: /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?![a-z\d-])/ },
  { plataforma: 'zoom', patron: /^https:\/\/(?:[a-z\d-]+\.)?zoom\.us\/j\/./ },
];

/** El primer enlace de reunión (Teams, Meet o Zoom) que aparezca, buscando en el orden de los textos. */
export function enlaceParaUnirse(...textos: (string | null)[]): { enlace: string; plataforma: Plataforma } | null {
  for (const texto of textos) {
    if (!texto) continue;
    for (const [candidato] of texto.matchAll(CANDIDATO)) {
      const enlace = candidato.replace(PUNTUACION_FINAL, '');
      const coincidencia = PATRONES.find(({ patron }) => patron.test(enlace));
      if (coincidencia) return { enlace, plataforma: coincidencia.plataforma };
    }
  }
  return null;
}
