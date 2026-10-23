import { describe, expect, it } from 'vitest'
import type { BackupKind } from '../../../shared/types'
import {
  AVATAR_COLORS,
  avatarColor,
  backupHint,
  fillLevel,
  formatAgo,
  formatBytes,
  formatSession,
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

describe('formatSession', () => {
  it.each([
    [0, '<1m'],
    [59_000, '<1m'],
    [48 * 60_000, '48m'],
    [(2 * 60 + 41) * 60_000, '2h 41m'],
    [65 * 60_000, '1h 05m'],
    [27 * 3_600_000, '1d 3h']
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatSession(ms)).toBe(expected)
  })
})

describe('formatAgo', () => {
  const MIN = 60_000
  it('reads naturally at each scale', () => {
    expect(formatAgo(10_000)).toBe('just now')
    expect(formatAgo(5 * MIN)).toBe('5 min ago')
    expect(formatAgo(3 * 60 * MIN)).toBe('3 h ago')
    expect(formatAgo(24 * 60 * MIN)).toBe('1 day ago')
    expect(formatAgo(3 * 24 * 60 * MIN)).toBe('3 days ago')
  })
})

describe('backupHint', () => {
  const HOUR = 3_600_000
  const now = Date.parse('2026-10-24T12:00:00Z')
  const at = (ms: number) => new Date(now - ms).toISOString()
  const item = (kind: BackupKind, ago: number) => ({
    file: `${kind}-${ago}.zip`,
    kind,
    createdAt: at(ago),
    bytes: 1
  })
  const list = (items: ReturnType<typeof item>[]) => ({ items, lastAutoFailure: null })

  it('counts down to the next automatic backup while running', () => {
    const hint = backupHint(list([item('auto', HOUR + 46 * 60_000)]), 3, true, now)
    expect(hint).toEqual({ text: 'Next backup in 1h 14m', warn: false })
  })

  it('ignores manual backups for the countdown', () => {
    const hint = backupHint(list([item('manual', 0), item('auto', 2 * HOUR)]), 3, true, now)
    expect(hint.text).toBe('Next backup in 1h 00m')
  })

  it('says soon when one is due or none has run', () => {
    expect(backupHint(list([]), 3, true, now).text).toBe('Next backup soon')
    expect(backupHint(list([item('auto', 4 * HOUR)]), 3, true, now).text).toBe('Next backup soon')
  })

  it('falls back to the last backup when off or stopped', () => {
    expect(backupHint(list([item('manual', 3 * HOUR)]), null, true, now).text).toBe(
      'Last backup 3 h ago'
    )
    expect(backupHint(list([item('auto', 5 * 60_000)]), 3, false, now).text).toBe(
      'Last backup 5 min ago'
    )
    expect(backupHint(list([]), null, false, now).text).toBe('No backups yet')
  })

  it('warns when the last automatic backup failed', () => {
    const failed = { items: [], lastAutoFailure: { at: at(0), message: 'disk full' } }
    expect(backupHint(failed, 3, true, now)).toEqual({
      text: 'Last automatic backup failed',
      warn: true
    })
  })
})
