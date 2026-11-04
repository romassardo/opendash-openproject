import { crearApp } from './app.js';
import { clientePara } from './auth/clientes.js';
import { cargarConfig, entornoDeArranque } from './config.js';
import { abrirDb } from './db/conexion.js';
import { direccionesDeAcceso } from './direcciones.js';
import { crearClienteOp } from './openproject/cliente.js';
import { crearServicioCalendario } from './calendario/servicio.js';
import { crearServicioFeriados } from './feriados/servicio.js';
import { crearServicioHoras } from './horas/servicio.js';
import { crearRegistro } from './registro.js';
import { usuariosActivos } from './sync/activos.js';
import { crearCache } from './sync/cache.js';
import { crearServicioSync } from './sync/servicio.js';

const config = cargarConfig(entornoDeArranque(process.env, process.argv.slice(2)));
const db = abrirDb(config.rutaDb);
const registro = crearRegistro(config.produccion);
if (config.desfaseRelojMs !== 0) {
  registro.warn(`[config] ATENCION: el reloj del servidor está corrido ${Math.round(config.desfaseRelojMs / 1000)} s por OPENDASH_AHORA_PRUEBA; es solo para pruebas, no usar en producción`);
}
const ahora = (): Date => new Date(Date.now() + config.desfaseRelojMs);
const crearCliente = (token: string) => crearClienteOp({ baseUrl: config.openprojectUrl, token, registro });

const sync = crearServicioSync({
  db,
  cache: crearCache(db, ahora),
  clientePara: (usuarioId) => clientePara({ config, db, crearCliente, registro }, usuarioId),
  ahora,
  usuariosActivos: () => usuariosActivos(db, ahora()),
  registro,
});

const calendario = crearServicioCalendario({ db, config, ahora, registro });

const feriados = crearServicioFeriados({ db, config, ahora, registro });

const horas = crearServicioHoras({ db, ahora, registro, clientePara: (usuarioId) => clientePara({ config, db, crearCliente, registro }, usuarioId) });

const app = await crearApp({ config, db, crearCliente, ahora, sync, registro, calendario, feriados });
app.addHook('onClose', async () => {
  sync.detener();
  calendario.detener();
  feriados.detener();
  horas.detener();
});
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ port: config.puerto, host: config.host });
sync.iniciar();
calendario.iniciar();
feriados.iniciar();
horas.iniciar();
if (config.icsOrigenesPrueba.length > 0) {
  registro.warn(`[calendario] OPENDASH_ICS_ORIGENES_PRUEBA activo (${config.icsOrigenesPrueba.join(', ')}): solo para pruebas, no usar en producción`);
}
const direcciones = direccionesDeAcceso(config.host, config.puerto);
console.log(`OpenDash escuchando${config.produccion ? '' : ' (desarrollo)'} en:\n${direcciones.map((d) => `  ${d}`).join('\n')}`);
