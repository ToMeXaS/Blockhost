import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type { HttpClient } from './http'

export const PUBLIC_IP_URL = 'https://api.ipify.org'

export function lanIps(
  ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): string[] {
  const out: string[] = []
  for (const list of Object.values(ifaces)) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
        out.push(addr.address)
      }
    }
  }
  return out
}

export async function publicIp(http: HttpClient): Promise<string | null> {
  try {
    const text = (await http.getText(PUBLIC_IP_URL)).trim()
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(text) ? text : null
  } catch {
    return null
  }
}
