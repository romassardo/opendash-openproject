import type { Database } from 'better-sqlite3';

const MIGRACIONES: readonly string[] = [
  `
  CREATE TABLE usuarios (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL,
    hash TEXT NOT NULL, token_cifrado TEXT NOT NULL, token_vencido INTEGER NOT NULL DEFAULT 0,
    tema TEXT NOT NULL DEFAULT 'oscuro', fijados TEXT NOT NULL DEFAULT '[]',
    creado TEXT NOT NULL, ultima_actividad TEXT);
  CREATE TABLE sesiones (id TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, vence TEXT NOT NULL);
  CREATE TABLE usuario_proyectos (usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, proyecto_id INTEGER NOT NULL, PRIMARY KEY (usuario_id, proyecto_id));
  CREATE TABLE intentos_ingreso (login TEXT NOT NULL, momento TEXT NOT NULL);
  CREATE TABLE cache_catalogo (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, actualizado TEXT NOT NULL);
  CREATE TABLE cache_tareas (id INTEGER PRIMARY KEY, proyecto_id INTEGER NOT NULL, datos TEXT NOT NULL, actualizada TEXT NOT NULL);
  CREATE INDEX cache_tareas_proyecto ON cache_tareas(proyecto_id);
  CREATE TABLE cache_dependencias (id INTEGER PRIMARY KEY, sucesora_id INTEGER NOT NULL, predecesora_id INTEGER NOT NULL, lag INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE cierres (tarea_id INTEGER PRIMARY KEY, cerrada_el TEXT NOT NULL);
  CREATE TABLE comentarios_cuenta (tarea_id INTEGER PRIMARY KEY, cantidad INTEGER NOT NULL);
  CREATE TABLE estado_sync (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  `,
  `
  CREATE INDEX sesiones_usuario ON sesiones(usuario_id);
  CREATE INDEX intentos_login_momento ON intentos_ingreso(login, momento);
  `,
  // Momento (con nuestro reloj) en que se guardó cada fila de la caché: separa una copia más vieja que
  // llegó tarde de una base de OpenProject restaurada.
  `
  ALTER TABLE cache_tareas ADD COLUMN guardada TEXT;
  `,
  // Desde qué IP se intentó ingresar: el tope por IP frena el barrido de logins sin bloquear a la persona.
  `
  ALTER TABLE intentos_ingreso ADD COLUMN ip TEXT;
  CREATE INDEX intentos_ip_momento ON intentos_ingreso(ip, momento);
  `,
  // Etapa 1B: ajustes propios, calendario ICS cifrado, sesiones de foco, estilo de proyecto y ajustes del equipo.
  `
  ALTER TABLE usuarios ADD COLUMN rol TEXT NOT NULL DEFAULT '';
  ALTER TABLE usuarios ADD COLUMN capacidad_horas REAL NOT NULL DEFAULT 40;
  ALTER TABLE usuarios ADD COLUMN meta_foco_horas REAL NOT NULL DEFAULT 2;
  ALTER TABLE usuarios ADD COLUMN ics_cifrado TEXT;
  CREATE TABLE sesiones_foco (id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tarea_id INTEGER, minutos INTEGER NOT NULL, inicio TEXT NOT NULL, pausada_desde TEXT, pausa_ms INTEGER NOT NULL DEFAULT 0, fin TEXT);
  CREATE INDEX sesiones_foco_inicio ON sesiones_foco(inicio);
  CREATE UNIQUE INDEX sesiones_foco_abierta ON sesiones_foco(usuario_id) WHERE fin IS NULL;
  CREATE TABLE proyecto_estilo (proyecto_id INTEGER PRIMARY KEY, color TEXT NOT NULL, icono TEXT NOT NULL);
  CREATE TABLE ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  `,
  // Etapa 3: caché cifrada del calendario, vacaciones y feriados (lista traída más ajustes manuales).
  `
  CREATE TABLE calendario_cache (usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    reuniones_cifradas TEXT, ventana TEXT, leido TEXT, intento TEXT NOT NULL, falla TEXT);
  CREATE TABLE vacaciones (id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    desde TEXT NOT NULL, hasta TEXT NOT NULL);
  CREATE INDEX vacaciones_usuario ON vacaciones(usuario_id, hasta);
  CREATE TABLE feriados_lista (fecha TEXT PRIMARY KEY, nombre TEXT NOT NULL, puente INTEGER NOT NULL);
  CREATE TABLE feriados_ajustes (fecha TEXT PRIMARY KEY, accion TEXT NOT NULL CHECK (accion IN ('agregar', 'quitar')), nombre TEXT);
  `,
  // Línea de tiempo pulida: orden compartido de la lista.
  `
  CREATE TABLE orden_linea (contenedor TEXT NOT NULL, tarea_id INTEGER NOT NULL, posicion INTEGER NOT NULL, PRIMARY KEY (contenedor, tarea_id));
  `,
  // Horas de trabajo: tramos por tarea y sus pedazos activos (entre ▶ y ⏸). El foco queda sin uso.
  `
  CREATE TABLE tramos_trabajo (id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tarea_id INTEGER NOT NULL, dia TEXT NOT NULL, inicio TEXT NOT NULL, fin TEXT, segundos INTEGER,
    frenado_solo TEXT CHECK (frenado_solo IN ('tope', 'medianoche')), aviso_visto INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'pendiente', 'cargado', 'rechazado', 'descartado')),
    entrada_op_id INTEGER, motivo TEXT, creado TEXT NOT NULL);
  CREATE INDEX tramos_usuario_dia ON tramos_trabajo(usuario_id, dia);
  CREATE UNIQUE INDEX tramos_abierto ON tramos_trabajo(usuario_id, tarea_id) WHERE fin IS NULL;
  CREATE TABLE pedazos_trabajo (id INTEGER PRIMARY KEY, tramo_id INTEGER NOT NULL REFERENCES tramos_trabajo(id) ON DELETE CASCADE,
    desde TEXT NOT NULL, hasta TEXT);
  CREATE INDEX pedazos_tramo ON pedazos_trabajo(tramo_id);
  ALTER TABLE usuarios ADD COLUMN varias_a_la_vez INTEGER NOT NULL DEFAULT 0;
  `,
  // Avisos de problemas: texto, contexto y una imagen opcional, con su estado para quienes los reciben.
  `
  CREATE TABLE avisos_problema (id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creado TEXT NOT NULL, texto TEXT NOT NULL, contexto TEXT NOT NULL, imagen BLOB, imagen_tipo TEXT,
    estado TEXT NOT NULL DEFAULT 'nuevo' CHECK (estado IN ('nuevo', 'visto', 'arreglado')), marcado_por INTEGER, marcado_el TEXT);
  CREATE INDEX avisos_problema_usuario ON avisos_problema(usuario_id, creado);
  `,
  // Aviso antes de cada reunión: minutos de anticipación por persona (NULL = no avisar).
  `
  ALTER TABLE usuarios ADD COLUMN aviso_reunion_min INTEGER DEFAULT 5;
  `,
  // Pausas de tareas (como «Dividir tarea» de Project): después de `despues` días hábiles de trabajo, `dias` sin trabajo.
  `
  CREATE TABLE pausas_tarea (id INTEGER PRIMARY KEY, tarea_id INTEGER NOT NULL, despues INTEGER NOT NULL CHECK (despues >= 1),
    dias INTEGER NOT NULL CHECK (dias >= 1), creada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, creada TEXT NOT NULL);
  CREATE INDEX pausas_tarea_tarea ON pausas_tarea(tarea_id);
  `,
  // Horas de trabajo: con varias a la vez cada tarea cuenta su tiempo entero. `medidos` es lo medido al cerrar, para
  // que una corrección a mano mueva el día solo en la diferencia; los tramos de antes quedan como estaban.
  `
  ALTER TABLE tramos_trabajo ADD COLUMN medidos INTEGER;
  UPDATE tramos_trabajo SET medidos = segundos WHERE fin IS NOT NULL;
  `,
  // Horas extra: el día en que la persona confirmó seguir después del tope. Ese día el tope no frena ni bloquea.
  `
  CREATE TABLE horas_extra (usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, dia TEXT NOT NULL,
    confirmado TEXT NOT NULL, PRIMARY KEY (usuario_id, dia));
  `,
];

export function migrar(db: Database): void {
  const actual = db.pragma('user_version', { simple: true }) as number;
  for (let version = actual; version < MIGRACIONES.length; version++) {
    const sql = MIGRACIONES[version] as string;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
