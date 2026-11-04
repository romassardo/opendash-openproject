import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

// Adaptadores virtuales (WSL, Hyper-V, máquinas virtuales): desde otra PC no se llega por ahí.
const VIRTUALES = /vEthernet|WSL|Hyper-V|Loopback|VirtualBox|VMware/i;

/**
 * Direcciones para entrar a OpenDash. Escuchando en toda la red (`0.0.0.0` o `::`): localhost y las IP
 * de la red de esta PC; con una interfaz elegida, esa.
 */
export function direccionesDeAcceso(
  host: string,
  puerto: number,
  interfaces: Partial<Record<string, NetworkInterfaceInfo[]>> = networkInterfaces(),
): string[] {
  if (host !== '0.0.0.0' && host !== '::') return [`http://${host.includes(':') ? `[${host}]` : host}:${puerto}`];
  const ips = Object.entries(interfaces)
    .filter(([nombre]) => !VIRTUALES.test(nombre))
    .flatMap(([, direcciones]) => direcciones ?? [])
    .filter((d) => d.family === 'IPv4' && !d.internal && !d.address.startsWith('169.254.'))
    .map((d) => d.address);
  return [`http://localhost:${puerto}`, ...[...new Set(ips)].map((ip) => `http://${ip}:${puerto}`)];
}
