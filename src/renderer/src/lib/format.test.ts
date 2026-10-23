import { describe, expect, it } from 'vitest'
import {
  AVATAR_COLORS,
  avatarColor,
  fillLevel,
  formatBytes,
  formatUptime,
  javaLabel,
  serverAddress
} from './format'

describe('formatUptime', () => {
  it.each([
    [-5, '0s'],
    [0, '0s'],
    [45_000, '45s'],
    [125_000, '2m 5s'],
    [3_725_000, '1h 2m'],
    [90_000_000, '1d 1h']
  ])('%i ms → %s', (ms, expected) => {
    expect(formatUptime(ms)).toBe(expected)
  })
})

describe('avatarColor', () => {
  it('is stable and from the palette', () => {
    expect(avatarColor('Steve')).toBe(avatarColor('Steve'))
    expect(AVATAR_COLORS).toContain(avatarColor('Steve'))
    expect(AVATAR_COLORS).toContain(avatarColor(''))
  })
})

describe('serverAddress', () => {
  it('uses the tunnel address when shared', () => {
    expect(
      serverAddress({ port: 25565, tunnel: { enabled: true, address: 'abc.joinmc.link' } })
    ).toBe('abc.joinmc.link')
  })

  it('falls back to localhost and the port', () => {
    expect(serverAddress({ port: 25570 })).toBe('localhost:25570')
    expect(serverAddress({ port: 25570, tunnel: { enabled: false, address: 'x.y' } })).toBe(
      'localhost:25570'
    )
    expect(serverAddress({ port: 25570, tunnel: { enabled: true } })).toBe('localhost:25570')
  })
})

describe('javaLabel', () => {
  it('says auto without a custom path', () => {
    expect(javaLabel(undefined)).toBe('Java auto')
  })

  it('shows the custom file name', () => {
    expect(javaLabel('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe')).toBe('java.exe')
    expect(javaLabel('/usr/bin/java')).toBe('java')
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2 KB'],
    [1.8 * 1024 ** 3, '1.8 GB'],
    [212 * 1024 ** 3, '212 GB'],
    [2.5 * 1024 ** 4, '2.5 TB']
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('fillLevel', () => {
  it.each([
    [0.5, 'ok'],
    [0.9, 'ok'],
    [0.91, 'warn'],
    [1, 'over'],
    [1.2, 'over']
  ] as const)('%d → %s', (ratio, expected) => {
    expect(fillLevel(ratio)).toBe(expected)
  })
})
