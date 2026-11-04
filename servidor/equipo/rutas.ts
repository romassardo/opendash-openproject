import type { FastifyInstance } from 'fastify';
import { exito } from '../../compartido/api.js';
import { SEMANAS_CARGA_MAXIMAS } from '../../compartido/calendario.js';
import { hoyArgentina, semanaDe, sumarDias } from '../../compartido/fechas.js';
import { presenciaDe } from '../../compartido/presencia.js';
import type { MiembroEquipo, Vacaciones } from '../../compartido/tipos.js';
import { leerMetricas } from '../ajustes/repositorio.js';
import type { DepsApp } from '../app.js';
import { requerirSesion } from '../auth/rutas.js';
import { enReunion, horasReunionPorSemana } from '../calendario/horas.js';
import { leerCache } from '../calendario/repositorio.js';
import { fechasFeriado } from '../feriados/repositorio.js';
import { crearCache } from '../sync/cache.js';
import { enMarchaPorUsuario } from '../horas/repositorio.js';
import { personasVisibles, tareaVisible } from '../tareas/visibilidad.js';
import { vacacionesDeTodos } from '../vacaciones/repositorio.js';

type DepsEquipo = Pick<DepsApp, 'db' | 'ahora' | 'sync' | 'config'>;

interface FilaUsuario { id: number; rol: string; capacidad_horas: number; ultima_actividad: string | null }

const DIAS_HABILES = 5;

const diasDe = (v: Vacaciones, desde: string, hasta: string): string[] => {
  const dias: string[] = [];
  for (let d = v.desde > desde ? v.desde : desde; d <= v.hasta && d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  return dias;
};

export function registrarRutasEquipo(app: FastifyInstance, deps: DepsEquipo): void {
  const cache = crearCache(deps.db, deps.ahora);
  const sesion = requerirSesion(deps);

  app.get('/api/equipo', { preHandler: sesion }, async (req) => {
    const ahora = deps.ahora();
    const usuarioId = req.usuario!.id;
    const personas = personasVisibles(cache, usuarioId);
    const proyectos = new Set(cache.proyectosDe(usuarioId));
    const enMarcha = enMarchaPorUsuario(deps.db);
    const hoy = hoyArgentina(ahora);
    const { lunes } = semanaDe(hoy);
    const finSemanas = sumarDias(lunes, 7 * SEMANAS_CARGA_MAXIMAS - 1);
    const restar = leerMetricas(deps.db).restarReuniones;
    const feriados = restar ? fechasFeriado(deps.db, lunes, finSemanas) : new Set<string>();
    const vacaciones = vacacionesDeTodos(deps.db, lunes);
    const filas = deps.db.prepare('select id, rol, capacidad_horas, ultima_actividad from usuarios order by id').all() as FilaUsuario[];
    const equipo = filas
      .filter((f) => personas.has(f.id))
      .map((f): MiembroEquipo => {
        const enCurso = enMarcha.get(f.id) ?? [];
        const trabajandoEn = enCurso.filter((id) => tareaVisible(cache, proyectos, id));
        const trabajando = enCurso.length > 0;
        const suyas = vacaciones.get(f.id) ?? [];
        const calendario = leerCache(deps.db, deps.config.claveCifrado, f.id);
        const reuniones = calendario?.reuniones ?? [];
        const deVacaciones = suyas.some((v) => v.desde <= hoy && hoy <= v.hasta);
        return {
          personaId: f.id,
          presencia: presenciaDe(f.ultima_actividad, trabajando, ahora, { enReunion: enReunion(reuniones, ahora), deVacaciones }),
          rol: f.rol,
          capacidadHoras: f.capacidad_horas,
          // No se revela en qué tarea trabaja alguien si esta persona no la ve.
          trabajandoEn,
          vacaciones: suyas.map(({ desde, hasta }) => ({ desde, hasta })),
          // Solo salen las horas por semana: nunca títulos, lugares, enlaces ni horarios.
          reunionesPorSemana: !restar ? null
            : calendario === null || calendario.ventana === null ? 'sin-calendario'
              : horasReunionPorSemana(reuniones, lunes, SEMANAS_CARGA_MAXIMAS, f.capacidad_horas / DIAS_HABILES,
                new Set([...feriados, ...suyas.flatMap((v) => diasDe(v, lunes, finSemanas))])),
        };
      });
    return exito(equipo, deps.sync.estado().desactualizado);
  });
}
