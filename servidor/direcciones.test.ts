import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { direccionesDeAcceso } from './direcciones.js';

const ipv4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal }) as NetworkInterfaceInfo;
const ipv6 = (address: string) => ({ address, family: 'IPv6', internal: false }) as NetworkInterfaceInfo;

const INTERFACES: Record<string, NetworkInterfaceInfo[]> = {
  'Ethernet': [ipv6('fe80::1'), ipv4('192.168.1.40')],
  'Wi-Fi': [ipv4('10.0.0.77'), ipv4('169.254.10.2')],
  'vEthernet (WSL)': [ipv4('172.20.0.1')],
  'Loopback Pseudo-Interface 1': [ipv4('127.0.0.1', true)],
};

describe('direccionesDeAcceso', () => {
  it('escuchando en toda la red muestra localhost y las IP de la red, sin 0.0.0.0', () => {
    expect(direccionesDeAcceso('0.0.0.0', 5174, INTERFACES)).toEqual([
      'http://localhost:5174',
      'http://192.168.1.40:5174',
      'http://10.0.0.77:5174',
    ]);
  });

  it('sin red solo queda localhost', () => {
    expect(direccionesDeAcceso('0.0.0.0', 5174, {})).toEqual(['http://localhost:5174']);
  });

  it('con una interfaz elegida muestra esa', () => {
    expect(direccionesDeAcceso('127.0.0.1', 5199, INTERFACES)).toEqual(['http://127.0.0.1:5199']);
  });
});
