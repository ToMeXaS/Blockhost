# Player Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Players tab that shows who is online and manages ops, whitelist, and bans, whether the server is running (console commands) or stopped (JSON file edits).

**Architecture:** A new `src/main/players/` module: `files.ts` (list-file I/O), `uuid.ts` (name → UUID), `tracker.ts` (online set from log lines), `service.ts` (`PlayerService`, dispatches each action to a console command or a file edit). It is wired into `ProcessManager`'s existing `onStatus`/`onLog` callbacks in `services.ts` and exposed through two zod-validated IPC channels and one event. The renderer gets a `PlayersTab`.

**Tech Stack:** Electron, TypeScript, zod 4, React 19, Tailwind 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-18-player-management-design.md`

## Global Constraints

- Player names: `^[A-Za-z0-9_]{3,16}$`. IPs: `net.isIP(ip) !== 0`. Reasons: max 200 chars, no control characters. Nothing reaching `sendCommand` may contain a newline.
- Running → console command; stopped/crashed → file edit; starting/stopping → `SERVER_BUSY`; kick while not running → `SERVER_NOT_RUNNING`.
- New error codes: `SERVER_BUSY`, `SERVER_NOT_RUNNING`, `PLAYER_NOT_FOUND`, `LIST_FILE_CORRUPT`.
- New ban entries: `source: "Blockhost"`, `expires: "forever"`, default reason `"Banned by an operator."`, `created` formatted `yyyy-MM-dd HH:mm:ss +0000` (UTC).
- New op entries: `level` from `op-permission-level` (1–4, default 4), `bypassesPlayerLimit: false`.
- Unknown fields on existing list entries are preserved on rewrite. Name matching is case-insensitive.
- File-change debounce: 500 ms.
- All writes go through `writeFileAtomic` (`src/main/util/fs.ts`).
- Renderer has no Node access; all side effects stay in the main process.
- No `Co-Authored-By` or other attribution lines in commits.
- Before each commit: `npm run typecheck` and `npm test` pass.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/shared/types.ts` | modify | `PlayerLists`, `PlayerAction`, entry types, `PLAYER_NAME_PATTERN`, `PlayersChangedEvent` |
| `src/main/schemas.ts` | modify | `playerActionSchema` |
| `src/main/net/http.ts` | modify | add `{ status }` details to `HTTP` errors |
| `src/main/players/files.ts` | create | read/write the four list files, typed views, ban timestamp |
| `src/main/players/uuid.ts` | create | offline UUID, Mojang lookup |
| `src/main/players/tracker.ts` | create | `PlayerTracker` online set |
| `src/main/players/service.ts` | create | `PlayerService`, `toCommand`, `defaultWatch` |
| `src/main/services.ts` | modify | construct `PlayerService`, route status/log events |
| `src/main/ipc.ts` | modify | `players:get`, `players:action` |
| `src/shared/api.ts` | modify | channel names, `players:changed` event |
| `src/renderer/src/lib/api.ts` | modify | `getPlayers`, `playerAction` |
| `src/renderer/src/pages/tabs/PlayersTab.tsx` | create | Players tab UI |
| `src/renderer/src/pages/ServerDetail.tsx` | modify | add the tab |
| `src/main/integration/paper.integration.test.ts` | modify | op via service → `ops.json` |
| `docs/smoke-test.md` | modify | Players checklist items |

---

### Task 1: Shared player types and the action schema

**Files:**
- Modify: `src/shared/types.ts` (append at end)
- Modify: `src/main/schemas.ts` (append at end; add imports)
- Test: `src/main/schemas.test.ts` (append a `describe` block)

**Interfaces:**
- Produces (in `src/shared/types.ts`):
  ```ts
  export const PLAYER_NAME_PATTERN: RegExp
  export interface PlayerRef { uuid: string; name: string }
  export interface OpEntry extends PlayerRef { level: number }
  export interface PlayerBan extends PlayerRef { reason: string; created: string }
  export interface IpBan { ip: string; reason: string; created: string }
  export type PlayerListName = 'ops' | 'whitelist' | 'bannedPlayers' | 'bannedIps'
  export interface PlayerLists { online: string[]; ops: OpEntry[]; whitelist: PlayerRef[]; whitelistEnabled: boolean; bannedPlayers: PlayerBan[]; bannedIps: IpBan[]; corrupt: PlayerListName[] }
  export type PlayerAction = { overwriteCorrupt?: boolean } & ( ...ten variants... )
  export interface PlayersChangedEvent { serverId: string }
  ```
- Produces (in `src/main/schemas.ts`): `export const playerActionSchema` (zod discriminated union on `type`).

- [ ] **Step 1: Write the failing tests**

Append to `src/main/schemas.test.ts` (add `playerActionSchema` to the existing import from `./schemas`):

```ts
describe('playerActionSchema', () => {
  it('accepts every action shape', () => {
    const valid = [
      { type: 'op', name: 'Steve' },
      { type: 'deop', name: 'Steve' },
      { type: 'whitelistAdd', name: 'alex_99' },
      { type: 'whitelistRemove', name: 'alex_99' },
      { type: 'setWhitelistEnabled', enabled: true },
      { type: 'ban', name: 'Griefer1', reason: 'Broke the spawn' },
      { type: 'ban', name: 'Griefer1' },
      { type: 'pardon', name: 'Griefer1' },
      { type: 'banIp', ip: '203.0.113.7', reason: 'Alt accounts' },
      { type: 'banIp', ip: '2001:db8::1' },
      { type: 'pardonIp', ip: '203.0.113.7' },
      { type: 'kick', name: 'Steve', reason: 'AFK' },
      { type: 'op', name: 'Steve', overwriteCorrupt: true }
    ]
    for (const action of valid) expect(playerActionSchema.parse(action)).toEqual(action)
  })

  it('rejects names that are not Minecraft usernames', () => {
    for (const name of ['ab', 'a'.repeat(17), 'Steve stop', 'Steve\nstop', 'Stéve', '']) {
      expect(() => playerActionSchema.parse({ type: 'op', name })).toThrow()
    }
  })

  it('rejects reasons that could inject a second command', () => {
    for (const reason of ['bye\nstop', 'bye\rstop', 'x\u0000', 'r'.repeat(201)]) {
      expect(() => playerActionSchema.parse({ type: 'ban', name: 'Steve', reason })).toThrow()
    }
  })

  it('rejects invalid IPs', () => {
    for (const ip of ['300.1.1.1', 'example.com', '1.2.3.4 stop', '']) {
      expect(() => playerActionSchema.parse({ type: 'banIp', ip })).toThrow()
    }
  })

  it('rejects unknown types and extra fields', () => {
    expect(() => playerActionSchema.parse({ type: 'nuke', name: 'Steve' })).toThrow()
    expect(() => playerActionSchema.parse({ type: 'op', name: 'Steve', level: 4 })).toThrow()
    expect(() => playerActionSchema.parse({ type: 'pardon', name: 'Steve', reason: 'x' })).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/schemas.test.ts`
Expected: FAIL — `playerActionSchema` is not exported.

- [ ] **Step 3: Add the shared types**

Append to `src/shared/types.ts`:

```ts
/** Minecraft Java usernames: 3–16 letters, digits or underscores. */
export const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/

export interface PlayerRef {
  uuid: string
  name: string
}

export interface OpEntry extends PlayerRef {
  level: number
}

export interface PlayerBan extends PlayerRef {
  reason: string
  created: string
}

export interface IpBan {
  ip: string
  reason: string
  created: string
}

export type PlayerListName = 'ops' | 'whitelist' | 'bannedPlayers' | 'bannedIps'

export interface PlayerLists {
  /** Empty unless the server is running. */
  online: string[]
  ops: OpEntry[]
  whitelist: PlayerRef[]
  whitelistEnabled: boolean
  bannedPlayers: PlayerBan[]
  bannedIps: IpBan[]
  /** Lists whose file could not be parsed (shown as empty). */
  corrupt: PlayerListName[]
}

export type PlayerAction = {
  /** Stopped servers only: replace a list file that could not be parsed. */
  overwriteCorrupt?: boolean
} & (
  | { type: 'op'; name: string }
  | { type: 'deop'; name: string }
  | { type: 'whitelistAdd'; name: string }
  | { type: 'whitelistRemove'; name: string }
  | { type: 'setWhitelistEnabled'; enabled: boolean }
  | { type: 'ban'; name: string; reason?: string }
  | { type: 'pardon'; name: string }
  | { type: 'banIp'; ip: string; reason?: string }
  | { type: 'pardonIp'; ip: string }
  | { type: 'kick'; name: string; reason?: string }
)

export interface PlayersChangedEvent {
  serverId: string
}
```

- [ ] **Step 4: Add the schema**

In `src/main/schemas.ts`, add `import { isIP } from 'node:net'` next to the existing `node:path` import, change the types import to `import { PLAYER_NAME_PATTERN, SERVER_TYPES } from '../shared/types'`, then append:

```ts
const playerNameSchema = z
  .string()
  .regex(PLAYER_NAME_PATTERN, 'Player names are 3–16 letters, numbers or underscores')
const ipSchema = z
  .string()
  .max(45)
  .refine((ip) => isIP(ip) !== 0, 'Not a valid IP address')
const reasonSchema = z
  .string()
  .max(200)
  .regex(/^\P{Cc}*$/u, 'The reason must be a single line')
  .optional()
const overwriteCorrupt = z.boolean().optional()

const nameAction = <T extends string>(type: T) =>
  z.strictObject({ type: z.literal(type), name: playerNameSchema, overwriteCorrupt })
const nameReasonAction = <T extends string>(type: T) =>
  z.strictObject({
    type: z.literal(type),
    name: playerNameSchema,
    reason: reasonSchema,
    overwriteCorrupt
  })

export const playerActionSchema = z.discriminatedUnion('type', [
  nameAction('op'),
  nameAction('deop'),
  nameAction('whitelistAdd'),
  nameAction('whitelistRemove'),
  nameAction('pardon'),
  nameReasonAction('ban'),
  nameReasonAction('kick'),
  z.strictObject({ type: z.literal('banIp'), ip: ipSchema, reason: reasonSchema, overwriteCorrupt }),
  z.strictObject({ type: z.literal('pardonIp'), ip: ipSchema, overwriteCorrupt }),
  z.strictObject({ type: z.literal('setWhitelistEnabled'), enabled: z.boolean(), overwriteCorrupt })
])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/schemas.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass.

```bash
git add src/shared/types.ts src/main/schemas.ts src/main/schemas.test.ts
git commit -m "feat: add player management types and action schema"
```

---

### Task 2: List files (`files.ts`)

**Files:**
- Create: `src/main/players/files.ts`
- Test: `src/main/players/files.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic`, `pathExists` from `src/main/util/fs.ts`; `PlayerListName`, `OpEntry`, `PlayerRef`, `PlayerBan`, `IpBan` from Task 1.
- Produces:
  ```ts
  export const LIST_FILES: Record<PlayerListName, string>
  export type RawEntry = Record<string, unknown>
  export interface ListFile { entries: RawEntry[]; corrupt: boolean }
  export function readList(dir: string, list: PlayerListName): Promise<ListFile>
  export function writeList(dir: string, list: PlayerListName, entries: RawEntry[]): Promise<void>
  export function toOps(entries: RawEntry[]): OpEntry[]
  export function toWhitelist(entries: RawEntry[]): PlayerRef[]
  export function toPlayerBans(entries: RawEntry[]): PlayerBan[]
  export function toIpBans(entries: RawEntry[]): IpBan[]
  export function hasName(entry: RawEntry, name: string): boolean  // case-insensitive
  export function banTimestamp(date: Date): string                 // 'yyyy-MM-dd HH:mm:ss +0000'
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/main/players/files.test.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises'
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/players/files.test.ts`
Expected: FAIL — cannot resolve `./files`.

- [ ] **Step 3: Implement `files.ts`**

Create `src/main/players/files.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IpBan, OpEntry, PlayerBan, PlayerListName, PlayerRef } from '../../shared/types'
import { pathExists, writeFileAtomic } from '../util/fs'

export const LIST_FILES: Record<PlayerListName, string> = {
  ops: 'ops.json',
  whitelist: 'whitelist.json',
  bannedPlayers: 'banned-players.json',
  bannedIps: 'banned-ips.json'
}

export type RawEntry = Record<string, unknown>

export interface ListFile {
  entries: RawEntry[]
  corrupt: boolean
}

const isEntry = (value: unknown): value is RawEntry =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

export async function readList(dir: string, list: PlayerListName): Promise<ListFile> {
  const file = join(dir, LIST_FILES[list])
  if (!(await pathExists(file))) return { entries: [], corrupt: false }
  try {
    const text = (await readFile(file, 'utf8')).replace(/^﻿/, '')
    if (text.trim() === '') return { entries: [], corrupt: false }
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed) || !parsed.every(isEntry)) return { entries: [], corrupt: true }
    return { entries: parsed, corrupt: false }
  } catch {
    return { entries: [], corrupt: true }
  }
}

export async function writeList(
  dir: string,
  list: PlayerListName,
  entries: RawEntry[]
): Promise<void> {
  await writeFileAtomic(join(dir, LIST_FILES[list]), `${JSON.stringify(entries, null, 2)}\n`)
}

export function toOps(entries: RawEntry[]): OpEntry[] {
  return entries.map((e) => ({
    uuid: str(e.uuid),
    name: str(e.name),
    level: typeof e.level === 'number' ? e.level : 4
  }))
}

export function toWhitelist(entries: RawEntry[]): PlayerRef[] {
  return entries.map((e) => ({ uuid: str(e.uuid), name: str(e.name) }))
}

export function toPlayerBans(entries: RawEntry[]): PlayerBan[] {
  return entries.map((e) => ({
    uuid: str(e.uuid),
    name: str(e.name),
    reason: str(e.reason),
    created: str(e.created)
  }))
}

export function toIpBans(entries: RawEntry[]): IpBan[] {
  return entries.map((e) => ({ ip: str(e.ip), reason: str(e.reason), created: str(e.created) }))
}

export function hasName(entry: RawEntry, name: string): boolean {
  return str(entry.name).toLowerCase() === name.toLowerCase()
}

/** The server's ban date format (`yyyy-MM-dd HH:mm:ss Z`), written in UTC. */
export function banTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} +0000`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/players/files.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass.

```bash
git add src/main/players/files.ts src/main/players/files.test.ts
git commit -m "feat: read and write player list files"
```

---

### Task 3: Username → UUID (`uuid.ts`)

**Files:**
- Modify: `src/main/net/http.ts:31` (HTTP error details)
- Create: `src/main/players/uuid.ts`
- Test: `src/main/players/uuid.test.ts`, `src/main/net/http.test.ts` (one new test)

**Interfaces:**
- Consumes: `HttpClient` (`getText`) from `src/main/net/http.ts`; `AppError`; `PlayerRef` from Task 1.
- Produces:
  ```ts
  export const MOJANG_PROFILE_URL = 'https://api.mojang.com/users/profiles/minecraft/'
  export function formatUuid(hex: string): string            // 32 hex → dashed, lowercase
  export function offlineUuid(name: string): string           // matches Java UUID.nameUUIDFromBytes("OfflinePlayer:"+name)
  export function lookupPlayer(http: HttpClient, name: string, onlineMode: boolean): Promise<PlayerRef>
  ```
- Also produces: `HTTP` `AppError`s now carry `details: { status: number }`.

- [ ] **Step 1: Write the failing tests**

Add to `src/main/net/http.test.ts`, inside its top-level `describe` (it already has a `jsonResponse(body, status)` helper; build the client the same way the neighbouring tests do, with `createHttpClient({ fetchImpl })`):

```ts
it('includes the status code in HTTP errors', async () => {
  const fetchImpl = (async () => jsonResponse({}, 404)) as unknown as typeof fetch
  const http = createHttpClient({ fetchImpl })
  await expect(http.getText('https://api.example.com/x')).rejects.toMatchObject({
    code: 'HTTP',
    details: { status: 404 }
  })
})
```

Create `src/main/players/uuid.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AppError } from '../errors'
import type { HttpClient } from '../net/http'
import { formatUuid, lookupPlayer, MOJANG_PROFILE_URL, offlineUuid } from './uuid'

function http(getText: (url: string) => Promise<string>): HttpClient & { urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    getJson: async () => {
      throw new Error('getJson must not be used for profile lookups')
    },
    getText: async (url) => {
      urls.push(url)
      return getText(url)
    }
  }
}

describe('offlineUuid', () => {
  // Expected values produced by Java's UUID.nameUUIDFromBytes("OfflinePlayer:<name>"),
  // which is what offline-mode servers use.
  it('matches the server derivation', () => {
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f')
    expect(offlineUuid('Steve')).toBe('5627dd98-e6be-3c21-b8a8-e92344183641')
  })
})

describe('formatUuid', () => {
  it('inserts dashes and lowercases', () => {
    expect(formatUuid('069A79F444E94726A5BEFCA90E38AAF5')).toBe(
      '069a79f4-44e9-4726-a5be-fca90e38aaf5'
    )
  })
})

describe('lookupPlayer', () => {
  it('uses the offline UUID without the network when online mode is off', async () => {
    const client = http(async () => {
      throw new Error('no network expected')
    })
    expect(await lookupPlayer(client, 'Steve', false)).toEqual({
      uuid: '5627dd98-e6be-3c21-b8a8-e92344183641',
      name: 'Steve'
    })
    expect(client.urls).toEqual([])
  })

  it('looks the name up at Mojang and keeps the canonical spelling', async () => {
    const client = http(async () => '{"id":"069a79f444e94726a5befca90e38aaf5","name":"Notch"}')
    expect(await lookupPlayer(client, 'notch', true)).toEqual({
      uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
      name: 'Notch'
    })
    expect(client.urls).toEqual([`${MOJANG_PROFILE_URL}notch`])
  })

  it('reports unknown names as PLAYER_NOT_FOUND', async () => {
    const notFound = http(async () => {
      throw new AppError('HTTP', 'api.mojang.com returned HTTP 404', { status: 404 })
    })
    await expect(lookupPlayer(notFound, 'Nobody_123', true)).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND',
      message: 'No Minecraft account named Nobody_123'
    })
    const empty = http(async () => '')
    await expect(lookupPlayer(empty, 'Nobody_123', true)).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND'
    })
  })

  it('explains that offline mode avoids the lookup when the network is down', async () => {
    const client = http(async () => {
      throw new AppError('NETWORK', 'Could not reach api.mojang.com: getaddrinfo ENOTFOUND')
    })
    await expect(lookupPlayer(client, 'Steve', true)).rejects.toMatchObject({
      code: 'NETWORK',
      message: expect.stringContaining('online mode')
    })
  })

  it('passes other HTTP errors through', async () => {
    const client = http(async () => {
      throw new AppError('HTTP', 'api.mojang.com returned HTTP 429', { status: 429 })
    })
    await expect(lookupPlayer(client, 'Steve', true)).rejects.toMatchObject({
      code: 'HTTP',
      details: { status: 429 }
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/players/uuid.test.ts src/main/net/http.test.ts`
Expected: FAIL — `./uuid` missing; the http test fails because `details` is undefined.

- [ ] **Step 3: Add the status to HTTP errors**

In `src/main/net/http.ts`, replace line 31:

```ts
    if (!res.ok) throw new AppError('HTTP', `${host} returned HTTP ${res.status}`)
```

with:

```ts
    if (!res.ok)
      throw new AppError('HTTP', `${host} returned HTTP ${res.status}`, { status: res.status })
```

- [ ] **Step 4: Implement `uuid.ts`**

Create `src/main/players/uuid.ts`:

```ts
import { createHash } from 'node:crypto'
import type { PlayerRef } from '../../shared/types'
import { AppError } from '../errors'
import type { HttpClient } from '../net/http'

export const MOJANG_PROFILE_URL = 'https://api.mojang.com/users/profiles/minecraft/'

export function formatUuid(hex: string): string {
  const h = hex.toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Same as Java's UUID.nameUUIDFromBytes("OfflinePlayer:" + name), used by offline-mode servers. */
export function offlineUuid(name: string): string {
  const bytes = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return formatUuid(bytes.toString('hex'))
}

const notFound = (name: string): AppError =>
  new AppError('PLAYER_NOT_FOUND', `No Minecraft account named ${name}`)

export async function lookupPlayer(
  http: HttpClient,
  name: string,
  onlineMode: boolean
): Promise<PlayerRef> {
  if (!onlineMode) return { uuid: offlineUuid(name), name }

  let text: string
  try {
    text = await http.getText(`${MOJANG_PROFILE_URL}${encodeURIComponent(name)}`)
  } catch (err) {
    if (err instanceof AppError && err.code === 'HTTP' && err.details?.status === 404)
      throw notFound(name)
    if (err instanceof AppError && err.code === 'NETWORK') {
      throw new AppError(
        'NETWORK',
        `${err.message}. Adding a player to a stopped server needs the internet to look up their account, unless the server's online mode is turned off.`
      )
    }
    throw err
  }

  if (!text.trim()) throw notFound(name)
  const body = JSON.parse(text) as { id?: unknown; name?: unknown }
  if (typeof body.id !== 'string' || !/^[0-9a-f]{32}$/i.test(body.id)) throw notFound(name)
  return { uuid: formatUuid(body.id), name: typeof body.name === 'string' ? body.name : name }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/players/uuid.test.ts src/main/net/http.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass (existing HTTP-error assertions use `toMatchObject`/`code`, so the extra `details` must not break them; if one uses `toEqual` on the error, update it to include `details: { status }`).

```bash
git add src/main/net/http.ts src/main/net/http.test.ts src/main/players/uuid.ts src/main/players/uuid.test.ts
git commit -m "feat: resolve player names to UUIDs"
```

---

### Task 4: Online player tracker (`tracker.ts`)

**Files:**
- Create: `src/main/players/tracker.ts`
- Test: `src/main/players/tracker.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (log lines arrive already ANSI-stripped from `ProcessManager`).
- Produces:
  ```ts
  export class PlayerTracker {
    constructor(onChange: (serverId: string) => void)
    online(serverId: string): string[]           // sorted case-insensitively
    handleLines(serverId: string, lines: string[]): void
    reset(serverId: string): void
  }
  ```

Log-line matching (tightens the spec's ": " anchor so chat can't spoof it): a line counts only if it is one or more `[...]` logger groups followed by `: ` and then the message. Chat lines are `[...]: <name> text`, so a chat message can never start right after the logger prefix with a bare name.

- [ ] **Step 1: Write the failing tests**

Create `src/main/players/tracker.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { PlayerTracker } from './tracker'

const ID = 'srv'

function setup() {
  const onChange = vi.fn()
  return { tracker: new PlayerTracker(onChange), onChange }
}

describe('PlayerTracker', () => {
  it('tracks joins and leaves across server log formats', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines(ID, [
      '[14:03:00] [Server thread/INFO]: Steve joined the game', // vanilla / fabric
      '[14:03:01 INFO]: alex_99 joined the game', // paper / purpur
      '[18Oct2026 14:03:02.123] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Notch joined the game' // forge / neoforge
    ])
    expect(tracker.online(ID)).toEqual(['alex_99', 'Notch', 'Steve'])
    tracker.handleLines(ID, ['[14:05:00 INFO]: Steve left the game'])
    expect(tracker.online(ID)).toEqual(['alex_99', 'Notch'])
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledWith(ID)
  })

  it('ignores chat that imitates a join line', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines(ID, [
      '[14:03:00] [Server thread/INFO]: <Bob> Steve joined the game',
      '[14:03:00] [Server thread/INFO]: <Bob> hi: Steve joined the game',
      '[14:03:00] [Server thread/INFO]: [Not Secure] <Bob> Steve joined the game',
      'Steve joined the game'
    ])
    expect(tracker.online(ID)).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('replaces the set from a `list` reply', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines(ID, ['[14:03:00 INFO]: Ghost joined the game'])
    tracker.handleLines(ID, [
      '[14:03:05 INFO]: There are 2 of a max of 20 players online: Steve, alex_99'
    ])
    expect(tracker.online(ID)).toEqual(['alex_99', 'Steve'])
    tracker.handleLines(ID, ['[14:03:06] [Server thread/INFO]: There are 0 of a max of 20 players online: '])
    expect(tracker.online(ID)).toEqual([])
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('ignores a `list` reply whose names do not match the count', () => {
    const { tracker } = setup()
    tracker.handleLines(ID, ['[14:03:00 INFO]: Steve joined the game'])
    // Some plugins print names on following lines; keep the set we have.
    tracker.handleLines(ID, ['[14:03:05 INFO]: There are 2 of a max of 20 players online:'])
    expect(tracker.online(ID)).toEqual(['Steve'])
  })

  it('does not notify when nothing changed', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines(ID, ['[14:03:00 INFO]: Steve joined the game'])
    tracker.handleLines(ID, ['[14:03:01 INFO]: Steve joined the game'])
    tracker.handleLines(ID, ['[14:03:02 INFO]: Alex left the game'])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps servers separate and clears on reset', () => {
    const { tracker, onChange } = setup()
    tracker.handleLines('a', ['[14:03:00 INFO]: Steve joined the game'])
    tracker.handleLines('b', ['[14:03:00 INFO]: Alex joined the game'])
    tracker.reset('a')
    expect(tracker.online('a')).toEqual([])
    expect(tracker.online('b')).toEqual(['Alex'])
    expect(onChange).toHaveBeenLastCalledWith('a')
    onChange.mockClear()
    tracker.reset('a')
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/players/tracker.test.ts`
Expected: FAIL — cannot resolve `./tracker`.

- [ ] **Step 3: Implement `tracker.ts`**

Create `src/main/players/tracker.ts`:

```ts
// One or more "[...]" logger groups, then ": " — chat lines continue with "<name>".
const PREFIX = String.raw`^(?:\[[^\]]*\]\s*)+:\s`
const NAME = '[A-Za-z0-9_]{3,16}'
const JOIN = new RegExp(`${PREFIX}(${NAME}) joined the game$`)
const LEAVE = new RegExp(`${PREFIX}(${NAME}) left the game$`)
const LIST = new RegExp(
  `${PREFIX}There are (\\d+) (?:of a max of|out of maximum) \\d+ players online[:.]?\\s*(.*)$`
)
const NAME_ONLY = new RegExp(`^${NAME}$`)

export class PlayerTracker {
  private readonly onChange: (serverId: string) => void
  /** serverId → lower-case name → display name */
  private readonly sets = new Map<string, Map<string, string>>()

  constructor(onChange: (serverId: string) => void) {
    this.onChange = onChange
  }

  online(serverId: string): string[] {
    return [...(this.sets.get(serverId)?.values() ?? [])].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    )
  }

  handleLines(serverId: string, lines: string[]): void {
    let changed = false
    for (const line of lines) {
      changed = this.handleLine(serverId, line) || changed
    }
    if (changed) this.onChange(serverId)
  }

  reset(serverId: string): void {
    const set = this.sets.get(serverId)
    this.sets.delete(serverId)
    if (set?.size) this.onChange(serverId)
  }

  private handleLine(serverId: string, line: string): boolean {
    const set = this.set(serverId)
    const join = JOIN.exec(line)
    if (join) {
      const key = join[1].toLowerCase()
      if (set.get(key) === join[1]) return false
      set.set(key, join[1])
      return true
    }
    const leave = LEAVE.exec(line)
    if (leave) return set.delete(leave[1].toLowerCase())

    const list = LIST.exec(line)
    if (!list) return false
    const count = Number(list[1])
    const names = list[2]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    if (names.length !== count || !names.every((n) => NAME_ONLY.test(n))) return false
    const next = new Map(names.map((n) => [n.toLowerCase(), n]))
    const same = next.size === set.size && [...next].every(([k, v]) => set.get(k) === v)
    if (same) return false
    this.sets.set(serverId, next)
    return true
  }

  private set(serverId: string): Map<string, string> {
    let set = this.sets.get(serverId)
    if (!set) {
      set = new Map()
      this.sets.set(serverId, set)
    }
    return set
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/players/tracker.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass.

```bash
git add src/main/players/tracker.ts src/main/players/tracker.test.ts
git commit -m "feat: track online players from the server log"
```

---

### Task 5: `PlayerService`

**Files:**
- Create: `src/main/players/service.ts`
- Test: `src/main/players/service.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `ServerStore.get(id): ServerRecord`; `ProcessManager.status(id)` and `.sendCommand(id, command)`; `readPropertiesFile(dir)` and `updateProperties(dir, changes)` from `src/main/servers/properties.ts`; `AppError`.
- Produces:
  ```ts
  export type WatchFn = (dir: string, onChange: (filename: string | null) => void) => { close(): void }
  export const defaultWatch: WatchFn
  export function toCommand(action: PlayerAction): string
  export interface PlayerServiceDeps {
    store: Pick<ServerStore, 'get'>
    processes: Pick<ProcessManager, 'status' | 'sendCommand'>
    lookup: (name: string, onlineMode: boolean) => Promise<PlayerRef>
    watch: WatchFn
    emit: (event: PlayersChangedEvent) => void
    now?: () => Date
    debounceMs?: number      // default 500
  }
  export class PlayerService {
    constructor(deps: PlayerServiceDeps)
    getPlayers(serverId: string): Promise<PlayerLists>
    action(serverId: string, action: PlayerAction): Promise<PlayerLists>
    onStatus(event: ServerStatusEvent): void
    onLog(event: ServerLogEvent): void
  }
  ```

Behaviour notes for the implementer:
- While running, `action` sends the command and returns the current snapshot right away; the server rewrites its files a moment later, the watcher sees that, and `players:changed` makes the UI re-fetch.
- `onStatus('starting')` starts the file watcher; `onStatus('running')` sends `list` (to resync the tracker); `onStatus('stopped' | 'crashed')` closes the watcher, cancels pending debounces, and resets the tracker.
- The watcher only reacts to the four list files and `server.properties` (or a `null` filename, which some platforms report).

- [ ] **Step 1: Write the failing tests**

Create `src/main/players/service.test.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlayerAction, ServerRecord, ServerStatus } from '../../shared/types'
import { AppError } from '../errors'
import { readPropertiesFile } from '../servers/properties'
import { tempDir } from '../test-utils'
import { PlayerService, toCommand, type WatchFn } from './service'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-10-18T14:03:00Z')

async function setup(status: ServerStatus = 'stopped') {
  const dir = join(await tempDir(), 'srv')
  await mkdir(dir)
  const rec = { id: ID, dir } as ServerRecord
  const processes = {
    status: vi.fn((): ServerStatus => status),
    sendCommand: vi.fn()
  }
  const lookup = vi.fn(async (name: string) => ({ uuid: `uuid-${name.toLowerCase()}`, name }))
  const watchers: { dir: string; onChange: (f: string | null) => void; close: () => void }[] = []
  const watch: WatchFn = (watchDir, onChange) => {
    const w = { dir: watchDir, onChange, close: vi.fn() }
    watchers.push(w)
    return w
  }
  const emit = vi.fn()
  const service = new PlayerService({
    store: { get: () => rec },
    processes,
    lookup,
    watch,
    emit,
    now: () => NOW,
    debounceMs: 500
  })
  const readJson = async (file: string) => JSON.parse(await readFile(join(dir, file), 'utf8'))
  return { dir, processes, lookup, watchers, emit, service, readJson }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('toCommand', () => {
  it('builds one console command per action', () => {
    const cases: [PlayerAction, string][] = [
      [{ type: 'op', name: 'Steve' }, 'op Steve'],
      [{ type: 'deop', name: 'Steve' }, 'deop Steve'],
      [{ type: 'whitelistAdd', name: 'Steve' }, 'whitelist add Steve'],
      [{ type: 'whitelistRemove', name: 'Steve' }, 'whitelist remove Steve'],
      [{ type: 'setWhitelistEnabled', enabled: true }, 'whitelist on'],
      [{ type: 'setWhitelistEnabled', enabled: false }, 'whitelist off'],
      [{ type: 'ban', name: 'Steve' }, 'ban Steve'],
      [{ type: 'ban', name: 'Steve', reason: '  Griefing  ' }, 'ban Steve Griefing'],
      [{ type: 'pardon', name: 'Steve' }, 'pardon Steve'],
      [{ type: 'banIp', ip: '203.0.113.7', reason: 'Alts' }, 'ban-ip 203.0.113.7 Alts'],
      [{ type: 'pardonIp', ip: '203.0.113.7' }, 'pardon-ip 203.0.113.7'],
      [{ type: 'kick', name: 'Steve', reason: 'AFK' }, 'kick Steve AFK'],
      [{ type: 'kick', name: 'Steve', reason: '' }, 'kick Steve']
    ]
    for (const [action, command] of cases) expect(toCommand(action)).toBe(command)
  })
})

describe('PlayerService while running', () => {
  it('sends the command and returns the current snapshot', async () => {
    const { service, processes, readJson, dir } = await setup('running')
    await writeFile(join(dir, 'ops.json'), '[]')
    const lists = await service.action(ID, { type: 'ban', name: 'Steve', reason: 'Griefing' })
    expect(processes.sendCommand).toHaveBeenCalledWith(ID, 'ban Steve Griefing')
    expect(lists.bannedPlayers).toEqual([])
    expect(await readJson('ops.json')).toEqual([])
  })

  it('kicks only while running', async () => {
    const running = await setup('running')
    await running.service.action(ID, { type: 'kick', name: 'Steve' })
    expect(running.processes.sendCommand).toHaveBeenCalledWith(ID, 'kick Steve')

    const stopped = await setup('stopped')
    await expect(stopped.service.action(ID, { type: 'kick', name: 'Steve' })).rejects.toMatchObject(
      { code: 'SERVER_NOT_RUNNING' }
    )
  })

  it('rejects actions while starting or stopping', async () => {
    for (const status of ['starting', 'stopping'] as const) {
      const { service, processes } = await setup(status)
      await expect(service.action(ID, { type: 'op', name: 'Steve' })).rejects.toMatchObject({
        code: 'SERVER_BUSY'
      })
      expect(processes.sendCommand).not.toHaveBeenCalled()
    }
  })
})

describe('PlayerService while stopped', () => {
  it('adds an op with the configured permission level', async () => {
    const { service, dir, lookup, readJson } = await setup()
    await writeFile(join(dir, 'server.properties'), 'op-permission-level=2\nonline-mode=false\n')
    const lists = await service.action(ID, { type: 'op', name: 'Steve' })
    expect(lookup).toHaveBeenCalledWith('Steve', false)
    expect(await readJson('ops.json')).toEqual([
      { uuid: 'uuid-steve', name: 'Steve', level: 2, bypassesPlayerLimit: false }
    ])
    expect(lists.ops).toEqual([{ uuid: 'uuid-steve', name: 'Steve', level: 2 }])
  })

  it('defaults to online mode and level 4', async () => {
    const { service, lookup, readJson } = await setup()
    await service.action(ID, { type: 'op', name: 'Steve' })
    expect(lookup).toHaveBeenCalledWith('Steve', true)
    expect((await readJson('ops.json'))[0].level).toBe(4)
  })

  it('treats adding an existing name as a no-op', async () => {
    const { service, dir, lookup } = await setup()
    await writeFile(join(dir, 'whitelist.json'), '[{"uuid":"u1","name":"Steve"}]')
    const lists = await service.action(ID, { type: 'whitelistAdd', name: 'steve' })
    expect(lookup).not.toHaveBeenCalled()
    expect(lists.whitelist).toEqual([{ uuid: 'u1', name: 'Steve' }])
  })

  it('removes by name case-insensitively and keeps other entries intact', async () => {
    const { service, dir, readJson } = await setup()
    await writeFile(
      join(dir, 'ops.json'),
      JSON.stringify([
        { uuid: 'u1', name: 'Steve', level: 4, bypassesPlayerLimit: true },
        { uuid: 'u2', name: 'Alex', level: 3, bypassesPlayerLimit: false, extra: 1 }
      ])
    )
    await service.action(ID, { type: 'deop', name: 'STEVE' })
    expect(await readJson('ops.json')).toEqual([
      { uuid: 'u2', name: 'Alex', level: 3, bypassesPlayerLimit: false, extra: 1 }
    ])
  })

  it('writes player and IP bans in the server format', async () => {
    const { service, readJson } = await setup()
    await service.action(ID, { type: 'ban', name: 'Steve' })
    await service.action(ID, { type: 'banIp', ip: '203.0.113.7', reason: 'Alts' })
    expect(await readJson('banned-players.json')).toEqual([
      {
        uuid: 'uuid-steve',
        name: 'Steve',
        created: '2026-10-18 14:03:00 +0000',
        source: 'Blockhost',
        expires: 'forever',
        reason: 'Banned by an operator.'
      }
    ])
    expect(await readJson('banned-ips.json')).toEqual([
      {
        ip: '203.0.113.7',
        created: '2026-10-18 14:03:00 +0000',
        source: 'Blockhost',
        expires: 'forever',
        reason: 'Alts'
      }
    ])

    await service.action(ID, { type: 'pardon', name: 'steve' })
    await service.action(ID, { type: 'pardonIp', ip: '203.0.113.7' })
    expect(await readJson('banned-players.json')).toEqual([])
    expect(await readJson('banned-ips.json')).toEqual([])
  })

  it('toggles the whitelist in server.properties', async () => {
    const { service, dir } = await setup()
    await writeFile(join(dir, 'server.properties'), 'motd=Hi\nwhite-list=false\n')
    const lists = await service.action(ID, { type: 'setWhitelistEnabled', enabled: true })
    expect(lists.whitelistEnabled).toBe(true)
    expect(await readPropertiesFile(dir)).toEqual([
      { key: 'motd', value: 'Hi' },
      { key: 'white-list', value: 'true' }
    ])
  })

  it('refuses to overwrite a corrupt list unless confirmed', async () => {
    const { service, dir, readJson } = await setup()
    await writeFile(join(dir, 'ops.json'), '[{oops')
    expect((await service.getPlayers(ID)).corrupt).toEqual(['ops'])
    await expect(service.action(ID, { type: 'op', name: 'Steve' })).rejects.toMatchObject({
      code: 'LIST_FILE_CORRUPT',
      details: { list: 'ops' }
    })
    await service.action(ID, { type: 'op', name: 'Steve', overwriteCorrupt: true })
    expect(await readJson('ops.json')).toHaveLength(1)
  })

  it('surfaces lookup failures without writing', async () => {
    const { service, lookup, dir } = await setup()
    lookup.mockRejectedValueOnce(new AppError('PLAYER_NOT_FOUND', 'No Minecraft account named Zzz'))
    await expect(service.action(ID, { type: 'whitelistAdd', name: 'Zzz' })).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND'
    })
    await expect(readFile(join(dir, 'whitelist.json'), 'utf8')).rejects.toThrow()
  })
})

describe('PlayerService events', () => {
  it('resyncs with `list` once running and tracks log lines', async () => {
    const { service, processes, emit } = await setup('running')
    service.onStatus({ serverId: ID, status: 'running' })
    expect(processes.sendCommand).toHaveBeenCalledWith(ID, 'list')
    service.onLog({ serverId: ID, lines: ['[14:03:00 INFO]: Steve joined the game'] })
    expect(emit).toHaveBeenCalledWith({ serverId: ID })
    expect((await service.getPlayers(ID)).online).toEqual(['Steve'])
  })

  it('reports no one online unless running', async () => {
    const { service, processes } = await setup('running')
    service.onLog({ serverId: ID, lines: ['[14:03:00 INFO]: Steve joined the game'] })
    processes.status.mockReturnValue('stopping')
    expect((await service.getPlayers(ID)).online).toEqual([])
  })

  it('watches list files while up, debounced, and stops on exit', async () => {
    vi.useFakeTimers()
    const { service, watchers, emit, dir } = await setup('running')
    service.onStatus({ serverId: ID, status: 'starting' })
    expect(watchers).toHaveLength(1)
    expect(watchers[0].dir).toBe(dir)

    watchers[0].onChange('ops.json')
    watchers[0].onChange('ops.json')
    watchers[0].onChange('world') // ignored
    vi.advanceTimersByTime(499)
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(emit).toHaveBeenCalledTimes(1)

    service.onStatus({ serverId: ID, status: 'running' })
    expect(watchers).toHaveLength(1) // not watched twice

    watchers[0].onChange(null)
    service.onStatus({ serverId: ID, status: 'stopped' })
    expect(watchers[0].close).toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(emit).toHaveBeenCalledTimes(1) // pending debounce was cancelled
  })

  it('clears the online set when the server stops', async () => {
    const { service, processes } = await setup('running')
    service.onLog({ serverId: ID, lines: ['[14:03:00 INFO]: Steve joined the game'] })
    service.onStatus({ serverId: ID, status: 'crashed' })
    expect((await service.getPlayers(ID)).online).toEqual([])
    processes.status.mockReturnValue('running')
    expect((await service.getPlayers(ID)).online).toEqual([])
  })

  it('keeps going if `list` cannot be sent', async () => {
    const { service, processes } = await setup('running')
    processes.sendCommand.mockImplementation(() => {
      throw new AppError('NOT_RUNNING', 'The server is not running')
    })
    expect(() => service.onStatus({ serverId: ID, status: 'running' })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/players/service.test.ts`
Expected: FAIL — cannot resolve `./service`.

- [ ] **Step 3: Implement `service.ts`**

Create `src/main/players/service.ts`:

```ts
import { watch } from 'node:fs'
import type {
  PlayerAction,
  PlayerListName,
  PlayerLists,
  PlayerRef,
  PlayersChangedEvent,
  ServerLogEvent,
  ServerStatusEvent
} from '../../shared/types'
import { AppError } from '../errors'
import type { ProcessManager } from '../servers/process'
import { readPropertiesFile, updateProperties } from '../servers/properties'
import type { ServerStore } from '../servers/store'
import {
  banTimestamp,
  hasName,
  LIST_FILES,
  readList,
  toIpBans,
  toOps,
  toPlayerBans,
  toWhitelist,
  writeList,
  type RawEntry
} from './files'
import { PlayerTracker } from './tracker'

export type WatchFn = (
  dir: string,
  onChange: (filename: string | null) => void
) => { close(): void }

export const defaultWatch: WatchFn = (dir, onChange) => {
  const watcher = watch(dir, (_event, filename) => onChange(filename ? String(filename) : null))
  watcher.on('error', () => {})
  return watcher
}

const WATCHED_FILES = new Set([...Object.values(LIST_FILES), 'server.properties'])
const DEFAULT_BAN_REASON = 'Banned by an operator.'

type FileAction = Exclude<PlayerAction, { type: 'kick' | 'setWhitelistEnabled' }>

const LIST_FOR: Record<FileAction['type'], PlayerListName> = {
  op: 'ops',
  deop: 'ops',
  whitelistAdd: 'whitelist',
  whitelistRemove: 'whitelist',
  ban: 'bannedPlayers',
  pardon: 'bannedPlayers',
  banIp: 'bannedIps',
  pardonIp: 'bannedIps'
}

const withReason = (command: string, reason?: string): string =>
  reason?.trim() ? `${command} ${reason.trim()}` : command

export function toCommand(action: PlayerAction): string {
  switch (action.type) {
    case 'op':
      return `op ${action.name}`
    case 'deop':
      return `deop ${action.name}`
    case 'whitelistAdd':
      return `whitelist add ${action.name}`
    case 'whitelistRemove':
      return `whitelist remove ${action.name}`
    case 'setWhitelistEnabled':
      return action.enabled ? 'whitelist on' : 'whitelist off'
    case 'ban':
      return withReason(`ban ${action.name}`, action.reason)
    case 'pardon':
      return `pardon ${action.name}`
    case 'banIp':
      return withReason(`ban-ip ${action.ip}`, action.reason)
    case 'pardonIp':
      return `pardon-ip ${action.ip}`
    case 'kick':
      return withReason(`kick ${action.name}`, action.reason)
  }
}

export interface PlayerServiceDeps {
  store: Pick<ServerStore, 'get'>
  processes: Pick<ProcessManager, 'status' | 'sendCommand'>
  lookup: (name: string, onlineMode: boolean) => Promise<PlayerRef>
  watch: WatchFn
  emit: (event: PlayersChangedEvent) => void
  now?: () => Date
  debounceMs?: number
}

export class PlayerService {
  private readonly deps: PlayerServiceDeps
  private readonly tracker: PlayerTracker
  private readonly watchers = new Map<string, { close(): void }>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(deps: PlayerServiceDeps) {
    this.deps = deps
    this.tracker = new PlayerTracker((serverId) => this.deps.emit({ serverId }))
  }

  async getPlayers(serverId: string): Promise<PlayerLists> {
    const { dir } = this.deps.store.get(serverId)
    const [ops, whitelist, bannedPlayers, bannedIps, props] = await Promise.all([
      readList(dir, 'ops'),
      readList(dir, 'whitelist'),
      readList(dir, 'bannedPlayers'),
      readList(dir, 'bannedIps'),
      readPropertiesFile(dir)
    ])
    const files = { ops, whitelist, bannedPlayers, bannedIps }
    return {
      online: this.deps.processes.status(serverId) === 'running' ? this.tracker.online(serverId) : [],
      ops: toOps(ops.entries),
      whitelist: toWhitelist(whitelist.entries),
      whitelistEnabled: props.find((e) => e.key === 'white-list')?.value === 'true',
      bannedPlayers: toPlayerBans(bannedPlayers.entries),
      bannedIps: toIpBans(bannedIps.entries),
      corrupt: (Object.keys(files) as PlayerListName[]).filter((list) => files[list].corrupt)
    }
  }

  async action(serverId: string, action: PlayerAction): Promise<PlayerLists> {
    const { dir } = this.deps.store.get(serverId)
    const status = this.deps.processes.status(serverId)
    if (status === 'starting' || status === 'stopping') {
      throw new AppError('SERVER_BUSY', 'Wait until the server has finished starting or stopping')
    }
    if (status === 'running') {
      this.deps.processes.sendCommand(serverId, toCommand(action))
      return this.getPlayers(serverId)
    }
    if (action.type === 'kick') {
      throw new AppError('SERVER_NOT_RUNNING', 'Players can only be kicked while the server is running')
    }
    if (action.type === 'setWhitelistEnabled') {
      await updateProperties(dir, { 'white-list': String(action.enabled) })
    } else {
      await this.editList(dir, action)
    }
    return this.getPlayers(serverId)
  }

  onStatus(event: ServerStatusEvent): void {
    const { serverId, status } = event
    if (status === 'starting' || status === 'running') this.startWatching(serverId)
    if (status === 'running') {
      try {
        this.deps.processes.sendCommand(serverId, 'list')
      } catch {
        // The server exited between the status change and now; nothing to resync.
      }
    }
    if (status === 'stopped' || status === 'crashed') {
      this.stopWatching(serverId)
      this.tracker.reset(serverId)
    }
  }

  onLog(event: ServerLogEvent): void {
    this.tracker.handleLines(event.serverId, event.lines)
  }

  private async editList(dir: string, action: FileAction): Promise<void> {
    const list = LIST_FOR[action.type]
    const file = await readList(dir, list)
    if (file.corrupt && !action.overwriteCorrupt) {
      throw new AppError(
        'LIST_FILE_CORRUPT',
        `${LIST_FILES[list]} could not be read. Saving will replace it with a new list.`,
        { list }
      )
    }
    const next = await this.nextEntries(dir, action, file.entries)
    if (next) await writeList(dir, list, next)
  }

  /** Returns the new list, or null when the action changes nothing. */
  private async nextEntries(
    dir: string,
    action: FileAction,
    entries: RawEntry[]
  ): Promise<RawEntry[] | null> {
    switch (action.type) {
      case 'deop':
      case 'whitelistRemove':
      case 'pardon': {
        const kept = entries.filter((e) => !hasName(e, action.name))
        return kept.length === entries.length ? null : kept
      }
      case 'pardonIp': {
        const kept = entries.filter((e) => e.ip !== action.ip)
        return kept.length === entries.length ? null : kept
      }
      case 'banIp': {
        if (entries.some((e) => e.ip === action.ip)) return null
        return [...entries, { ip: action.ip, ...this.banFields(action.reason) }]
      }
      case 'op':
      case 'whitelistAdd':
      case 'ban': {
        if (entries.some((e) => hasName(e, action.name))) return null
        const props = await readPropertiesFile(dir)
        const prop = (key: string): string | undefined => props.find((e) => e.key === key)?.value
        const player = await this.deps.lookup(action.name, prop('online-mode') !== 'false')
        if (action.type === 'whitelistAdd') return [...entries, { ...player }]
        if (action.type === 'ban') {
          return [...entries, { ...player, ...this.banFields(action.reason) }]
        }
        const level = Number(prop('op-permission-level'))
        return [
          ...entries,
          {
            ...player,
            level: Number.isInteger(level) && level >= 1 && level <= 4 ? level : 4,
            bypassesPlayerLimit: false
          }
        ]
      }
    }
  }

  private banFields(reason?: string): RawEntry {
    return {
      created: banTimestamp(this.deps.now?.() ?? new Date()),
      source: 'Blockhost',
      expires: 'forever',
      reason: reason?.trim() || DEFAULT_BAN_REASON
    }
  }

  private startWatching(serverId: string): void {
    if (this.watchers.has(serverId)) return
    try {
      const watcher = this.deps.watch(this.deps.store.get(serverId).dir, (filename) => {
        if (filename === null || WATCHED_FILES.has(filename)) this.scheduleChanged(serverId)
      })
      this.watchers.set(serverId, watcher)
    } catch {
      // The folder may be missing; the tab still works, just without live file updates.
    }
  }

  private stopWatching(serverId: string): void {
    this.watchers.get(serverId)?.close()
    this.watchers.delete(serverId)
    clearTimeout(this.timers.get(serverId))
    this.timers.delete(serverId)
  }

  private scheduleChanged(serverId: string): void {
    clearTimeout(this.timers.get(serverId))
    this.timers.set(
      serverId,
      setTimeout(() => {
        this.timers.delete(serverId)
        this.deps.emit({ serverId })
      }, this.deps.debounceMs ?? 500)
    )
  }
}
```

Ban entries spread `player` first so the written key order matches the server's own files (`uuid, name, created, source, expires, reason`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/players/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass. If TypeScript reports that `nextEntries` or `toCommand` lacks a return on some path, the `switch` is not exhaustive — check that every `FileAction`/`PlayerAction` type has a `case`.

```bash
git add src/main/players/service.ts src/main/players/service.test.ts
git commit -m "feat: add player service with command and file paths"
```

---

### Task 6: Wire into services, IPC, and the renderer API

**Files:**
- Modify: `src/shared/api.ts` (channel lists, `EventPayloads`)
- Modify: `src/main/services.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/renderer/src/lib/api.ts`

**Interfaces:**
- Consumes: `PlayerService`, `defaultWatch` (Task 5); `lookupPlayer` (Task 3); `playerActionSchema` (Task 1); `PlayerLists`, `PlayerAction`, `PlayersChangedEvent` (Task 1).
- Produces:
  - Invoke channels `'players:get'`, `'players:action'`; event channel `'players:changed'` with payload `PlayersChangedEvent`.
  - `Services.players: PlayerService`.
  - Renderer: `api.getPlayers(id: string): Promise<PlayerLists>`, `api.playerAction(id: string, action: PlayerAction): Promise<PlayerLists>`.

There is no unit test harness for Electron wiring in this repo (`ipc.ts`/`services.ts` have no tests); this task is verified by typecheck, the existing suite, and launching the app.

- [ ] **Step 1: Add the channels**

In `src/shared/api.ts`:
- Add `PlayersChangedEvent` to the type import from `./types`.
- In `INVOKE_CHANNELS`, after `'servers:openFolder',` add:
  ```ts
  'players:get',
  'players:action',
  ```
- In `EVENT_CHANNELS`, after `'server:log',` add `'players:changed',`.
- In `EventPayloads`, after `'server:log': ServerLogEvent` add:
  ```ts
  'players:changed': PlayersChangedEvent
  ```

- [ ] **Step 2: Construct `PlayerService` in `services.ts`**

In `src/main/services.ts`:
- Add imports:
  ```ts
  import { defaultWatch, PlayerService } from './players/service'
  import { lookupPlayer } from './players/uuid'
  ```
- Add `players: PlayerService` to the `Services` interface after `servers: ServerService`.
- Replace the `ProcessManager` construction with:
  ```ts
  const processes = new ProcessManager({
    spawn: defaultSpawn,
    kill: killTree,
    onStatus: (event) => {
      send('server:status', event)
      players.onStatus(event)
    },
    onLog: (event) => {
      send('server:log', event)
      players.onLog(event)
    }
  })
  const players = new PlayerService({
    store,
    processes,
    lookup: (name, onlineMode) => lookupPlayer(http, name, onlineMode),
    watch: defaultWatch,
    emit: (event) => send('players:changed', event)
  })
  ```
  (`players` is only used inside callbacks that fire after a server starts, so declaring it after `processes` is safe.)
- Add `players` to the returned object after `servers`.

- [ ] **Step 3: Register the IPC handlers**

In `src/main/ipc.ts`:
- Add `playerActionSchema` to the import from `./schemas` (keep the list alphabetical: after `javaMajorSchema`).
- Change the destructuring to `const { servers, installer, providers, javaManager, http, paths, players } = services`.
- After the `servers:openFolder` handler, add:
  ```ts
  handle('players:get', z.tuple([idSchema]), (id) => players.getPlayers(id))
  handle('players:action', z.tuple([idSchema, playerActionSchema]), (id, action) =>
    players.action(id, action)
  )
  ```

- [ ] **Step 4: Add the renderer API calls**

In `src/renderer/src/lib/api.ts`:
- Add `PlayerAction` and `PlayerLists` to the type import from `../../../shared/types`.
- After `openFolder`, add:
  ```ts
  getPlayers: (id: string) => call<PlayerLists>('players:get', id),
  playerAction: (id: string, action: PlayerAction) =>
    call<PlayerLists>('players:action', id, action),
  ```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test`
Expected: both pass.

Run: `npm run dev`, open a stopped server, and in DevTools console run
`await window.blockhost.invoke('players:get', '<server id>')`
Expected: `{ ok: true, data: { online: [], ops: [...], ... } }`. Close the app.

- [ ] **Step 6: Commit**

```bash
git add src/shared/api.ts src/main/services.ts src/main/ipc.ts src/renderer/src/lib/api.ts
git commit -m "feat: expose player management over IPC"
```

---

### Task 7: Players tab

**Files:**
- Create: `src/renderer/src/pages/tabs/PlayersTab.tsx`
- Modify: `src/renderer/src/pages/ServerDetail.tsx:6-18,181`

**Interfaces:**
- Consumes: `api.getPlayers`, `api.playerAction`, `api.on('players:changed', …)` (Task 6); `PLAYER_NAME_PATTERN`, `PlayerAction`, `PlayerLists`, `PlayerListName`, `ServerView` (Task 1); `Button`, `ErrorText`, `inputClass` from `components/ui.tsx`; `ApiCallError`, `errorMessage` from `lib/api.ts`.
- Produces: `export function PlayersTab({ server }: { server: ServerView })`.

The renderer has no component test setup (Vitest runs only `src/**/*.test.ts` in a node environment), so this task is verified by typecheck and by driving the real app.

- [ ] **Step 1: Create the tab**

Create `src/renderer/src/pages/tabs/PlayersTab.tsx`:

```tsx
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  PLAYER_NAME_PATTERN,
  type PlayerAction,
  type PlayerListName,
  type PlayerLists,
  type ServerView
} from '../../../../shared/types'
import { Button, ErrorText, inputClass } from '../../components/ui'
import { api, ApiCallError, errorMessage } from '../../lib/api'

const LIST_FILE_NAMES: Record<PlayerListName, string> = {
  ops: 'ops.json',
  whitelist: 'whitelist.json',
  bannedPlayers: 'banned-players.json',
  bannedIps: 'banned-ips.json'
}

const NAME_HINT = 'Use the exact Minecraft username (3–16 letters, numbers or _).'
const IP_PATTERN = /^[0-9a-fA-F.:]{2,45}$/

type Pending = { type: 'kick' | 'ban'; name: string }

function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Row({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1 text-sm">
      <span className="min-w-0 truncate">{children}</span>
      <span className="flex shrink-0 gap-1">{actions}</span>
    </li>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-500">{children}</p>
}

function AddForm({
  placeholder,
  isValid,
  invalidMessage,
  withReason = false,
  submitLabel = 'Add',
  disabled,
  onSubmit
}: {
  placeholder: string
  isValid: (value: string) => boolean
  invalidMessage: string
  withReason?: boolean
  submitLabel?: string
  disabled: boolean
  onSubmit: (value: string, reason: string) => Promise<boolean>
}) {
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [invalid, setInvalid] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = value.trim()
    if (!isValid(trimmed)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (await onSubmit(trimmed, reason.trim())) {
      setValue('')
      setReason('')
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-1">
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
        />
        {withReason && (
          <input
            className={inputClass}
            placeholder="Reason (optional)"
            maxLength={200}
            value={reason}
            disabled={disabled}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        <Button type="submit" disabled={disabled || !value.trim()}>
          {submitLabel}
        </Button>
      </div>
      {invalid && <p className="text-xs text-red-400">{invalidMessage}</p>}
    </form>
  )
}

export function PlayersTab({ server }: { server: ServerView }) {
  const [lists, setLists] = useState<PlayerLists | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [pendingReason, setPendingReason] = useState('')
  const [banView, setBanView] = useState<'players' | 'ips'>('players')

  const refresh = useCallback(() => {
    api
      .getPlayers(server.id)
      .then(setLists)
      .catch((err) => setError(errorMessage(err)))
  }, [server.id])

  useEffect(() => refresh(), [refresh, server.status])
  useEffect(
    () =>
      api.on('players:changed', (event) => {
        if (event.serverId === server.id) refresh()
      }),
    [server.id, refresh]
  )

  const running = server.status === 'running'
  const transitioning = server.status === 'starting' || server.status === 'stopping'
  const disabled = busy || transitioning

  async function act(action: PlayerAction): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      setLists(await api.playerAction(server.id, action))
      return true
    } catch (err) {
      if (
        err instanceof ApiCallError &&
        err.code === 'LIST_FILE_CORRUPT' &&
        window.confirm(`${err.message}\n\nReplace it?`)
      ) {
        return act({ ...action, overwriteCorrupt: true })
      }
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function confirmPending() {
    if (!pending) return
    const ok = await act({ type: pending.type, name: pending.name, reason: pendingReason.trim() })
    if (ok) {
      setPending(null)
      setPendingReason('')
    }
  }

  if (!lists) {
    return error ? <ErrorText>{error}</ErrorText> : <Empty>Loading…</Empty>
  }

  const isOp = (name: string) => lists.ops.some((o) => o.name.toLowerCase() === name.toLowerCase())
  const isName = (v: string) => PLAYER_NAME_PATTERN.test(v)

  return (
    <div className="space-y-4 pb-6">
      {error && <ErrorText>{error}</ErrorText>}
      {lists.corrupt.length > 0 && (
        <ErrorText>
          Could not read {lists.corrupt.map((l) => LIST_FILE_NAMES[l]).join(', ')}. The list is
          shown as empty; saving a change will replace the file.
        </ErrorText>
      )}
      {transitioning && (
        <p className="text-sm text-zinc-400">
          Player changes are paused while the server is {server.status}.
        </p>
      )}

      <Card title={running ? `Online now (${lists.online.length})` : 'Online now'}>
        {!running ? (
          <Empty>Server is offline — changes are saved to files and apply on next start.</Empty>
        ) : lists.online.length === 0 ? (
          <Empty>No one is online.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {lists.online.map((name) => (
              <Row
                key={name}
                actions={
                  <>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => setPending({ type: 'kick', name })}
                    >
                      Kick
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => void act({ type: isOp(name) ? 'deop' : 'op', name })}
                    >
                      {isOp(name) ? 'Deop' : 'Op'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => setPending({ type: 'ban', name })}
                    >
                      Ban
                    </Button>
                  </>
                }
              >
                {name}
                {isOp(name) && <span className="ml-2 text-xs text-emerald-400">op</span>}
              </Row>
            ))}
          </ul>
        )}
        {pending && (
          <div className="space-y-2 rounded-md border border-zinc-700 p-3">
            <p className="text-sm">
              {pending.type === 'kick' ? 'Kick' : 'Ban'} <b>{pending.name}</b>?
            </p>
            <input
              className={inputClass}
              placeholder="Reason (optional)"
              maxLength={200}
              value={pendingReason}
              onChange={(e) => setPendingReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="danger" disabled={disabled} onClick={() => void confirmPending()}>
                {pending.type === 'kick' ? 'Kick' : 'Ban'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPending(null)
                  setPendingReason('')
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Operators">
          {lists.ops.length === 0 ? (
            <Empty>No operators.</Empty>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {lists.ops.map((op) => (
                <Row
                  key={op.uuid || op.name}
                  actions={
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Remove ${op.name} from operators`}
                      onClick={() => void act({ type: 'deop', name: op.name })}
                    >
                      ×
                    </Button>
                  }
                >
                  {op.name}
                </Row>
              ))}
            </ul>
          )}
          <AddForm
            placeholder="Username"
            isValid={isName}
            invalidMessage={NAME_HINT}
            disabled={disabled}
            onSubmit={(name) => act({ type: 'op', name })}
          />
        </Card>

        <Card
          title="Whitelist"
          actions={
            <Button
              variant={lists.whitelistEnabled ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() =>
                void act({ type: 'setWhitelistEnabled', enabled: !lists.whitelistEnabled })
              }
            >
              {lists.whitelistEnabled ? 'On' : 'Off'}
            </Button>
          }
        >
          <p className="text-xs text-zinc-500">
            {lists.whitelistEnabled
              ? 'Only these players can join.'
              : 'Off — anyone can join. Turn it on to allow only these players.'}
          </p>
          {lists.whitelist.length === 0 ? (
            <Empty>No players on the whitelist.</Empty>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {lists.whitelist.map((p) => (
                <Row
                  key={p.uuid || p.name}
                  actions={
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Remove ${p.name} from the whitelist`}
                      onClick={() => void act({ type: 'whitelistRemove', name: p.name })}
                    >
                      ×
                    </Button>
                  }
                >
                  {p.name}
                </Row>
              ))}
            </ul>
          )}
          <AddForm
            placeholder="Username"
            isValid={isName}
            invalidMessage={NAME_HINT}
            disabled={disabled}
            onSubmit={(name) => act({ type: 'whitelistAdd', name })}
          />
        </Card>

        <Card
          title="Banned"
          actions={
            <div className="flex gap-1">
              <Button
                variant={banView === 'players' ? 'secondary' : 'ghost'}
                onClick={() => setBanView('players')}
              >
                Players
              </Button>
              <Button
                variant={banView === 'ips' ? 'secondary' : 'ghost'}
                onClick={() => setBanView('ips')}
              >
                IPs
              </Button>
            </div>
          }
        >
          {banView === 'players' ? (
            <>
              {lists.bannedPlayers.length === 0 ? (
                <Empty>No banned players.</Empty>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {lists.bannedPlayers.map((b) => (
                    <Row
                      key={b.uuid || b.name}
                      actions={
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => void act({ type: 'pardon', name: b.name })}
                        >
                          Pardon
                        </Button>
                      }
                    >
                      {b.name}
                      {b.reason && <span className="ml-2 text-xs text-zinc-500">{b.reason}</span>}
                    </Row>
                  ))}
                </ul>
              )}
              <AddForm
                placeholder="Username"
                isValid={isName}
                invalidMessage={NAME_HINT}
                withReason
                submitLabel="Ban"
                disabled={disabled}
                onSubmit={(name, reason) => act({ type: 'ban', name, reason })}
              />
            </>
          ) : (
            <>
              {lists.bannedIps.length === 0 ? (
                <Empty>No banned IP addresses.</Empty>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {lists.bannedIps.map((b) => (
                    <Row
                      key={b.ip}
                      actions={
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => void act({ type: 'pardonIp', ip: b.ip })}
                        >
                          Pardon
                        </Button>
                      }
                    >
                      <code>{b.ip}</code>
                      {b.reason && <span className="ml-2 text-xs text-zinc-500">{b.reason}</span>}
                    </Row>
                  ))}
                </ul>
              )}
              <AddForm
                placeholder="IP address"
                isValid={(v) => IP_PATTERN.test(v)}
                invalidMessage="Enter an IPv4 or IPv6 address."
                withReason
                submitLabel="Ban"
                disabled={disabled}
                onSubmit={(ip, reason) => act({ type: 'banIp', ip, reason })}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the tab to the detail page**

In `src/renderer/src/pages/ServerDetail.tsx`:
- Add `import { PlayersTab } from './tabs/PlayersTab'` after the `ConsoleTab` import.
- Change the `Tab` type to `type Tab = 'console' | 'players' | 'properties' | 'settings' | 'connect'`.
- In `TABS`, insert `{ id: 'players', label: 'Players' },` after the Console entry.
- After `{tab === 'console' && <ConsoleTab server={server} />}`, add:
  ```tsx
  {tab === 'players' && <PlayersTab server={server} />}
  ```

- [ ] **Step 3: Typecheck and format**

Run: `npm run typecheck && npx prettier --check src/renderer/src/pages/tabs/PlayersTab.tsx src/renderer/src/pages/ServerDetail.tsx`
Expected: typecheck passes. If Prettier reports differences, run `npx prettier --write` on those two files.

- [ ] **Step 4: Drive the real app**

Use the `run` skill (or `npm run dev`) and check, on an installed Paper server:
1. Stopped: Players tab shows the offline note. Add your own username to Operators → it appears; `ops.json` in the server folder contains it with `level: 4`. Remove it → gone.
2. Stopped: add `ab` → inline hint, no request. Toggle whitelist On → Properties tab shows `white-list` true.
3. Start the server; while Starting, buttons are disabled with the paused note.
4. Running: join with a client → you appear under "Online now" within a second. Click Op → `op <name>` appears in Console and the Operators list updates without reloading. Click Kick with reason → you are kicked with that reason and leave the list.
5. Stop the server → "Online now" returns to the offline note.

Expected: all five behave as described. Fix anything that does not before committing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/tabs/PlayersTab.tsx src/renderer/src/pages/ServerDetail.tsx
git commit -m "feat: add Players tab"
```

---

### Task 8: Integration test and smoke checklist

**Files:**
- Modify: `src/main/integration/paper.integration.test.ts`
- Modify: `docs/smoke-test.md`

**Interfaces:**
- Consumes: `PlayerService`, `defaultWatch` (Task 5); `lookupPlayer` (Task 3).

- [ ] **Step 1: Extend the Paper integration test**

In `src/main/integration/paper.integration.test.ts`:
- Add imports:
  ```ts
  import { defaultWatch, PlayerService } from '../players/service'
  import { lookupPlayer } from '../players/uuid'
  ```
- Immediately after the `motd` assertions (before `processes.stop(rec.id)`), add:
  ```ts
  const players = new PlayerService({
    store,
    processes,
    lookup: (name, onlineMode) => lookupPlayer(http, name, onlineMode),
    watch: defaultWatch,
    emit: () => {}
  })
  await players.action(rec.id, { type: 'op', name: 'Notch' })
  await vi.waitFor(
    async () =>
      expect((await players.getPlayers(rec.id)).ops.map((o) => o.name.toLowerCase())).toContain(
        'notch'
      ),
    { timeout: 30_000, interval: 500 }
  )
  ```

- [ ] **Step 2: Run the integration test**

Run: `npm run test:integration`
Expected: PASS (slow; downloads Paper and Java on first run). The server resolves `Notch` through Mojang itself, so this needs the internet.

- [ ] **Step 3: Add smoke checklist items**

In `docs/smoke-test.md`, after the `max-players` line, add:

```markdown
- [ ] Players tab, server stopped: adding an operator writes `ops.json`; toggling the whitelist updates `white-list` in Properties
- [ ] Players tab, server running: joining shows the player under "Online now"; Op, Kick (with reason) and Ban work and the lists refresh on their own
- [ ] Players tab on a Forge or NeoForge server: "Online now" fills after a player joins
```

- [ ] **Step 4: Full verification and commit**

Run: `npm run typecheck && npm test`
Expected: both pass.

```bash
git add src/main/integration/paper.integration.test.ts docs/smoke-test.md
git commit -m "test: cover player management end to end"
```
