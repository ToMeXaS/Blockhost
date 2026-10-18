import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import {
  banTimestamp,
  hasName,
  readList,
  toIpBans,
  toOps,
  toPlayerBans,
  toWhitelist,
  writeList
} from './files'

// Shapes as written by a vanilla 1.21 server.
const OPS = `[
  {
    "uuid": "5627dd98-e6be-3c21-b8a8-e92344183641",
    "name": "Steve",
    "level": 4,
    "bypassesPlayerLimit": false
  }
]`
const BANNED_PLAYERS = `[
  {
    "uuid": "b50ad385-829d-3141-a216-7e7d7539ba7f",
    "name": "Notch",
    "created": "2026-10-18 14:03:00 +0000",
    "source": "Server",
    "expires": "forever",
    "reason": "Banned by an operator."
  }
]`
const BANNED_IPS = `[
  {
    "ip": "203.0.113.7",
    "created": "2026-10-18 14:03:00 +0000",
    "source": "Server",
    "expires": "forever",
    "reason": "Alt accounts"
  }
]`

describe('readList', () => {
  it('reads and maps the vanilla formats', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'ops.json'), OPS)
    await writeFile(join(dir, 'banned-players.json'), BANNED_PLAYERS)
    await writeFile(join(dir, 'banned-ips.json'), BANNED_IPS)
    await writeFile(join(dir, 'whitelist.json'), '[{"uuid":"u1","name":"Alex"}]')

    expect(toOps((await readList(dir, 'ops')).entries)).toEqual([
      { uuid: '5627dd98-e6be-3c21-b8a8-e92344183641', name: 'Steve', level: 4 }
    ])
    expect(toWhitelist((await readList(dir, 'whitelist')).entries)).toEqual([
      { uuid: 'u1', name: 'Alex' }
    ])
    expect(toPlayerBans((await readList(dir, 'bannedPlayers')).entries)).toEqual([
      {
        uuid: 'b50ad385-829d-3141-a216-7e7d7539ba7f',
        name: 'Notch',
        reason: 'Banned by an operator.',
        created: '2026-10-18 14:03:00 +0000'
      }
    ])
    expect(toIpBans((await readList(dir, 'bannedIps')).entries)).toEqual([
      { ip: '203.0.113.7', reason: 'Alt accounts', created: '2026-10-18 14:03:00 +0000' }
    ])
  })

  it('treats a missing or blank file as an empty list', async () => {
    const dir = await tempDir()
    expect(await readList(dir, 'ops')).toEqual({ entries: [], corrupt: false })
    await writeFile(join(dir, 'whitelist.json'), '  \n')
    expect(await readList(dir, 'whitelist')).toEqual({ entries: [], corrupt: false })
  })

  it('accepts a UTF-8 BOM', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'ops.json'), `﻿${OPS}`)
    expect((await readList(dir, 'ops')).entries).toHaveLength(1)
  })

  it('flags unparseable or wrongly shaped files as corrupt', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'ops.json'), '[{"name": "Steve",')
    expect(await readList(dir, 'ops')).toEqual({ entries: [], corrupt: true })
    await writeFile(join(dir, 'whitelist.json'), '{"name":"Steve"}')
    expect(await readList(dir, 'whitelist')).toEqual({ entries: [], corrupt: true })
    await writeFile(join(dir, 'banned-ips.json'), '["203.0.113.7"]')
    expect(await readList(dir, 'bannedIps')).toEqual({ entries: [], corrupt: true })
  })

  it('propagates an unreadable (but not merely unparseable) file instead of flagging it corrupt', async () => {
    const dir = await tempDir()
    // A directory in place of the file makes the read itself fail (EISDIR),
    // as opposed to succeeding and then failing to parse.
    await mkdir(join(dir, 'ops.json'))
    await expect(readList(dir, 'ops')).rejects.toMatchObject({
      code: 'LIST_FILE_UNREADABLE',
      details: { list: 'ops' }
    })
  })

  it('maps missing fields to safe defaults', () => {
    expect(toOps([{ name: 'Steve' }])).toEqual([{ uuid: '', name: 'Steve', level: 4 }])
    expect(toPlayerBans([{ name: 'X' }])).toEqual([{ uuid: '', name: 'X', reason: '', created: '' }])
  })
})

describe('writeList', () => {
  it('round-trips and preserves unknown fields', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'ops.json'), OPS)
    const { entries } = await readList(dir, 'ops')
    await writeList(dir, 'ops', [...entries, { uuid: 'u2', name: 'Alex', level: 4, bypassesPlayerLimit: false }])

    const written = JSON.parse(await readFile(join(dir, 'ops.json'), 'utf8'))
    expect(written).toEqual([
      {
        uuid: '5627dd98-e6be-3c21-b8a8-e92344183641',
        name: 'Steve',
        level: 4,
        bypassesPlayerLimit: false
      },
      { uuid: 'u2', name: 'Alex', level: 4, bypassesPlayerLimit: false }
    ])
  })
})

describe('helpers', () => {
  it('matches names case-insensitively', () => {
    expect(hasName({ name: 'Steve' }, 'steve')).toBe(true)
    expect(hasName({ name: 'Steve' }, 'Alex')).toBe(false)
    expect(hasName({}, 'Steve')).toBe(false)
  })

  it('formats ban timestamps like the server', () => {
    expect(banTimestamp(new Date('2026-10-18T14:03:09.123Z'))).toBe('2026-10-18 14:03:09 +0000')
    expect(banTimestamp(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02 03:04:05 +0000')
  })
})
