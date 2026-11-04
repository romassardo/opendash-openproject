/** Motivos de OpenProject en frases cortas; lo que no se conoce cae en «Novedad». */
const MOTIVOS: Record<string, string> = {
  mentioned: 'Te mencionaron',
  assigned: 'Te asignaron',
  watched: 'Tarea que seguís',
  commented: 'Comentaron',
  dateAlert: 'Alerta de fecha',
  responsible: 'Sos responsable',
  created: 'Tarea nueva',
  prioritized: 'Cambió la prioridad',
  scheduled: 'Se reprogramó',
  shared: 'Compartieron con vos',
};

export const MOTIVO_GENERICO = 'Novedad';

export function motivoEnCastellano(motivo: string): string {
  return Object.hasOwn(MOTIVOS, motivo) ? (MOTIVOS[motivo] ?? MOTIVO_GENERICO) : MOTIVO_GENERICO;
}
