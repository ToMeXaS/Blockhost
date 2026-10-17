import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { fakeHttp } from '../test-utils'
import { lanIps, PUBLIC_IP_URL, publicIp } from './ip'

function iface(address: string, family: 'IPv4' | 'IPv6', internal = false): NetworkInterfaceInfo {
  return { address, family, internal, netmask: '', mac: '', cidr: null } as NetworkInterfaceInfo
}

describe('lanIps', () => {
  it('returns external IPv4 addresses, skipping loopback, IPv6 and link-local', () => {
    expect(
      lanIps({
        Ethernet: [iface('192.168.1.20', 'IPv4'), iface('fe80::1', 'IPv6')],
        Loopback: [iface('127.0.0.1', 'IPv4', true)],
        Other: [iface('169.254.10.2', 'IPv4')]
      })
    ).toEqual(['192.168.1.20'])
  })
})

describe('publicIp', () => {
  it('returns the trimmed IPv4 address', async () => {
    expect(await publicIp(fakeHttp({ [PUBLIC_IP_URL]: '46.249.161.2\n' }))).toBe('46.249.161.2')
  })

  it('returns null for errors or unexpected content', async () => {
    expect(await publicIp(fakeHttp({}))).toBeNull()
    expect(await publicIp(fakeHttp({ [PUBLIC_IP_URL]: '<html>' }))).toBeNull()
  })
})
