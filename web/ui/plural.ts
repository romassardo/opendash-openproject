/** «1 tarea» / «3 tareas». */
export const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;
