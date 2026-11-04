/** Une nombres de clase descartando los vacíos. */
export function unir(...clases: (string | false | null | undefined)[]): string {
  return clases.filter(Boolean).join(' ');
}
