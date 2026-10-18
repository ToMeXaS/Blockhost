# Tunnel Integration (playit.gg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user link a playit.gg account once and share any Blockhost server over the internet from the Connect tab, with the app running the playit agent and creating the tunnel for them.

**Architecture:** A new `src/main/tunnel/` module: `api.ts` (playit HTTP API), `binary.ts` (download the pinned `playitd.exe`), `account.ts` (browser claim flow, secret file), `agent.ts` (supervise the `playitd` child process, read status from its log lines), `service.ts` (`TunnelService`: per-server sharing, tunnel create/reuse/adopt, status). It hooks into the existing `ProcessManager.onStatus` and `ServerService.remove`, is exposed over zod-validated IPC, and gets a card on the Connect tab.

**Tech Stack:** Electron, TypeScript, zod 4, React 19, Tailwind 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-18-tunnel-integration-design.md`

## Global Constraints

- playitd pinned: version `1.0.12`, URL `https://github.com/playit-cloud/playit-agent/releases/download/v1.0.12/playit-windows-x86_64-signed.exe`, sha256 `367fb813a20c67c7501e3921298ce51a641e5b25e6005f6059808f89404ba44b`, stored as `<dataDir>/playit/playitd-1.0.12.exe`.
- Secret file `<dataDir>/playit/playit.toml`, content exactly `secret_key = "<key>"` plus newline, written with `writeFileAtomic`.
- playitd args exactly: `--secret-path <toml> --socket-path \\.\pipe\blockhost-playitd` (no `-l`; status is read from stderr/stdout).
- API base `https://api.playit.gg`, JSON POST, `Authorization: Agent-Key <secret>` on authenticated calls.
- Claim: code = 32 random hex chars, URL `https://playit.gg/claim/<code>`, poll every 2 s, give up after 10 minutes, one link attempt at a time.
- Agent restart delays 2 s, 5 s, 15 s; a fourth unexpected exit → error state until Retry; a successful connection resets the count.
- Address poll interval 30 s while sharing is active.
- Tunnel: `minecraft-java`, local `127.0.0.1:<server port>`, name `Blockhost <server name>` reduced to printable ASCII and at most 30 characters.
- Error codes: `PLAYIT_NOT_LINKED`, `PLAYIT_UNAUTHORIZED`, `PLAYIT_FORBIDDEN`, `PLAYIT_API`, `PLAYIT_TUNNEL_LIMIT`, `PLAYIT_CREATE_FORBIDDEN`, `PLAYIT_CLAIM_REJECTED`, `PLAYIT_CLAIM_EXPIRED`, `CANCELLED`.
- Tunnel-limit message exactly: "Your playit.gg account has no free tunnels left. Remove one on playit.gg or turn sharing off for another server."
- Renderer has no Node access; all side effects stay in the main process.
- No `Co-Authored-By` or other attribution lines in commits.
- Before each commit: `npm run typecheck` and `npm test` pass.

## File Map

| File                                              | Status | Responsibility                                                       |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `src/main/tunnel/api.ts`                          | create | playit API client and error mapping                                  |
| `src/main/tunnel/binary.ts`                       | create | download/verify/cache `playitd.exe`                                  |
| `src/main/tunnel/account.ts`                      | create | claim flow, secret file read/write/delete                            |
| `src/main/tunnel/agent.ts`                        | create | `AgentProcess`: spawn, classify log lines, restart backoff, stop     |
| `src/main/tunnel/service.ts`                      | create | `TunnelService`                                                      |
| `src/main/integration/playit.integration.test.ts` | create | opt-in live checks (download; API with `PLAYIT_TEST_SECRET`)         |
| `src/shared/types.ts`                             | modify | `ServerTunnel`, `ServerRecord.tunnel`, `TunnelState`, `TunnelStatus` |
| `src/main/servers/service.ts`                     | modify | `onRemoved` hook                                                     |
| `src/main/services.ts`                            | modify | construct and wire the tunnel module                                 |
| `src/main/ipc.ts`                                 | modify | `tunnel:*` handlers                                                  |
| `src/main/index.ts`                               | modify | pass `openUrl`; stop the agent on quit                               |
| `src/shared/api.ts`                               | modify | channels and event payload                                           |
| `src/renderer/src/lib/api.ts`                     | modify | tunnel API calls                                                     |
| `src/renderer/src/pages/tabs/ConnectTab.tsx`      | modify | sharing card; port guide collapsed                                   |
| `src/renderer/src/pages/ServerDetail.tsx`         | modify | pass `onChanged` to ConnectTab                                       |
| `docs/smoke-test.md`                              | modify | tunnel smoke items                                                   |

---

### Task 1: playit API client (`api.ts`) and live API check

**Files:**

- Create: `src/main/tunnel/api.ts`
- Create: `src/main/integration/playit.integration.test.ts`
- Test: `src/main/tunnel/api.test.ts`

**Interfaces:**

- Consumes: `AppError` from `src/main/errors.ts`.
- Produces:

  ```ts
  export const PLAYIT_API_BASE = 'https://api.playit.gg'
  export const TUNNEL_LIMIT_MESSAGE: string
  export type ClaimSetupState =
    'WaitingForUserVisit' | 'WaitingForUser' | 'UserAccepted' | 'UserRejected'
  export interface PlayitTunnel {
    id: string
    name: string
    displayAddress: string
    tunnelType: string | null
    localPort: number | null
    disabledReason: string | null
  }
  export interface RunData {
    agentId: string
    tunnels: PlayitTunnel[]
  }
  export interface PlayitApi {
    claimSetup(code: string): Promise<ClaimSetupState>
    claimExchange(code: string): Promise<string | null> // null = not accepted yet
    rundata(secret: string): Promise<RunData>
    createTunnel(
      secret: string,
      opts: { agentId: string; localPort: number; name: string }
    ): Promise<string>
    setTunnelPort(secret: string, tunnelId: string, localPort: number): Promise<void>
    deleteTunnel(secret: string, tunnelId: string): Promise<void>
  }
  export function createPlayitApi(fetchImpl?: typeof fetch, base?: string): PlayitApi
  export function claimExpired(): AppError // PLAYIT_CLAIM_EXPIRED
  export function claimRejected(): AppError // PLAYIT_CLAIM_REJECTED
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/main/tunnel/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPlayitApi, TUNNEL_LIMIT_MESSAGE } from './api'

interface Call {
  url: string
  headers: Record<string, string>
  body: unknown
}

function fakeFetch(...responses: (unknown | Error | { status: number; body: unknown })[]) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body))
    })
    const next = responses.shift()
    if (next instanceof Error) throw next
    if (next && typeof next === 'object' && 'status' in next && typeof next.status === 'number') {
      const r = next as { status: number; body: unknown }
      return new Response(JSON.stringify(r.body), { status: r.status })
    }
    return new Response(JSON.stringify(next), { status: 200 })
  }) as unknown as typeof fetch
  return { calls, api: createPlayitApi(fetchImpl, 'https://api.test') }
}

const AGENT = '11111111-1111-4111-8111-111111111111'
const TUNNEL = '22222222-2222-4222-8222-222222222222'

describe('claim', () => {
  it('posts the code for setup without auth', async () => {
    const { calls, api } = fakeFetch({ status: 'success', data: 'WaitingForUser' })
    expect(await api.claimSetup('abc')).toBe('WaitingForUser')
    expect(calls[0].url).toBe('https://api.test/claim/setup')
    expect(calls[0].body).toEqual({ code: 'abc', agent_type: 'self-managed', version: 'blockhost' })
    expect(calls[0].headers.Authorization).toBeUndefined()
  })

  it('maps setup and exchange failures', async () => {
    const { api } = fakeFetch(
      { status: 'fail', data: 'CodeExpired' },
      { status: 'fail', data: 'NotAccepted' },
      { status: 'fail', data: 'UserRejected' },
      { status: 'fail', data: 'CodeNotFound' },
      { status: 'success', data: { secret_key: 'k3y' } }
    )
    await expect(api.claimSetup('abc')).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_EXPIRED' })
    expect(await api.claimExchange('abc')).toBeNull()
    await expect(api.claimExchange('abc')).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_REJECTED' })
    await expect(api.claimExchange('abc')).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_EXPIRED' })
    expect(await api.claimExchange('abc')).toBe('k3y')
  })
})

describe('rundata', () => {
  it('sends the agent key and maps tunnels', async () => {
    const { calls, api } = fakeFetch({
      status: 'success',
      data: {
        agent_id: AGENT,
        tunnels: [
          {
            id: TUNNEL,
            name: 'Blockhost Survival',
            display_address: 'abc.gl.joinmc.link',
            tunnel_type: 'minecraft-java',
            agent_config: {
              fields: [
                { name: 'local_ip', value: '127.0.0.1' },
                { name: 'local_port', value: '25565' }
              ]
            },
            disabled_reason: null
          },
          { id: 'x', display_address: 'y:1', agent_config: { fields: [] } }
        ],
        pending: []
      }
    })
    const run = await api.rundata(' s3cret ')
    expect(calls[0].url).toBe('https://api.test/v1/agents/rundata')
    expect(calls[0].headers.Authorization).toBe('Agent-Key s3cret')
    expect(run).toEqual({
      agentId: AGENT,
      tunnels: [
        {
          id: TUNNEL,
          name: 'Blockhost Survival',
          displayAddress: 'abc.gl.joinmc.link',
          tunnelType: 'minecraft-java',
          localPort: 25565,
          disabledReason: null
        },
        {
          id: 'x',
          name: '',
          displayAddress: 'y:1',
          tunnelType: null,
          localPort: null,
          disabledReason: null
        }
      ]
    })
  })

  it('maps an invalid key to PLAYIT_UNAUTHORIZED and other auth errors to PLAYIT_FORBIDDEN', async () => {
    const { api } = fakeFetch(
      { status: 'error', data: { type: 'auth', message: 'InvalidAgentKey' } },
      { status: 'error', data: { type: 'auth', message: 'ScopeNotAllowed' } },
      { status: 'error', data: { type: 'internal', message: { trace_id: 1 } } }
    )
    await expect(api.rundata('s')).rejects.toMatchObject({ code: 'PLAYIT_UNAUTHORIZED' })
    await expect(api.rundata('s')).rejects.toMatchObject({ code: 'PLAYIT_FORBIDDEN' })
    await expect(api.rundata('s')).rejects.toMatchObject({ code: 'PLAYIT_API' })
  })

  it('maps network failures, rate limits and junk responses', async () => {
    const { api } = fakeFetch(new Error('getaddrinfo ENOTFOUND'), { status: 429, body: {} })
    await expect(api.rundata('s')).rejects.toMatchObject({ code: 'NETWORK' })
    await expect(api.rundata('s')).rejects.toMatchObject({ code: 'PLAYIT_API' })
    const junk = createPlayitApi(
      (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch,
      'https://api.test'
    )
    await expect(junk.rundata('s')).rejects.toMatchObject({
      code: 'PLAYIT_API',
      message: expect.stringContaining('HTTP 502')
    })
  })
})

describe('tunnels', () => {
  it('creates a minecraft-java tunnel to the local port', async () => {
    const { calls, api } = fakeFetch({ status: 'success', data: { id: TUNNEL } })
    const id = await api.createTunnel('s', {
      agentId: AGENT,
      localPort: 25570,
      name: 'Blockhost SMP'
    })
    expect(id).toBe(TUNNEL)
    expect(calls[0].url).toBe('https://api.test/v1/tunnels/create')
    expect(calls[0].body).toEqual({
      ports: { type: 'tunnel-type', details: 'minecraft-java' },
      origin: {
        type: 'agent',
        data: {
          agent_id: AGENT,
          config: {
            fields: [
              { name: 'local_ip', value: '127.0.0.1' },
              { name: 'local_port', value: '25570' }
            ]
          }
        }
      },
      enabled: true,
      alloc: null,
      name: 'Blockhost SMP',
      firewall_id: null
    })
  })

  it('maps create refusals', async () => {
    const { api } = fakeFetch(
      { status: 'error', data: { type: 'auth', message: 'ScopeNotAllowed' } },
      { status: 'fail', data: 'RequiresPlayitPremium' },
      { status: 'fail', data: 'RequiresVerifiedAccount' },
      { status: 'fail', data: 'InvalidTunnelConfig' }
    )
    const opts = { agentId: AGENT, localPort: 25565, name: 'x' }
    await expect(api.createTunnel('s', opts)).rejects.toMatchObject({
      code: 'PLAYIT_CREATE_FORBIDDEN'
    })
    await expect(api.createTunnel('s', opts)).rejects.toMatchObject({
      code: 'PLAYIT_TUNNEL_LIMIT',
      message: TUNNEL_LIMIT_MESSAGE
    })
    await expect(api.createTunnel('s', opts)).rejects.toMatchObject({
      code: 'PLAYIT_API',
      message: expect.stringContaining('Verify your email')
    })
    await expect(api.createTunnel('s', opts)).rejects.toMatchObject({
      code: 'PLAYIT_CREATE_FORBIDDEN'
    })
  })

  it('updates the local port and deletes tunnels', async () => {
    const { calls, api } = fakeFetch(
      { status: 'success', data: null },
      { status: 'success', data: null },
      { status: 'fail', data: 'TunnelNotFound' }
    )
    await api.setTunnelPort('s', TUNNEL, 25570)
    expect(calls[0].url).toBe('https://api.test/v1/tunnels/config')
    expect(calls[0].body).toEqual({
      tunnel_id: TUNNEL,
      new_agent_id: null,
      new_config: {
        fields: [
          { name: 'local_ip', value: '127.0.0.1' },
          { name: 'local_port', value: '25570' }
        ]
      }
    })
    await api.deleteTunnel('s', TUNNEL)
    expect(calls[1].url).toBe('https://api.test/tunnels/delete')
    expect(calls[1].body).toEqual({ tunnel_id: TUNNEL })
    await expect(api.deleteTunnel('s', TUNNEL)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/tunnel/api.test.ts`
Expected: FAIL — cannot resolve `./api`.

- [ ] **Step 3: Implement `api.ts`**

Create `src/main/tunnel/api.ts`:

```ts
import { AppError } from '../errors'

export const PLAYIT_API_BASE = 'https://api.playit.gg'
/** Version text sent when claiming; playit rejects long values. */
const CLAIM_VERSION = 'blockhost'

export const TUNNEL_LIMIT_MESSAGE =
  'Your playit.gg account has no free tunnels left. Remove one on playit.gg or turn sharing off for another server.'

export type ClaimSetupState =
  'WaitingForUserVisit' | 'WaitingForUser' | 'UserAccepted' | 'UserRejected'

export interface PlayitTunnel {
  id: string
  name: string
  displayAddress: string
  tunnelType: string | null
  localPort: number | null
  disabledReason: string | null
}

export interface RunData {
  agentId: string
  tunnels: PlayitTunnel[]
}

export interface PlayitApi {
  claimSetup(code: string): Promise<ClaimSetupState>
  /** Returns null while the user has not accepted yet. */
  claimExchange(code: string): Promise<string | null>
  rundata(secret: string): Promise<RunData>
  createTunnel(
    secret: string,
    opts: { agentId: string; localPort: number; name: string }
  ): Promise<string>
  setTunnelPort(secret: string, tunnelId: string, localPort: number): Promise<void>
  deleteTunnel(secret: string, tunnelId: string): Promise<void>
}

export const claimExpired = (): AppError =>
  new AppError('PLAYIT_CLAIM_EXPIRED', 'The playit.gg link request expired. Try linking again.')
export const claimRejected = (): AppError =>
  new AppError('PLAYIT_CLAIM_REJECTED', 'The playit.gg link request was declined.')

type Envelope =
  | { status: 'success'; data: unknown }
  | { status: 'fail'; data: unknown }
  | { status: 'error'; data?: { type?: string; message?: unknown } }

type Outcome<T> = { ok: true; data: T } | { ok: false; reason: string }

const INVALID_KEY_REASONS = new Set([
  'AuthRequired',
  'InvalidHeader',
  'InvalidSignature',
  'InvalidTimestamp',
  'InvalidApiKey',
  'InvalidAgentKey',
  'SessionExpired',
  'NoLongerValid'
])
const PREMIUM_REASONS = new Set([
  'RequiresPlayitPremium',
  'PublicPortRequiresPlayitPremium',
  'RegionRequiresPlayitPremium'
])

interface RawTunnel {
  id: string
  name?: string
  display_address?: string
  tunnel_type?: string | null
  agent_config?: { fields?: { name: string; value: string }[] }
  disabled_reason?: string | null
}

const localFields = (localPort: number): { name: string; value: string }[] => [
  { name: 'local_ip', value: '127.0.0.1' },
  { name: 'local_port', value: String(localPort) }
]

function toTunnel(raw: RawTunnel): PlayitTunnel {
  const portField = raw.agent_config?.fields?.find((f) => f.name === 'local_port')?.value
  const port = portField !== undefined && /^\d+$/.test(portField) ? Number(portField) : null
  return {
    id: raw.id,
    name: raw.name ?? '',
    displayAddress: raw.display_address ?? '',
    tunnelType: raw.tunnel_type ?? null,
    localPort: port,
    disabledReason: raw.disabled_reason ?? null
  }
}

const refused = (what: string, reason: string): AppError =>
  new AppError('PLAYIT_API', `playit.gg refused to ${what} (${reason})`, { reason })

export function createPlayitApi(
  fetchImpl: typeof fetch = fetch,
  base: string = PLAYIT_API_BASE
): PlayitApi {
  async function call<T>(path: string, body: unknown, secret?: string): Promise<Outcome<T>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (secret) headers.Authorization = `Agent-Key ${secret.trim()}`
    let res: Response
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      })
    } catch (err) {
      throw new AppError('NETWORK', `Could not reach playit.gg: ${(err as Error).message}`)
    }
    if (res.status === 429) {
      throw new AppError(
        'PLAYIT_API',
        'playit.gg is limiting requests right now. Try again in a minute.'
      )
    }
    let envelope: Envelope
    try {
      envelope = (await res.json()) as Envelope
    } catch {
      throw new AppError(
        'PLAYIT_API',
        `playit.gg returned an unexpected response (HTTP ${res.status})`
      )
    }
    if (envelope.status === 'success') return { ok: true, data: envelope.data as T }
    if (envelope.status === 'fail') {
      const reason =
        typeof envelope.data === 'string' ? envelope.data : JSON.stringify(envelope.data)
      return { ok: false, reason }
    }
    const type = envelope.data?.type ?? 'unknown'
    const raw = envelope.data?.message
    const message = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null)
    if (type === 'auth' && INVALID_KEY_REASONS.has(message)) {
      throw new AppError(
        'PLAYIT_UNAUTHORIZED',
        'playit.gg no longer accepts the saved key. Link your playit.gg account again.',
        { reason: message }
      )
    }
    if (type === 'auth') {
      throw new AppError('PLAYIT_FORBIDDEN', `playit.gg did not allow this request (${message})`, {
        reason: message
      })
    }
    throw new AppError('PLAYIT_API', `playit.gg returned an error (${type}: ${message})`, {
      type,
      reason: message
    })
  }

  return {
    async claimSetup(code) {
      const r = await call<ClaimSetupState>('/claim/setup', {
        code,
        agent_type: 'self-managed',
        version: CLAIM_VERSION
      })
      if (r.ok) return r.data
      if (r.reason === 'CodeExpired') throw claimExpired()
      throw refused('start linking', r.reason)
    },

    async claimExchange(code) {
      const r = await call<{ secret_key: string }>('/claim/exchange', { code })
      if (r.ok) return r.data.secret_key
      if (r.reason === 'NotAccepted') return null
      if (r.reason === 'UserRejected') throw claimRejected()
      if (r.reason === 'CodeExpired' || r.reason === 'CodeNotFound') throw claimExpired()
      throw refused('finish linking', r.reason)
    },

    async rundata(secret) {
      const r = await call<{ agent_id: string; tunnels?: RawTunnel[] }>(
        '/v1/agents/rundata',
        {},
        secret
      )
      if (!r.ok) throw refused('load the agent', r.reason)
      return { agentId: r.data.agent_id, tunnels: (r.data.tunnels ?? []).map(toTunnel) }
    },

    async createTunnel(secret, { agentId, localPort, name }) {
      let r: Outcome<{ id: string }>
      try {
        r = await call<{ id: string }>(
          '/v1/tunnels/create',
          {
            ports: { type: 'tunnel-type', details: 'minecraft-java' },
            origin: {
              type: 'agent',
              data: { agent_id: agentId, config: { fields: localFields(localPort) } }
            },
            enabled: true,
            alloc: null,
            name,
            firewall_id: null
          },
          secret
        )
      } catch (err) {
        if (err instanceof AppError && err.code === 'PLAYIT_FORBIDDEN') {
          throw new AppError(
            'PLAYIT_CREATE_FORBIDDEN',
            'playit.gg does not let Blockhost create the tunnel for you.',
            err.details
          )
        }
        throw err
      }
      if (r.ok) return r.data.id
      if (PREMIUM_REASONS.has(r.reason)) {
        throw new AppError('PLAYIT_TUNNEL_LIMIT', TUNNEL_LIMIT_MESSAGE, { reason: r.reason })
      }
      if (r.reason === 'RequiresVerifiedAccount') {
        throw new AppError(
          'PLAYIT_API',
          'Verify your email address on playit.gg, then try again.',
          {
            reason: r.reason
          }
        )
      }
      throw new AppError(
        'PLAYIT_CREATE_FORBIDDEN',
        `playit.gg would not create the tunnel (${r.reason}).`,
        { reason: r.reason }
      )
    },

    async setTunnelPort(secret, tunnelId, localPort) {
      const r = await call<null>(
        '/v1/tunnels/config',
        { tunnel_id: tunnelId, new_agent_id: null, new_config: { fields: localFields(localPort) } },
        secret
      )
      if (!r.ok) throw refused('update the tunnel', r.reason)
    },

    async deleteTunnel(secret, tunnelId) {
      const r = await call<null>('/tunnels/delete', { tunnel_id: tunnelId }, secret)
      if (!r.ok && r.reason !== 'TunnelNotFound') throw refused('delete the tunnel', r.reason)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/tunnel/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the opt-in live API check**

Create `src/main/integration/playit.integration.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import { createPlayitApi } from '../tunnel/api'

const secret = process.env.PLAYIT_TEST_SECRET

describe.skipIf(!secret)('playit.gg API (live, needs PLAYIT_TEST_SECRET)', () => {
  it('creates, finds and deletes a Minecraft Java tunnel', async () => {
    const api = createPlayitApi()
    const run = await api.rundata(secret!)
    expect(run.agentId).toMatch(/^[0-9a-f-]{36}$/)

    const port = 40000 + Math.floor(Math.random() * 1000)
    let id: string
    try {
      id = await api.createTunnel(secret!, {
        agentId: run.agentId,
        localPort: port,
        name: 'Blockhost test'
      })
    } catch (err) {
      if (err instanceof AppError && err.code === 'PLAYIT_CREATE_FORBIDDEN') {
        console.warn(
          `Tunnel creation is not allowed for this key: ${err.message} — the needs-setup fallback applies.`
        )
        return
      }
      throw err
    }
    try {
      const tunnel = await vi.waitFor(
        async () => {
          const found = (await api.rundata(secret!)).tunnels.find((t) => t.id === id)
          expect(found).toBeDefined()
          return found!
        },
        { timeout: 30_000, interval: 2_000 }
      )
      expect(tunnel.localPort).toBe(port)
      expect(tunnel.tunnelType).toBe('minecraft-java')
    } finally {
      await api.deleteTunnel(secret!, id)
    }
  })
})
```

Run: `npm run test:integration -- src/main/integration/playit.integration.test.ts`
Expected: the suite is reported as skipped (no `PLAYIT_TEST_SECRET` set). Do not set a secret yourself.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass.

```bash
git add src/main/tunnel/api.ts src/main/tunnel/api.test.ts src/main/integration/playit.integration.test.ts
git commit -m "feat: add playit.gg API client"
```

---

### Task 2: playitd download (`binary.ts`)

**Files:**

- Create: `src/main/tunnel/binary.ts`
- Modify: `src/main/integration/playit.integration.test.ts` (add a download case)
- Test: `src/main/tunnel/binary.test.ts`

**Interfaces:**

- Consumes: `DownloadFn` from `src/main/net/download.ts` (`(opts: { url, dest, hash?: { algo, value }, onProgress?: (received, total?) => void }) => Promise<void>`; it verifies the hash and throws `HASH_MISMATCH`); `pathExists` from `src/main/util/fs.ts`; `fakeDownload`, `tempDir` from `src/main/test-utils.ts`.
- Produces:

  ```ts
  export const PLAYITD_VERSION = '1.0.12'
  export const PLAYITD_URL: string
  export const PLAYITD_SHA256: string
  export function sha256File(path: string): Promise<string>
  export interface PlayitdBinaryDeps {
    dir: string
    download: DownloadFn
    hashFile?: (path: string) => Promise<string>
  }
  export class PlayitdBinary {
    constructor(deps: PlayitdBinaryDeps)
    path(): string // <dir>/playitd-1.0.12.exe
    ensure(onProgress?: (percent: number) => void): Promise<string>
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/main/tunnel/binary.test.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fakeDownload, tempDir } from '../test-utils'
import { PLAYITD_SHA256, PLAYITD_URL, PlayitdBinary, sha256File } from './binary'

describe('PlayitdBinary', () => {
  it('downloads the pinned release with its checksum when missing', async () => {
    const dir = await tempDir()
    const dl = fakeDownload()
    const binary = new PlayitdBinary({ dir, download: dl.fn, hashFile: async () => PLAYITD_SHA256 })
    const exe = await binary.ensure()
    expect(exe).toBe(join(dir, 'playitd-1.0.12.exe'))
    expect(dl.calls).toHaveLength(1)
    expect(dl.calls[0]).toMatchObject({
      url: PLAYITD_URL,
      dest: exe,
      hash: { algo: 'sha256', value: PLAYITD_SHA256 }
    })
  })

  it('reuses a cached file whose hash matches', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'playitd-1.0.12.exe'), 'cached')
    const dl = fakeDownload()
    const binary = new PlayitdBinary({ dir, download: dl.fn, hashFile: async () => PLAYITD_SHA256 })
    await binary.ensure()
    expect(dl.calls).toHaveLength(0)
    expect(await readFile(binary.path(), 'utf8')).toBe('cached')
  })

  it('replaces a cached file whose hash does not match', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'playitd-1.0.12.exe'), 'tampered')
    const dl = fakeDownload()
    const binary = new PlayitdBinary({ dir, download: dl.fn, hashFile: async () => 'deadbeef' })
    await binary.ensure()
    expect(dl.calls).toHaveLength(1)
    expect(await readFile(binary.path(), 'utf8')).toBe('x')
  })

  it('reports progress as a percentage and shares one download between callers', async () => {
    const dir = await tempDir()
    const download = vi.fn(
      async (opts: { onProgress?: (r: number, t?: number) => void; dest: string }) => {
        opts.onProgress?.(50, 200)
        opts.onProgress?.(200, 200)
        await writeFile(opts.dest, 'x')
      }
    )
    const binary = new PlayitdBinary({ dir, download, hashFile: async () => PLAYITD_SHA256 })
    const progress: number[] = []
    await Promise.all([binary.ensure((p) => progress.push(p)), binary.ensure()])
    expect(download).toHaveBeenCalledTimes(1)
    expect(progress).toEqual([25, 100])
  })
})

describe('sha256File', () => {
  it('hashes file contents', async () => {
    const file = join(await tempDir(), 'f')
    await writeFile(file, 'abc')
    expect(await sha256File(file)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/tunnel/binary.test.ts`
Expected: FAIL — cannot resolve `./binary`.

- [ ] **Step 3: Implement `binary.ts`**

Create `src/main/tunnel/binary.ts`:

```ts
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { DownloadFn } from '../net/download'
import { pathExists } from '../util/fs'

export const PLAYITD_VERSION = '1.0.12'
export const PLAYITD_URL = `https://github.com/playit-cloud/playit-agent/releases/download/v${PLAYITD_VERSION}/playit-windows-x86_64-signed.exe`
export const PLAYITD_SHA256 = '367fb813a20c67c7501e3921298ce51a641e5b25e6005f6059808f89404ba44b'

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export interface PlayitdBinaryDeps {
  dir: string
  download: DownloadFn
  hashFile?: (path: string) => Promise<string>
}

/** The pinned playit agent daemon, downloaded on first use. */
export class PlayitdBinary {
  private readonly deps: PlayitdBinaryDeps
  private inflight: Promise<string> | null = null

  constructor(deps: PlayitdBinaryDeps) {
    this.deps = deps
  }

  path(): string {
    return join(this.deps.dir, `playitd-${PLAYITD_VERSION}.exe`)
  }

  ensure(onProgress?: (percent: number) => void): Promise<string> {
    if (!this.inflight) {
      this.inflight = this.install(onProgress).finally(() => {
        this.inflight = null
      })
    }
    return this.inflight
  }

  private async install(onProgress?: (percent: number) => void): Promise<string> {
    const exe = this.path()
    const hashFile = this.deps.hashFile ?? sha256File
    if (await pathExists(exe)) {
      if ((await hashFile(exe)).toLowerCase() === PLAYITD_SHA256) return exe
      await rm(exe, { force: true })
    }
    await this.deps.download({
      url: PLAYITD_URL,
      dest: exe,
      hash: { algo: 'sha256', value: PLAYITD_SHA256 },
      onProgress: (received, total) => {
        if (total) onProgress?.(Math.floor((received * 100) / total))
      }
    })
    return exe
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/tunnel/binary.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a live download check**

In `src/main/integration/playit.integration.test.ts`, add imports:

```ts
import { downloadFile } from '../net/download'
import { tempDir } from '../test-utils'
import { PlayitdBinary, sha256File, PLAYITD_SHA256 } from '../tunnel/binary'
```

and append at the end of the file:

```ts
describe('playitd download (network, ~5 MB)', () => {
  it('downloads the pinned agent and verifies its checksum', async () => {
    const binary = new PlayitdBinary({ dir: await tempDir(), download: downloadFile })
    const exe = await binary.ensure()
    expect(await sha256File(exe)).toBe(PLAYITD_SHA256)
  })
})
```

Run: `npm run test:integration -- src/main/integration/playit.integration.test.ts`
Expected: the download test PASSES; the API suite is skipped.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass.

```bash
git add src/main/tunnel/binary.ts src/main/tunnel/binary.test.ts src/main/integration/playit.integration.test.ts
git commit -m "feat: download the pinned playit agent"
```

---

### Task 3: Account linking (`account.ts`)

**Files:**

- Create: `src/main/tunnel/account.ts`
- Test: `src/main/tunnel/account.test.ts`

**Interfaces:**

- Consumes: `PlayitApi`, `claimExpired`, `claimRejected` (Task 1); `writeFileAtomic` from `src/main/util/fs.ts`; `AppError`.
- Produces:

  ```ts
  export const CLAIM_URL = 'https://playit.gg/claim/'
  export const CLAIM_POLL_MS = 2000
  export const CLAIM_TIMEOUT_MS = 600000
  export function secretFileContent(key: string): string // 'secret_key = "<key>"\n'
  export function parseSecretFile(text: string): string | null
  export interface PlayitAccountDeps {
    file: string
    api: Pick<PlayitApi, 'claimSetup' | 'claimExchange'>
    openUrl: (url: string) => Promise<void>
    randomCode?: () => string
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
    now?: () => number
  }
  export class PlayitAccount {
    constructor(deps: PlayitAccountDeps)
    secret(): Promise<string | null>
    isLinked(): Promise<boolean>
    link(): Promise<void> // same promise while a link is in progress
    cancelLink(): void // the pending link() rejects with CANCELLED
    unlink(): Promise<void> // cancels any link and deletes the secret file
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/main/tunnel/account.test.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tempDir } from '../test-utils'
import { claimExpired, claimRejected, type ClaimSetupState } from './api'
import { CLAIM_TIMEOUT_MS, parseSecretFile, PlayitAccount, secretFileContent } from './account'

async function setup(
  opts: {
    setup?: ClaimSetupState[]
    exchange?: (string | null)[]
    setupError?: Error
    exchangeError?: Error
  } = {}
) {
  const file = join(await tempDir(), 'playit', 'playit.toml')
  const setupStates = [...(opts.setup ?? ['WaitingForUserVisit', 'WaitingForUser', 'UserAccepted'])]
  const exchanges = [...(opts.exchange ?? [null, 'secret123'])]
  let clock = 0
  const api = {
    claimSetup: vi.fn(async () => {
      if (opts.setupError) throw opts.setupError
      return setupStates.length > 1 ? setupStates.shift()! : setupStates[0]
    }),
    claimExchange: vi.fn(async () => {
      if (opts.exchangeError) throw opts.exchangeError
      return exchanges.length > 1 ? exchanges.shift()! : exchanges[0]
    })
  }
  const openUrl = vi.fn(async () => {})
  const sleep = vi.fn(async (ms: number, signal: AbortSignal) => {
    clock += ms
    await Promise.resolve()
    if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'CANCELLED' })
  })
  const account = new PlayitAccount({
    file,
    api,
    openUrl,
    randomCode: () => 'c0de',
    sleep,
    now: () => clock
  })
  return { file, api, openUrl, sleep, account }
}

describe('secret file', () => {
  it('writes and parses the playitd format', () => {
    expect(secretFileContent('abc123')).toBe('secret_key = "abc123"\n')
    expect(parseSecretFile('secret_key = "abc123"\n')).toBe('abc123')
    expect(parseSecretFile('# comment\nsecret_key="  k  "')).toBe('k')
    expect(parseSecretFile('secret_key = ""')).toBeNull()
    expect(parseSecretFile('nonsense')).toBeNull()
  })
})

describe('PlayitAccount', () => {
  it('is not linked without a secret file', async () => {
    const { account } = await setup()
    expect(await account.isLinked()).toBe(false)
    expect(await account.secret()).toBeNull()
  })

  it('opens the claim URL, waits for acceptance and saves the key', async () => {
    const { account, openUrl, api, file } = await setup()
    await account.link()
    expect(openUrl).toHaveBeenCalledWith('https://playit.gg/claim/c0de')
    expect(api.claimSetup).toHaveBeenCalledTimes(3)
    expect(api.claimSetup).toHaveBeenCalledWith('c0de')
    expect(api.claimExchange).toHaveBeenCalledTimes(2)
    expect(await readFile(file, 'utf8')).toBe('secret_key = "secret123"\n')
    expect(await account.isLinked()).toBe(true)
  })

  it('rejects when the user declines', async () => {
    const { account, file } = await setup({ setup: ['WaitingForUser', 'UserRejected'] })
    await expect(account.link()).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_REJECTED' })
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })

  it('passes through expiry and rejection from the API', async () => {
    const expired = await setup({ setupError: claimExpired() })
    await expect(expired.account.link()).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_EXPIRED' })
    const rejected = await setup({ exchangeError: claimRejected() })
    await expect(rejected.account.link()).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_REJECTED' })
  })

  it('gives up after ten minutes', async () => {
    const { account, sleep } = await setup({ setup: ['WaitingForUserVisit'] })
    await expect(account.link()).rejects.toMatchObject({ code: 'PLAYIT_CLAIM_EXPIRED' })
    const waited = sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0)
    expect(waited).toBeGreaterThanOrEqual(CLAIM_TIMEOUT_MS)
    expect(waited).toBeLessThan(CLAIM_TIMEOUT_MS + 5000)
  })

  it('shares one attempt and can be cancelled', async () => {
    const { account, api } = await setup({ setup: ['WaitingForUserVisit'] })
    const first = account.link()
    const second = account.link()
    expect(second).toBe(first)
    account.cancelLink()
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(api.claimSetup.mock.calls.length).toBeLessThan(5)
  })

  it('rejects a key with unexpected characters', async () => {
    const { account } = await setup({ exchange: ['bad key"\n'] })
    await expect(account.link()).rejects.toMatchObject({ code: 'PLAYIT_API' })
  })

  it('unlinks by deleting the secret file', async () => {
    const { account, file } = await setup()
    await account.link()
    await account.unlink()
    expect(await account.isLinked()).toBe(false)
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })

  it('reads a secret file written by hand', async () => {
    const { account, file } = await setup()
    await account.link()
    await writeFile(file, 'secret_key = "other"\n')
    expect(await account.secret()).toBe('other')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/tunnel/account.test.ts`
Expected: FAIL — cannot resolve `./account`.

- [ ] **Step 3: Implement `account.ts`**

Create `src/main/tunnel/account.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { AppError } from '../errors'
import { writeFileAtomic } from '../util/fs'
import { claimExpired, claimRejected, type PlayitApi } from './api'

export const CLAIM_URL = 'https://playit.gg/claim/'
export const CLAIM_POLL_MS = 2000
export const CLAIM_TIMEOUT_MS = 10 * 60 * 1000

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/

export function secretFileContent(key: string): string {
  return `secret_key = "${key}"\n`
}

export function parseSecretFile(text: string): string | null {
  const match = /^\s*secret_key\s*=\s*"([^"]*)"\s*$/m.exec(text)
  const key = match?.[1].trim()
  return key ? key : null
}

const cancelled = (): AppError => new AppError('CANCELLED', 'Linking was cancelled.')

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(cancelled())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export interface PlayitAccountDeps {
  file: string
  api: Pick<PlayitApi, 'claimSetup' | 'claimExchange'>
  openUrl: (url: string) => Promise<void>
  randomCode?: () => string
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

/** The app's playit.gg agent key, stored where playitd reads it. */
export class PlayitAccount {
  private readonly deps: PlayitAccountDeps
  private current: { promise: Promise<void>; controller: AbortController } | null = null

  constructor(deps: PlayitAccountDeps) {
    this.deps = deps
  }

  async secret(): Promise<string | null> {
    try {
      return parseSecretFile(await readFile(this.deps.file, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async isLinked(): Promise<boolean> {
    return (await this.secret()) !== null
  }

  link(): Promise<void> {
    if (this.current) return this.current.promise
    const controller = new AbortController()
    const promise = this.run(controller.signal).finally(() => {
      this.current = null
    })
    this.current = { promise, controller }
    return promise
  }

  cancelLink(): void {
    this.current?.controller.abort()
  }

  async unlink(): Promise<void> {
    this.cancelLink()
    await rm(this.deps.file, { force: true })
  }

  private async run(signal: AbortSignal): Promise<void> {
    const sleep = this.deps.sleep ?? abortableSleep
    const now = this.deps.now ?? Date.now
    const code = (this.deps.randomCode ?? (() => randomBytes(16).toString('hex')))()
    await this.deps.openUrl(`${CLAIM_URL}${code}`)
    const deadline = now() + CLAIM_TIMEOUT_MS

    const wait = async (): Promise<void> => {
      if (now() >= deadline) throw claimExpired()
      await sleep(CLAIM_POLL_MS, signal)
      if (signal.aborted) throw cancelled()
    }

    for (;;) {
      if (signal.aborted) throw cancelled()
      const state = await this.deps.api.claimSetup(code)
      if (state === 'UserAccepted') break
      if (state === 'UserRejected') throw claimRejected()
      await wait()
    }

    for (;;) {
      if (signal.aborted) throw cancelled()
      const key = await this.deps.api.claimExchange(code)
      if (key !== null) {
        const trimmed = key.trim()
        if (!KEY_PATTERN.test(trimmed)) {
          throw new AppError('PLAYIT_API', 'playit.gg returned a key Blockhost cannot use.')
        }
        await writeFileAtomic(this.deps.file, secretFileContent(trimmed))
        return
      }
      await wait()
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/tunnel/account.test.ts`
Expected: PASS. (The test's fake `sleep` throws an error with `code: 'CANCELLED'` once aborted; `run` also checks `signal.aborted` after each sleep, so either path yields `CANCELLED`.)

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass.

```bash
git add src/main/tunnel/account.ts src/main/tunnel/account.test.ts
git commit -m "feat: link a playit.gg account through the browser"
```

---

### Task 4: Agent process (`agent.ts`)

**Files:**

- Create: `src/main/tunnel/agent.ts`
- Test: `src/main/tunnel/agent.test.ts`

**Interfaces:**

- Consumes: `ChildLike`, `SpawnFn` from `src/main/servers/process.ts` (`SpawnFn = (command, args, cwd) => ChildLike`; `ChildLike` has `pid?`, `stdout`, `stderr`, `stdin`, `on('close', code)`, `on('error', err)`); `stripAnsi` (`src/main/util/ansi.ts`); `LineSplitter` (`src/main/util/lines.ts`).
- Produces:

  ```ts
  export const PLAYITD_PIPE = '\\\\.\\pipe\\blockhost-playitd'
  export const RESTART_DELAYS_MS = [2000, 5000, 15000]
  export const UNLINKED_MESSAGE =
    'playit.gg no longer accepts the saved key. Link your playit.gg account again.'
  export type AgentState = 'stopped' | 'starting' | 'connected' | 'error'
  export interface AgentEvent {
    state: AgentState
    message?: string
    unauthorized?: boolean
  }
  export function playitdArgs(secretPath: string, socketPath?: string): string[]
  export function classifyLine(line: string): AgentEvent | null
  export interface AgentProcessDeps {
    spawn: SpawnFn
    kill: (pid: number) => Promise<void>
    exe: () => Promise<string>
    secretPath: string
    onEvent: (event: AgentEvent) => void
    delays?: number[]
  }
  export class AgentProcess {
    constructor(deps: AgentProcessDeps)
    state(): AgentState
    start(): Promise<void> // no-op if running or a restart is scheduled
    stop(): void // kills the process; emits 'stopped' once it exits
    retry(): Promise<void> // resets the failure count and starts if not running
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/main/tunnel/agent.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildLike } from '../servers/process'
import {
  AgentProcess,
  classifyLine,
  PLAYITD_PIPE,
  playitdArgs,
  UNLINKED_MESSAGE,
  type AgentEvent
} from './agent'

class FakeChild extends EventEmitter {
  pid = 777
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()

  exit(code: number): void {
    this.stdout.end()
    this.stderr.end()
    this.emit('close', code)
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function setup() {
  const children: FakeChild[] = []
  const spawn = vi.fn((_cmd: string, _args: string[], _cwd: string) => {
    const child = new FakeChild()
    children.push(child)
    return child as unknown as ChildLike
  })
  const kill = vi.fn(async () => {
    children.at(-1)?.exit(1)
  })
  const events: AgentEvent[] = []
  const agent = new AgentProcess({
    spawn,
    kill,
    exe: async () => 'C:/data/playit/playitd-1.0.12.exe',
    secretPath: 'C:/data/playit/playit.toml',
    onEvent: (e) => events.push(e)
  })
  return { spawn, kill, children, events, agent }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('playitdArgs', () => {
  it('passes the secret file and a private pipe', () => {
    expect(playitdArgs('C:/s.toml')).toEqual([
      '--secret-path',
      'C:/s.toml',
      '--socket-path',
      PLAYITD_PIPE
    ])
    expect(PLAYITD_PIPE).toBe('\\\\.\\pipe\\blockhost-playitd')
  })
})

describe('classifyLine', () => {
  it('recognises connection, errors and an invalid key', () => {
    expect(
      classifyLine(
        '2026-10-18T14:03:00Z  INFO playitd::daemon: playit connected; tunnels loaded tunnel_count=1'
      )
    ).toEqual({ state: 'connected' })
    expect(
      classifyLine(
        '\u001b[31mERROR\u001b[0m playitd: Could not connect to playit tunnel servers. Check your internet connection, firewall, VPN, or DNS settings, then restart playit.'
      )
    ).toEqual({
      state: 'error',
      message:
        'Could not connect to playit tunnel servers. Check your internet connection, firewall, VPN, or DNS settings, then restart playit.'
    })
    expect(
      classifyLine(
        'ERROR The configured playit secret is no longer valid. Run `playit setup` to provision a new secret.'
      )
    ).toEqual({ state: 'error', unauthorized: true, message: UNLINKED_MESSAGE })
    expect(classifyLine('INFO something else')).toBeNull()
  })
})

describe('AgentProcess', () => {
  it('spawns playitd and reports connection from its log', async () => {
    const { agent, spawn, children, events } = setup()
    await agent.start()
    expect(spawn).toHaveBeenCalledWith(
      'C:/data/playit/playitd-1.0.12.exe',
      ['--secret-path', 'C:/data/playit/playit.toml', '--socket-path', PLAYITD_PIPE],
      'C:/data/playit'
    )
    children[0].stderr.write('INFO playit connected; tunnels loaded\n')
    await flush()
    expect(events.map((e) => e.state)).toEqual(['starting', 'connected'])
    expect(agent.state()).toBe('connected')
  })

  it('does not spawn twice', async () => {
    const { agent, spawn } = setup()
    await agent.start()
    await agent.start()
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('restarts after 2, 5 and 15 seconds, then gives up', async () => {
    vi.useFakeTimers()
    const { agent, spawn, children, events } = setup()
    await agent.start()
    for (const delay of [2000, 5000, 15000]) {
      children.at(-1)!.exit(1)
      await vi.advanceTimersByTimeAsync(delay - 1)
      const before = spawn.mock.calls.length
      await vi.advanceTimersByTimeAsync(1)
      expect(spawn.mock.calls.length).toBe(before + 1)
    }
    children.at(-1)!.exit(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawn).toHaveBeenCalledTimes(4)
    expect(events.at(-1)).toMatchObject({
      state: 'error',
      message: expect.stringContaining('Retry')
    })
  })

  it('resets the restart count after a successful connection', async () => {
    vi.useFakeTimers()
    const { agent, spawn, children } = setup()
    await agent.start()
    children[0].exit(1)
    await vi.advanceTimersByTimeAsync(2000)
    children[1].stderr.write('playit connected; tunnels loaded\n')
    await flush()
    children[1].exit(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('stops without restarting', async () => {
    vi.useFakeTimers()
    const { agent, kill, spawn, events } = setup()
    await agent.start()
    agent.stop()
    expect(kill).toHaveBeenCalledWith(777)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toEqual({ state: 'stopped' })
  })

  it('stops itself when the key is rejected', async () => {
    const { agent, kill, children, events } = setup()
    await agent.start()
    children[0].stderr.write('ERROR The configured playit secret is no longer valid.\n')
    await flush()
    expect(events).toContainEqual({ state: 'error', unauthorized: true, message: UNLINKED_MESSAGE })
    expect(kill).toHaveBeenCalled()
  })

  it('retry starts again after giving up', async () => {
    vi.useFakeTimers()
    const { agent, spawn, children } = setup()
    await agent.start()
    for (const delay of [2000, 5000, 15000]) {
      children.at(-1)!.exit(1)
      await vi.advanceTimersByTimeAsync(delay)
    }
    children.at(-1)!.exit(1)
    await vi.advanceTimersByTimeAsync(60_000)
    await agent.retry()
    expect(spawn).toHaveBeenCalledTimes(5)
  })

  it('reports a failure to prepare the executable', async () => {
    const events: AgentEvent[] = []
    const agent = new AgentProcess({
      spawn: vi.fn(),
      kill: vi.fn(async () => {}),
      exe: async () => {
        throw new Error('Checksum mismatch for playitd-1.0.12.exe')
      },
      secretPath: 'C:/s.toml',
      onEvent: (e) => events.push(e)
    })
    await agent.start()
    expect(events.at(-1)).toEqual({
      state: 'error',
      message: 'Checksum mismatch for playitd-1.0.12.exe'
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/tunnel/agent.test.ts`
Expected: FAIL — cannot resolve `./agent`.

- [ ] **Step 3: Implement `agent.ts`**

Create `src/main/tunnel/agent.ts`:

```ts
import { dirname } from 'node:path'
import type { ChildLike, SpawnFn } from '../servers/process'
import { stripAnsi } from '../util/ansi'
import { LineSplitter } from '../util/lines'

export const PLAYITD_PIPE = '\\\\.\\pipe\\blockhost-playitd'
export const RESTART_DELAYS_MS = [2000, 5000, 15000]
export const UNLINKED_MESSAGE =
  'playit.gg no longer accepts the saved key. Link your playit.gg account again.'

const CONNECTED_MARKER = 'playit connected'
const UNAUTHORIZED_MARKERS = ['secret is no longer valid', 'Invalid secret file']
const ERROR_MARKERS = [
  'Could not connect to playit tunnel servers',
  'Could not reach the playit API',
  'The playit API rejected',
  'Timed out while connecting to playit',
  'Failed to start the playit agent'
]

export type AgentState = 'stopped' | 'starting' | 'connected' | 'error'

export interface AgentEvent {
  state: AgentState
  message?: string
  unauthorized?: boolean
}

export function playitdArgs(secretPath: string, socketPath: string = PLAYITD_PIPE): string[] {
  return ['--secret-path', secretPath, '--socket-path', socketPath]
}

export function classifyLine(line: string): AgentEvent | null {
  const text = stripAnsi(line)
  if (text.includes(CONNECTED_MARKER)) return { state: 'connected' }
  if (UNAUTHORIZED_MARKERS.some((m) => text.includes(m))) {
    return { state: 'error', unauthorized: true, message: UNLINKED_MESSAGE }
  }
  for (const marker of ERROR_MARKERS) {
    const index = text.indexOf(marker)
    if (index >= 0) return { state: 'error', message: text.slice(index).trim() }
  }
  return null
}

export interface AgentProcessDeps {
  spawn: SpawnFn
  kill: (pid: number) => Promise<void>
  exe: () => Promise<string>
  secretPath: string
  onEvent: (event: AgentEvent) => void
  delays?: number[]
}

/** Runs playitd as a child process and keeps it running until stopped. */
export class AgentProcess {
  private readonly deps: AgentProcessDeps
  private child: ChildLike | null = null
  private current: AgentState = 'stopped'
  private stopRequested = false
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(deps: AgentProcessDeps) {
    this.deps = deps
  }

  state(): AgentState {
    return this.current
  }

  async start(): Promise<void> {
    if (this.child || this.timer) return
    this.stopRequested = false
    await this.launch()
  }

  async retry(): Promise<void> {
    this.failures = 0
    await this.start()
  }

  stop(): void {
    this.stopRequested = true
    clearTimeout(this.timer)
    this.timer = undefined
    const child = this.child
    if (child?.pid) {
      void this.deps.kill(child.pid)
    } else if (!child && this.current !== 'stopped') {
      this.emit({ state: 'stopped' })
    }
  }

  private emit(event: AgentEvent): void {
    this.current = event.state
    this.deps.onEvent(event)
  }

  private async launch(): Promise<void> {
    this.timer = undefined
    this.emit({ state: 'starting' })
    let exe: string
    try {
      exe = await this.deps.exe()
    } catch (err) {
      this.emit({ state: 'error', message: (err as Error).message })
      return
    }
    if (this.stopRequested) {
      this.emit({ state: 'stopped' })
      return
    }

    const child = this.deps.spawn(
      exe,
      playitdArgs(this.deps.secretPath),
      dirname(this.deps.secretPath)
    )
    this.child = child

    const onLine = (line: string): void => {
      const event = classifyLine(line)
      if (!event) return
      if (event.state === 'connected') this.failures = 0
      this.emit(event)
      if (event.unauthorized) this.stop()
    }
    const stdout = new LineSplitter(onLine)
    const stderr = new LineSplitter(onLine)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => stdout.push(chunk))
    child.stderr.on('data', (chunk: string) => stderr.push(chunk))

    let finished = false
    const finish = (message: string): void => {
      if (finished) return
      finished = true
      stdout.flush()
      stderr.flush()
      this.child = null
      if (this.stopRequested) {
        this.emit({ state: 'stopped' })
        return
      }
      this.scheduleRestart(message)
    }
    child.on('close', (code) => finish(`The playit agent stopped (exit code ${code}).`))
    child.on('error', (err) => finish(`Could not start the playit agent: ${err.message}`))
  }

  private scheduleRestart(message: string): void {
    const delays = this.deps.delays ?? RESTART_DELAYS_MS
    const delay = delays[this.failures]
    this.failures++
    if (delay === undefined) {
      this.emit({ state: 'error', message: `${message} Click Retry to try again.` })
      return
    }
    this.emit({ state: 'starting', message })
    this.timer = setTimeout(() => void this.launch(), delay)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/tunnel/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass.

```bash
git add src/main/tunnel/agent.ts src/main/tunnel/agent.test.ts
git commit -m "feat: supervise the playit agent process"
```

---

### Task 5: Shared types and `TunnelService`

**Files:**

- Modify: `src/shared/types.ts` (add types; add `tunnel?` to `ServerRecord`)
- Create: `src/main/tunnel/service.ts`
- Test: `src/main/tunnel/service.test.ts`

**Interfaces:**

- Consumes: `PlayitApi`, `PlayitTunnel`, `RunData` (Task 1); `PlayitdBinary.ensure` (Task 2); `PlayitAccount` (Task 3); `AgentProcess`, `AgentEvent`, `UNLINKED_MESSAGE` (Task 4); `ServerStore` (`get`, `list`, `update`); `ProcessManager.status`; `AppError`; `tempDir`.
- Produces (in `src/shared/types.ts`):
  ```ts
  export interface ServerTunnel {
    enabled: boolean
    tunnelId?: string
    address?: string
  }
  // ServerRecord gains: tunnel?: ServerTunnel
  export type TunnelState =
    'off' | 'downloading' | 'connecting' | 'online' | 'needs-setup' | 'error'
  export interface TunnelStatus {
    serverId: string
    state: TunnelState
    address?: string
    localAddress: string
    message?: string
    percent?: number
  }
  export interface PlayitAccountStatus {
    linked: boolean
  }
  ```
- Produces (in `src/main/tunnel/service.ts`):
  ```ts
  export const ADDRESS_POLL_MS = 30000
  export function tunnelName(serverName: string): string
  export interface TunnelServiceDeps {
    store: Pick<ServerStore, 'get' | 'list' | 'update'>
    processes: Pick<ProcessManager, 'status'>
    account: Pick<PlayitAccount, 'isLinked' | 'secret' | 'link' | 'cancelLink' | 'unlink'>
    api: Pick<PlayitApi, 'rundata' | 'createTunnel' | 'setTunnelPort' | 'deleteTunnel'>
    binary: Pick<PlayitdBinary, 'ensure'>
    agent: Pick<AgentProcess, 'start' | 'stop' | 'retry'>
    emit: (status: TunnelStatus) => void
    pollMs?: number
    log?: (message: string) => void
  }
  export class TunnelService {
    constructor(deps: TunnelServiceDeps)
    account(): Promise<PlayitAccountStatus>
    link(): Promise<void>
    cancelLink(): void
    unlink(): Promise<void>
    setShared(serverId: string, enabled: boolean): Promise<TunnelStatus>
    status(serverId: string): TunnelStatus
    retry(serverId: string): Promise<TunnelStatus>
    onServerStatus(event: ServerStatusEvent): void
    onAgentEvent(event: AgentEvent): void
    onServerRemoved(rec: ServerRecord): void
    /** Resolves once all queued work has finished (used by tests). */
    whenIdle(): Promise<void>
    dispose(): void
  }
  ```

Behaviour notes for the implementer:

- All state changes run through one promise queue (`enqueue`) so concurrent server events, polls and user actions never interleave. Code already running inside the queue calls the private methods directly — never `enqueue` from inside the queue (that would deadlock).
- "Active" servers: `tunnel.enabled`, install `ready`, and process status `starting` or `running`. The agent runs only while at least one server is active.
- Tunnel resolution for an active server, on every refresh: the stored `tunnelId` if rundata still has it → else adopt a `minecraft-java` tunnel whose local port equals the server's port and which no other server has claimed → else create one (unless the server is in `needs-setup`, i.e. waiting for the user to create it on playit.gg). A stored tunnel with a different local port is updated with `setTunnelPort`.
- Status mapping: not enabled or server not up → `off` (with the last known address); `downloading`/`needs-setup`/`error` phases show as such; a resolved tunnel shows `online` when the agent is connected and the address is known, `error` with the agent's message when the agent reports an error, otherwise `connecting`.

- [ ] **Step 1: Add the shared types**

In `src/shared/types.ts`, add `tunnel?: ServerTunnel` as the last field of `ServerRecord` (after `createdAt`), and append:

```ts
export interface ServerTunnel {
  enabled: boolean
  tunnelId?: string
  address?: string
}

export type TunnelState = 'off' | 'downloading' | 'connecting' | 'online' | 'needs-setup' | 'error'

export interface TunnelStatus {
  serverId: string
  state: TunnelState
  /** Public address, kept from the last time playit reported it. */
  address?: string
  /** Where the tunnel must point, e.g. 127.0.0.1:25565. */
  localAddress: string
  message?: string
  percent?: number
}

export interface PlayitAccountStatus {
  linked: boolean
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/main/tunnel/service.test.ts`:

```ts
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerRecord, ServerStatus, TunnelStatus } from '../../shared/types'
import { AppError } from '../errors'
import { ServerStore } from '../servers/store'
import { tempDir } from '../test-utils'
import { UNLINKED_MESSAGE } from './agent'
import { TUNNEL_LIMIT_MESSAGE, type PlayitTunnel } from './api'
import { TunnelService, tunnelName } from './service'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const AGENT = '11111111-1111-4111-8111-111111111111'

const record = (id: string, name: string, port: number): ServerRecord => ({
  id,
  name,
  type: 'paper',
  mcVersion: '1.21.4',
  dir: `C:/servers/${name}`,
  ramMb: 2048,
  port,
  jvmArgs: [],
  launch: { args: ['-jar', 'server.jar'] },
  installState: 'ready',
  createdAt: '2026-10-18T12:00:00.000Z'
})

async function setup(opts: { linked?: boolean } = {}) {
  const store = new ServerStore(join(await tempDir(), 'servers.json'))
  await store.load()
  await store.add(record(ID, 'Survival', 25565))
  await store.add(record(ID2, 'Creative', 25570))
  const statuses = new Map<string, ServerStatus>()
  const processes = { status: vi.fn((id: string) => statuses.get(id) ?? 'stopped') }
  let linked = opts.linked ?? true
  const account = {
    isLinked: vi.fn(async () => linked),
    secret: vi.fn(async () => (linked ? 'k3y' : null)),
    link: vi.fn(async () => {
      linked = true
    }),
    cancelLink: vi.fn(),
    unlink: vi.fn(async () => {
      linked = false
    })
  }
  const tunnels: PlayitTunnel[] = []
  let nextId = 1
  const api = {
    rundata: vi.fn(async () => ({ agentId: AGENT, tunnels: structuredClone(tunnels) })),
    createTunnel: vi.fn(
      async (_s: string, o: { agentId: string; localPort: number; name: string }) => {
        const id = `t${nextId++}`
        tunnels.push({
          id,
          name: o.name,
          displayAddress: `${id}.gl.joinmc.link`,
          tunnelType: 'minecraft-java',
          localPort: o.localPort,
          disabledReason: null
        })
        return id
      }
    ),
    setTunnelPort: vi.fn(async (_s: string, id: string, port: number) => {
      tunnels.find((t) => t.id === id)!.localPort = port
    }),
    deleteTunnel: vi.fn(async () => {})
  }
  const binary = {
    ensure: vi.fn(async (onProgress?: (p: number) => void) => {
      onProgress?.(50)
      return 'C:/playitd.exe'
    })
  }
  const agent = { start: vi.fn(async () => {}), stop: vi.fn(), retry: vi.fn(async () => {}) }
  const emitted: TunnelStatus[] = []
  const service = new TunnelService({
    store,
    processes,
    account,
    api,
    binary,
    agent,
    emit: (s) => emitted.push(s),
    pollMs: 30_000,
    log: () => {}
  })
  cleanups.push(() => service.dispose())
  const up = async (id: string, status: ServerStatus = 'running') => {
    statuses.set(id, status)
    service.onServerStatus({ serverId: id, status })
    await service.whenIdle() // waits for the queue to drain
  }
  return { store, statuses, processes, account, tunnels, api, binary, agent, emitted, service, up }
}

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.useRealTimers()
})

describe('tunnelName', () => {
  it('keeps printable ASCII and caps the length', () => {
    expect(tunnelName('Survival')).toBe('Blockhost Survival')
    expect(tunnelName('Überwelt ✨')).toBe('Blockhost berwelt')
    expect(tunnelName('A very long server name indeed')).toHaveLength(30)
  })
})

describe('TunnelService', () => {
  it('requires a linked account to share', async () => {
    const { service } = await setup({ linked: false })
    await expect(service.setShared(ID, true)).rejects.toMatchObject({ code: 'PLAYIT_NOT_LINKED' })
  })

  it('does not run the agent while the shared server is stopped', async () => {
    const { service, agent, store } = await setup()
    const status = await service.setShared(ID, true)
    expect(status).toMatchObject({ state: 'off', localAddress: '127.0.0.1:25565' })
    expect(store.get(ID).tunnel).toEqual({ enabled: true })
    expect(agent.start).not.toHaveBeenCalled()
  })

  it('starts the agent, creates the tunnel and goes online', async () => {
    const { service, agent, api, binary, store, up, emitted } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    expect(binary.ensure).toHaveBeenCalled()
    expect(emitted).toContainEqual(
      expect.objectContaining({ serverId: ID, state: 'downloading', percent: 50 })
    )
    expect(agent.start).toHaveBeenCalledTimes(1)
    expect(api.createTunnel).toHaveBeenCalledWith('k3y', {
      agentId: AGENT,
      localPort: 25565,
      name: 'Blockhost Survival'
    })
    expect(store.get(ID).tunnel).toEqual({
      enabled: true,
      tunnelId: 't1',
      address: 't1.gl.joinmc.link'
    })
    expect(service.status(ID).state).toBe('connecting')

    service.onAgentEvent({ state: 'connected' })
    await service.whenIdle()
    expect(service.status(ID)).toMatchObject({ state: 'online', address: 't1.gl.joinmc.link' })
  })

  it('reuses its tunnel and fixes a changed port', async () => {
    const { service, api, store, up, statuses } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    statuses.set(ID, 'stopped')
    service.onServerStatus({ serverId: ID, status: 'stopped' })
    await store.update(ID, { port: 25600 })
    await up(ID)
    expect(api.createTunnel).toHaveBeenCalledTimes(1)
    expect(api.setTunnelPort).toHaveBeenCalledWith('k3y', 't1', 25600)
  })

  it('adopts an existing tunnel that points at the server port', async () => {
    const { service, api, store, up, tunnels } = await setup()
    tunnels.push({
      id: 'web1',
      name: 'made on playit.gg',
      displayAddress: 'web1.gl.joinmc.link',
      tunnelType: 'minecraft-java',
      localPort: 25565,
      disabledReason: null
    })
    await service.setShared(ID, true)
    await up(ID)
    expect(api.createTunnel).not.toHaveBeenCalled()
    expect(store.get(ID).tunnel?.tunnelId).toBe('web1')
  })

  it('falls back to setting the tunnel up on playit.gg when creation is not allowed', async () => {
    const { service, api, store, up, tunnels } = await setup()
    api.createTunnel.mockRejectedValueOnce(new AppError('PLAYIT_CREATE_FORBIDDEN', 'not allowed'))
    await service.setShared(ID, true)
    await up(ID)
    expect(service.status(ID)).toMatchObject({
      state: 'needs-setup',
      localAddress: '127.0.0.1:25565'
    })

    tunnels.push({
      id: 'web2',
      name: 'mine',
      displayAddress: 'web2.gl.joinmc.link',
      tunnelType: 'minecraft-java',
      localPort: 25565,
      disabledReason: null
    })
    await service.retry(ID)
    expect(store.get(ID).tunnel?.tunnelId).toBe('web2')
    expect(api.createTunnel).toHaveBeenCalledTimes(1)
  })

  it('polls for the address every 30 seconds while sharing', async () => {
    vi.useFakeTimers()
    const { service, api, up } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    const calls = api.rundata.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.rundata.mock.calls.length).toBe(calls + 1)
  })

  it('shows the tunnel limit message and recovers on retry', async () => {
    const { service, api, up } = await setup()
    api.createTunnel.mockRejectedValueOnce(
      new AppError('PLAYIT_TUNNEL_LIMIT', TUNNEL_LIMIT_MESSAGE)
    )
    await service.setShared(ID, true)
    await up(ID)
    expect(service.status(ID)).toMatchObject({ state: 'error', message: TUNNEL_LIMIT_MESSAGE })
    const after = await service.retry(ID)
    expect(after.state).toBe('connecting')
    expect(api.createTunnel).toHaveBeenCalledTimes(2)
  })

  it('stops the agent when the last shared server stops', async () => {
    const { service, agent, up, statuses } = await setup()
    await service.setShared(ID, true)
    await service.setShared(ID2, true)
    await up(ID)
    await up(ID2)
    expect(agent.start).toHaveBeenCalledTimes(1)
    statuses.set(ID, 'stopped')
    service.onServerStatus({ serverId: ID, status: 'stopped' })
    await service.whenIdle()
    expect(agent.stop).not.toHaveBeenCalled()
    statuses.set(ID2, 'stopped')
    service.onServerStatus({ serverId: ID2, status: 'stopped' })
    await service.whenIdle()
    expect(agent.stop).toHaveBeenCalledTimes(1)
    expect(service.status(ID)).toMatchObject({ state: 'off', address: 't1.gl.joinmc.link' })
  })

  it('turning sharing off stops the agent for that server', async () => {
    const { service, agent, up, store } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    const status = await service.setShared(ID, false)
    expect(status.state).toBe('off')
    expect(agent.stop).toHaveBeenCalled()
    expect(store.get(ID).tunnel).toMatchObject({ enabled: false, tunnelId: 't1' })
  })

  it('treats a rejected key as unlinked', async () => {
    const { service, api, account, agent, up } = await setup()
    await service.setShared(ID, true)
    api.rundata.mockRejectedValueOnce(new AppError('PLAYIT_UNAUTHORIZED', UNLINKED_MESSAGE))
    await up(ID)
    expect(account.unlink).toHaveBeenCalled()
    expect(agent.stop).toHaveBeenCalled()
    expect(service.status(ID)).toMatchObject({ state: 'error', message: UNLINKED_MESSAGE })
    expect(await service.account()).toEqual({ linked: false })
  })

  it('handles an unauthorized event from the agent the same way', async () => {
    const { service, account, up } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    service.onAgentEvent({ state: 'error', unauthorized: true, message: UNLINKED_MESSAGE })
    await service.whenIdle()
    expect(account.unlink).toHaveBeenCalled()
  })

  it('shows the agent error while it cannot connect', async () => {
    const { service, up } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    service.onAgentEvent({ state: 'error', message: 'Could not connect to playit tunnel servers.' })
    expect(service.status(ID)).toMatchObject({
      state: 'error',
      message: 'Could not connect to playit tunnel servers.'
    })
  })

  it('unlinking clears sharing on every server', async () => {
    const { service, store, account, up } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    await service.unlink()
    expect(account.unlink).toHaveBeenCalled()
    expect(store.get(ID).tunnel).toEqual({ enabled: false })
  })

  it('deletes the tunnel of a removed server, ignoring failures', async () => {
    const { service, api, store, up } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    api.deleteTunnel.mockRejectedValueOnce(new Error('offline'))
    service.onServerRemoved(store.get(ID))
    await vi.waitFor(() => expect(api.deleteTunnel).toHaveBeenCalledWith('k3y', 't1'))
    service.onServerRemoved(record(ID2, 'Creative', 25570))
    expect(api.deleteTunnel).toHaveBeenCalledTimes(1)
  })

  it('link clears earlier errors and starts sharing', async () => {
    const { service, account, api, up } = await setup({ linked: false })
    await up(ID)
    await service.link()
    expect(account.link).toHaveBeenCalled()
    await service.setShared(ID, true)
    expect(api.createTunnel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/main/tunnel/service.test.ts`
Expected: FAIL — cannot resolve `./service`.

- [ ] **Step 4: Implement `service.ts`**

Create `src/main/tunnel/service.ts`:

```ts
import type {
  PlayitAccountStatus,
  ServerRecord,
  ServerStatusEvent,
  ServerTunnel,
  TunnelStatus
} from '../../shared/types'
import { AppError } from '../errors'
import type { ProcessManager } from '../servers/process'
import type { ServerStore } from '../servers/store'
import type { PlayitAccount } from './account'
import { UNLINKED_MESSAGE, type AgentEvent, type AgentProcess } from './agent'
import type { PlayitApi, PlayitTunnel, RunData } from './api'
import type { PlayitdBinary } from './binary'

export const ADDRESS_POLL_MS = 30_000
const NOT_LINKED_MESSAGE = 'Link your playit.gg account first.'

type Phase =
  | { state: 'downloading'; percent?: number }
  | { state: 'needs-setup' }
  | { state: 'error'; message: string }
  | { state: 'ready' }

export function tunnelName(serverName: string): string {
  return `Blockhost ${serverName}`
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const isCode = (err: unknown, code: string): boolean => err instanceof AppError && err.code === code

export interface TunnelServiceDeps {
  store: Pick<ServerStore, 'get' | 'list' | 'update'>
  processes: Pick<ProcessManager, 'status'>
  account: Pick<PlayitAccount, 'isLinked' | 'secret' | 'link' | 'cancelLink' | 'unlink'>
  api: Pick<PlayitApi, 'rundata' | 'createTunnel' | 'setTunnelPort' | 'deleteTunnel'>
  binary: Pick<PlayitdBinary, 'ensure'>
  agent: Pick<AgentProcess, 'start' | 'stop' | 'retry'>
  emit: (status: TunnelStatus) => void
  pollMs?: number
  log?: (message: string) => void
}

export class TunnelService {
  private readonly deps: TunnelServiceDeps
  private readonly phases = new Map<string, Phase>()
  private agentEvent: AgentEvent = { state: 'stopped' }
  private agentRunning = false
  private poll: ReturnType<typeof setInterval> | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(deps: TunnelServiceDeps) {
    this.deps = deps
  }

  async account(): Promise<PlayitAccountStatus> {
    return { linked: await this.deps.account.isLinked() }
  }

  async link(): Promise<void> {
    await this.deps.account.link()
    await this.enqueue(async () => {
      this.phases.clear()
      await this.sync()
    })
  }

  cancelLink(): void {
    this.deps.account.cancelLink()
  }

  unlink(): Promise<void> {
    return this.enqueue(async () => {
      this.stopAgent()
      await this.deps.account.unlink()
      this.phases.clear()
      for (const rec of this.deps.store.list()) {
        if (!rec.tunnel) continue
        await this.deps.store.update(rec.id, { tunnel: { enabled: false } })
        this.emitFor(rec.id)
      }
    })
  }

  setShared(serverId: string, enabled: boolean): Promise<TunnelStatus> {
    return this.enqueue(async () => {
      if (enabled && !(await this.deps.account.isLinked())) {
        throw new AppError('PLAYIT_NOT_LINKED', NOT_LINKED_MESSAGE)
      }
      const rec = this.deps.store.get(serverId)
      await this.deps.store.update(serverId, { tunnel: { ...rec.tunnel, enabled } })
      this.phases.delete(serverId)
      await this.sync()
      return this.status(serverId)
    })
  }

  status(serverId: string): TunnelStatus {
    const rec = this.deps.store.get(serverId)
    const base = {
      serverId,
      localAddress: `127.0.0.1:${rec.port}`,
      ...(rec.tunnel?.address ? { address: rec.tunnel.address } : {})
    }
    if (!rec.tunnel?.enabled || !this.isUp(serverId)) return { ...base, state: 'off' }
    const phase = this.phases.get(serverId)
    if (!phase) return { ...base, state: 'connecting' }
    switch (phase.state) {
      case 'downloading':
        return {
          ...base,
          state: 'downloading',
          ...(phase.percent !== undefined ? { percent: phase.percent } : {})
        }
      case 'needs-setup':
        return { ...base, state: 'needs-setup' }
      case 'error':
        return { ...base, state: 'error', message: phase.message }
      case 'ready':
        if (this.agentEvent.state === 'error') {
          return {
            ...base,
            state: 'error',
            message: this.agentEvent.message ?? 'The playit agent failed.'
          }
        }
        if (this.agentEvent.state === 'connected' && rec.tunnel.address)
          return { ...base, state: 'online' }
        return { ...base, state: 'connecting' }
    }
  }

  retry(serverId: string): Promise<TunnelStatus> {
    return this.enqueue(async () => {
      this.deps.store.get(serverId)
      this.phases.delete(serverId)
      if (this.agentRunning && this.agentEvent.state === 'error') await this.deps.agent.retry()
      await this.sync()
      return this.status(serverId)
    })
  }

  onServerStatus(_event: ServerStatusEvent): void {
    void this.enqueue(() => this.sync()).catch((err) =>
      this.log(`tunnel sync failed: ${messageOf(err)}`)
    )
  }

  onAgentEvent(event: AgentEvent): void {
    this.agentEvent = event
    if (event.unauthorized) {
      void this.enqueue(() => this.handleUnauthorized()).catch((err) => this.log(messageOf(err)))
      return
    }
    if (event.state === 'connected') {
      void this.enqueue(() => this.refresh()).catch((err) => this.log(messageOf(err)))
    }
    this.emitActive()
  }

  onServerRemoved(rec: ServerRecord): void {
    const tunnelId = rec.tunnel?.tunnelId
    if (!tunnelId) return
    void (async () => {
      try {
        const secret = await this.deps.account.secret()
        if (secret) await this.deps.api.deleteTunnel(secret, tunnelId)
      } catch (err) {
        this.log(`could not delete playit tunnel ${tunnelId}: ${messageOf(err)}`)
      }
    })()
  }

  whenIdle(): Promise<void> {
    return this.queue.then(() => {})
  }

  dispose(): void {
    this.stopAgent()
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  private log(message: string): void {
    ;(this.deps.log ?? console.warn)(`Blockhost: ${message}`)
  }

  private isUp(serverId: string): boolean {
    const status = this.deps.processes.status(serverId)
    return status === 'starting' || status === 'running'
  }

  private active(): ServerRecord[] {
    return this.deps.store
      .list()
      .filter((r) => r.tunnel?.enabled && r.installState === 'ready' && this.isUp(r.id))
  }

  private async sync(): Promise<void> {
    const active = this.active()
    if (active.length === 0) {
      this.stopAgent()
      this.emitAll()
      return
    }
    if (!(await this.deps.account.isLinked())) {
      for (const rec of active)
        this.phases.set(rec.id, { state: 'error', message: NOT_LINKED_MESSAGE })
      this.emitAll()
      return
    }
    if (!this.agentRunning) {
      try {
        await this.deps.binary.ensure((percent) => {
          for (const rec of active) {
            this.phases.set(rec.id, { state: 'downloading', percent })
            this.emitFor(rec.id)
          }
        })
      } catch (err) {
        for (const rec of active)
          this.phases.set(rec.id, { state: 'error', message: messageOf(err) })
        this.emitAll()
        return
      }
      for (const rec of active) {
        if (this.phases.get(rec.id)?.state === 'downloading') this.phases.delete(rec.id)
      }
      this.agentRunning = true
      await this.deps.agent.start()
      this.poll = setInterval(() => {
        void this.enqueue(() => this.refresh()).catch((err) => this.log(messageOf(err)))
      }, this.deps.pollMs ?? ADDRESS_POLL_MS)
    }
    await this.refresh()
  }

  private stopAgent(): void {
    clearInterval(this.poll)
    this.poll = undefined
    if (!this.agentRunning) return
    this.agentRunning = false
    this.agentEvent = { state: 'stopped' }
    this.deps.agent.stop()
  }

  private async refresh(): Promise<void> {
    const active = this.active()
    if (active.length === 0) return
    const secret = await this.deps.account.secret()
    if (!secret) {
      for (const rec of active)
        this.phases.set(rec.id, { state: 'error', message: NOT_LINKED_MESSAGE })
      this.emitAll()
      return
    }
    let run: RunData
    try {
      run = await this.deps.api.rundata(secret)
    } catch (err) {
      if (isCode(err, 'PLAYIT_UNAUTHORIZED')) {
        await this.handleUnauthorized()
        return
      }
      for (const rec of active) {
        if (this.phases.get(rec.id)?.state !== 'ready') {
          this.phases.set(rec.id, { state: 'error', message: messageOf(err) })
        }
      }
      this.emitAll()
      return
    }
    const claimed = new Set(
      this.deps.store
        .list()
        .map((r) => r.tunnel?.tunnelId)
        .filter((id): id is string => !!id)
    )
    for (const rec of active) {
      if (this.phases.get(rec.id)?.state === 'error') continue
      try {
        await this.resolveTunnel(rec, run, secret, claimed)
      } catch (err) {
        if (isCode(err, 'PLAYIT_UNAUTHORIZED')) {
          await this.handleUnauthorized()
          return
        }
        this.phases.set(rec.id, { state: 'error', message: messageOf(err) })
      }
    }
    this.emitAll()
  }

  private async resolveTunnel(
    rec: ServerRecord,
    run: RunData,
    secret: string,
    claimed: Set<string>
  ): Promise<void> {
    const storedId = rec.tunnel?.tunnelId
    let tunnel: PlayitTunnel | undefined = storedId
      ? run.tunnels.find((t) => t.id === storedId)
      : undefined
    if (!tunnel) {
      tunnel = run.tunnels.find(
        (t) => t.tunnelType === 'minecraft-java' && t.localPort === rec.port && !claimed.has(t.id)
      )
    }
    if (!tunnel) {
      if (this.phases.get(rec.id)?.state === 'needs-setup') return
      let id: string
      try {
        id = await this.deps.api.createTunnel(secret, {
          agentId: run.agentId,
          localPort: rec.port,
          name: tunnelName(rec.name)
        })
      } catch (err) {
        if (isCode(err, 'PLAYIT_CREATE_FORBIDDEN')) {
          this.phases.set(rec.id, { state: 'needs-setup' })
          return
        }
        throw err
      }
      claimed.add(id)
      await this.saveTunnel(rec.id, { tunnelId: id })
      tunnel = (await this.deps.api.rundata(secret)).tunnels.find((t) => t.id === id)
      if (!tunnel) {
        this.phases.set(rec.id, { state: 'ready' })
        return
      }
    }
    claimed.add(tunnel.id)
    if (tunnel.disabledReason) {
      this.phases.set(rec.id, {
        state: 'error',
        message: `playit.gg has disabled this tunnel: ${tunnel.disabledReason}`
      })
      return
    }
    if (tunnel.localPort !== null && tunnel.localPort !== rec.port) {
      await this.deps.api.setTunnelPort(secret, tunnel.id, rec.port)
    }
    await this.saveTunnel(rec.id, {
      tunnelId: tunnel.id,
      ...(tunnel.displayAddress ? { address: tunnel.displayAddress } : {})
    })
    this.phases.set(rec.id, { state: 'ready' })
  }

  private async saveTunnel(serverId: string, patch: Partial<ServerTunnel>): Promise<void> {
    const current = this.deps.store.get(serverId).tunnel
    await this.deps.store.update(serverId, {
      tunnel: { ...current, enabled: current?.enabled ?? true, ...patch }
    })
  }

  private async handleUnauthorized(): Promise<void> {
    this.stopAgent()
    await this.deps.account.unlink()
    for (const rec of this.deps.store.list()) {
      if (rec.tunnel?.enabled)
        this.phases.set(rec.id, { state: 'error', message: UNLINKED_MESSAGE })
    }
    this.emitAll()
  }

  private emitFor(serverId: string): void {
    this.deps.emit(this.status(serverId))
  }

  private emitAll(): void {
    for (const rec of this.deps.store.list()) if (rec.tunnel) this.emitFor(rec.id)
  }

  private emitActive(): void {
    for (const rec of this.active()) this.emitFor(rec.id)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/tunnel/service.test.ts`
Expected: PASS. If a test fails, find the real cause in `service.ts`; do not weaken an expectation that reflects the spec. Report any deviation.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `npm run typecheck && npm test` — expected: both pass. Adding the optional `tunnel` field to `ServerRecord` must not break existing tests.

```bash
git add src/shared/types.ts src/main/tunnel/service.ts src/main/tunnel/service.test.ts
git commit -m "feat: add tunnel service for per-server playit sharing"
```

---

### Task 6: Wire the tunnel module into the app

**Files:**

- Modify: `src/main/servers/service.ts` (`ServerServiceDeps.onRemoved`, call it in `remove`)
- Test: `src/main/servers/service.test.ts` (one new test)
- Modify: `src/shared/api.ts`
- Modify: `src/main/services.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/lib/api.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–5.
- Produces:
  - `ServerServiceDeps.onRemoved?: (rec: ServerRecord) => void`
  - Invoke channels `'tunnel:account'`, `'tunnel:link'`, `'tunnel:cancelLink'`, `'tunnel:unlink'`, `'tunnel:setShared'`, `'tunnel:status'`, `'tunnel:retry'`; event `'tunnel:status'` with payload `TunnelStatus`.
  - `Services.tunnels: TunnelService`; `createServices` options gain `openUrl: (url: string) => Promise<void>`.
  - Renderer: `api.tunnelAccount(): Promise<PlayitAccountStatus>`, `api.tunnelLink(): Promise<void>`, `api.tunnelCancelLink(): Promise<void>`, `api.tunnelUnlink(): Promise<void>`, `api.tunnelSetShared(id: string, enabled: boolean): Promise<TunnelStatus>`, `api.tunnelStatus(id: string): Promise<TunnelStatus>`, `api.tunnelRetry(id: string): Promise<TunnelStatus>`.

- [ ] **Step 1: Write the failing test for the removal hook**

In `src/main/servers/service.test.ts`, add inside the top-level `describe` block that covers `remove` (or at the end of the file in a new `describe('remove hook', …)`):

```ts
it('calls onRemoved with the deleted record', async () => {
  const { store, rec, processes, installer, java, probeJava, isPortFree, removeDir } = await setup()
  const onRemoved = vi.fn()
  const service = new ServerService({
    store,
    installer,
    processes,
    java,
    probeJava,
    isPortFree,
    removeDir,
    onRemoved
  })
  await service.remove(rec.id, true)
  expect(onRemoved).toHaveBeenCalledWith(expect.objectContaining({ id: rec.id, name: rec.name }))
})
```

Run: `npx vitest run src/main/servers/service.test.ts`
Expected: FAIL — TypeScript/vitest reports `onRemoved` is not called (or not a known property).

- [ ] **Step 2: Add the hook**

In `src/main/servers/service.ts`, add to `ServerServiceDeps` after `removeDir`:

```ts
  /** Called after a server has been removed from the store. */
  onRemoved?: (rec: ServerRecord) => void
```

and in `remove`, after `await this.deps.store.remove(id)`, add:

```ts
this.deps.onRemoved?.(rec)
```

Run: `npx vitest run src/main/servers/service.test.ts` — expected: PASS.

- [ ] **Step 3: Add channels**

In `src/shared/api.ts`:

- Add `TunnelStatus` to the type import from `./types`.
- In `INVOKE_CHANNELS`, after `'players:action',` add:
  ```ts
  'tunnel:account',
  'tunnel:link',
  'tunnel:cancelLink',
  'tunnel:unlink',
  'tunnel:setShared',
  'tunnel:status',
  'tunnel:retry',
  ```
- In `EVENT_CHANNELS`, after `'players:changed',` add `'tunnel:status',`.
- In `EventPayloads`, add `'tunnel:status': TunnelStatus`.

- [ ] **Step 4: Construct the module in `services.ts`**

In `src/main/services.ts`:

- Add imports:
  ```ts
  import { PlayitAccount } from './tunnel/account'
  import { AgentProcess } from './tunnel/agent'
  import { createPlayitApi } from './tunnel/api'
  import { PlayitdBinary } from './tunnel/binary'
  import { TunnelService } from './tunnel/service'
  ```
- Add `tunnels: TunnelService` to `Services` after `players`.
- Add `openUrl: (url: string) => Promise<void>` to the `createServices` options type, and destructure it: `const { dataDir, serversDir, send, openUrl } = opts`.
- In the `ProcessManager` `onStatus` callback, after `players.onStatus(event)`, add `tunnels.onServerStatus(event)`.
- After the `PlayerService` construction, add:
  ```ts
  const playitDir = join(dataDir, 'playit')
  const playitApi = createPlayitApi()
  const playitBinary = new PlayitdBinary({ dir: playitDir, download: downloadFile })
  const playitAccount = new PlayitAccount({
    file: join(playitDir, 'playit.toml'),
    api: playitApi,
    openUrl
  })
  const playitAgent = new AgentProcess({
    spawn: defaultSpawn,
    kill: killTree,
    exe: () => playitBinary.ensure(),
    secretPath: join(playitDir, 'playit.toml'),
    onEvent: (event) => tunnels.onAgentEvent(event)
  })
  const tunnels = new TunnelService({
    store,
    processes,
    account: playitAccount,
    api: playitApi,
    binary: playitBinary,
    agent: playitAgent,
    emit: (status) => send('tunnel:status', status)
  })
  ```
- In the `ServerService` construction, add `onRemoved: (rec) => tunnels.onServerRemoved(rec)`.
- Add `tunnels` to the returned object after `players`.

- [ ] **Step 5: Register IPC handlers**

In `src/main/ipc.ts`:

- Change the destructuring to `const { servers, installer, providers, javaManager, http, paths, players, tunnels } = services`.
- After the `players:action` handler, add:

  ```ts
  handle('tunnel:account', z.tuple([]), () => tunnels.account())
  handle('tunnel:link', z.tuple([]), () => tunnels.link())
  handle('tunnel:cancelLink', z.tuple([]), () => tunnels.cancelLink())
  handle('tunnel:unlink', z.tuple([]), () => tunnels.unlink())
  handle('tunnel:setShared', z.tuple([idSchema, z.boolean()]), (id, enabled) =>
    tunnels.setShared(id, enabled)
  )
  handle('tunnel:status', z.tuple([idSchema]), (id) => tunnels.status(id))
  handle('tunnel:retry', z.tuple([idSchema]), (id) => tunnels.retry(id))
  ```

- [ ] **Step 6: App lifecycle**

In `src/main/index.ts`:

- In the `createServices({...})` call, add `openUrl: (url) => shell.openExternal(url)` (`shell` is already imported).
- After the `app.on('window-all-closed', …)` line, add:

  ```ts
  app.on('will-quit', () => services?.tunnels.dispose())
  ```

- [ ] **Step 7: Renderer API**

In `src/renderer/src/lib/api.ts`:

- Add `PlayitAccountStatus` and `TunnelStatus` to the type import.
- After `playerAction`, add:

  ```ts
  tunnelAccount: () => call<PlayitAccountStatus>('tunnel:account'),
  tunnelLink: () => call<void>('tunnel:link'),
  tunnelCancelLink: () => call<void>('tunnel:cancelLink'),
  tunnelUnlink: () => call<void>('tunnel:unlink'),
  tunnelSetShared: (id: string, enabled: boolean) =>
    call<TunnelStatus>('tunnel:setShared', id, enabled),
  tunnelStatus: (id: string) => call<TunnelStatus>('tunnel:status', id),
  tunnelRetry: (id: string) => call<TunnelStatus>('tunnel:retry', id),
  ```

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.

```bash
git add src/main/servers/service.ts src/main/servers/service.test.ts src/shared/api.ts src/main/services.ts src/main/ipc.ts src/main/index.ts src/renderer/src/lib/api.ts
git commit -m "feat: wire playit tunnels into the app"
```

---

### Task 7: Connect tab sharing card and smoke checklist

**Files:**

- Modify: `src/renderer/src/pages/tabs/ConnectTab.tsx`
- Modify: `src/renderer/src/pages/ServerDetail.tsx` (pass `onChanged`)
- Modify: `docs/smoke-test.md`

**Interfaces:**

- Consumes: renderer `api.tunnel*` calls and `api.on('tunnel:status', …)` (Task 6); `TunnelStatus`, `ServerView` (whose `tunnel?.enabled` comes from Task 5); `Button`, `ErrorText` from `components/ui.tsx`; `ApiCallError`, `errorMessage`; the existing `AddressRow` in `ConnectTab.tsx`.
- Produces: `ConnectTab({ server, onChanged }: { server: ServerView; onChanged: () => void })`.

No renderer test harness exists; verify with typecheck and build.

- [ ] **Step 1: Add the sharing card**

In `src/renderer/src/pages/tabs/ConnectTab.tsx`:

- Change the imports to:
  ```tsx
  import { useEffect, useState, type ReactNode } from 'react'
  import type { NetInfo, ServerView, TunnelStatus } from '../../../../shared/types'
  import { Button, ErrorText } from '../../components/ui'
  import { api, ApiCallError, errorMessage } from '../../lib/api'
  ```
- Add this component above `export function ConnectTab`:

```tsx
function TunnelCard({
  server,
  onChanged,
  addressRow
}: {
  server: ServerView
  onChanged: () => void
  addressRow: (address: string) => ReactNode
}) {
  const [linked, setLinked] = useState<boolean | null>(null)
  const [linking, setLinking] = useState(false)
  const [status, setStatus] = useState<TunnelStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shared = server.tunnel?.enabled ?? false

  const refreshAccount = () => {
    api
      .tunnelAccount()
      .then((a) => setLinked(a.linked))
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(refreshAccount, [])
  useEffect(() => {
    api
      .tunnelStatus(server.id)
      .then(setStatus)
      .catch((err) => setError(errorMessage(err)))
  }, [server.id, server.status, shared])
  useEffect(
    () =>
      api.on('tunnel:status', (s) => {
        if (s.serverId !== server.id) return
        setStatus(s)
        if (s.state === 'error') refreshAccount()
      }),
    [server.id]
  )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      if (!(err instanceof ApiCallError && err.code === 'CANCELLED')) setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function link() {
    setLinking(true)
    await run(async () => {
      await api.tunnelLink()
      setLinked(true)
    })
    setLinking(false)
  }

  async function unlink() {
    if (
      !window.confirm(
        'Unlink your playit.gg account from Blockhost? Shared servers will stop being reachable through playit.gg.'
      )
    )
      return
    await run(async () => {
      await api.tunnelUnlink()
      setLinked(false)
      onChanged()
    })
  }

  const toggle = (enabled: boolean) =>
    run(async () => {
      setStatus(await api.tunnelSetShared(server.id, enabled))
      onChanged()
    })

  const retry = () =>
    run(async () => {
      setStatus(await api.tunnelRetry(server.id))
    })

  return (
    <section className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900 p-4">
      <div>
        <h3 className="font-medium">Share over the internet (playit.gg)</h3>
        <p className="text-sm text-zinc-400">
          Friends can join without port forwarding. Uses a free playit.gg account.
        </p>
      </div>
      {error && <ErrorText>{error}</ErrorText>}

      {linked === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : !linked ? (
        linking ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-zinc-300">Waiting for you to accept in the browser…</p>
            <Button variant="ghost" onClick={() => void api.tunnelCancelLink()}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => void link()}>
            Link playit.gg account
          </Button>
        )
      ) : (
        <>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              role="switch"
              className="h-4 w-4 accent-emerald-500"
              checked={shared}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            Share this server
          </label>

          {status && shared && (
            <div className="space-y-2 text-sm">
              {status.state === 'off' &&
                (status.address ? (
                  <div className="space-y-1 opacity-60">
                    {addressRow(status.address)}
                    <p className="text-xs text-zinc-500">Available while the server is running.</p>
                  </div>
                ) : (
                  <p className="text-zinc-500">Starts when the server starts.</p>
                ))}
              {status.state === 'downloading' && (
                <p className="text-zinc-300">
                  Downloading the playit agent…
                  {status.percent !== undefined ? ` ${status.percent}%` : ''}
                </p>
              )}
              {status.state === 'connecting' && (
                <p className="text-zinc-300">Connecting to playit.gg…</p>
              )}
              {status.state === 'online' && status.address && (
                <div className="space-y-1">
                  {addressRow(status.address)}
                  <p className="text-xs text-zinc-500">Share this address with your friends.</p>
                </div>
              )}
              {status.state === 'needs-setup' && (
                <div className="space-y-2 text-zinc-300">
                  <p>
                    Create a Minecraft Java tunnel on playit.gg pointing to{' '}
                    <code className="rounded bg-zinc-950 px-1.5 py-0.5">{status.localAddress}</code>
                    . Blockhost picks it up automatically.
                  </p>
                  <Button
                    onClick={() => void api.openExternal('https://playit.gg/account/tunnels')}
                  >
                    Open playit.gg
                  </Button>
                </div>
              )}
              {status.state === 'error' && (
                <div className="space-y-2">
                  <ErrorText>{status.message ?? 'Sharing failed.'}</ErrorText>
                  <Button disabled={busy} onClick={() => void retry()}>
                    Retry
                  </Button>
                </div>
              )}
            </div>
          )}
          {!shared && <p className="text-sm text-zinc-500">Not shared.</p>}

          <button
            type="button"
            className="text-xs text-zinc-500 underline hover:text-zinc-300"
            onClick={() => void unlink()}
          >
            Unlink playit.gg
          </button>
        </>
      )}
    </section>
  )
}
```

- Change the `ConnectTab` signature to `export function ConnectTab({ server, onChanged }: { server: ServerView; onChanged: () => void })`.
- In its returned JSX, insert `<TunnelCard server={server} onChanged={onChanged} addressRow={row} />` directly after `{error && <ErrorText>{error}</ErrorText>}`.
- Wrap the existing "Over the internet" `<section>` and the existing `<details>` port-forwarding guide together in:

  ```tsx
  <details className="space-y-4">
    <summary className="cursor-pointer text-sm font-medium text-zinc-300">
      Or forward a port yourself
    </summary>
    …the existing "Over the internet" section and the existing guide <details>…
  </details>
  ```

  Keep the "On this PC" and "Same Wi-Fi or home network" sections where they are.

- [ ] **Step 2: Pass `onChanged` from the detail page**

In `src/renderer/src/pages/ServerDetail.tsx`, change `{tab === 'connect' && <ConnectTab server={server} />}` to `{tab === 'connect' && <ConnectTab server={server} onChanged={onChanged} />}`.

- [ ] **Step 3: Smoke checklist**

In `docs/smoke-test.md`, before the "Uninstall" line, add:

```markdown
- [ ] Connect tab: "Link playit.gg account" opens playit.gg in the browser; accepting there shows the sharing switch in Blockhost
- [ ] Sharing a running Paper server downloads the agent once, shows "Connecting…" then an address; a client on a different network (e.g. phone hotspot) joins with that address
- [ ] Stopping the server greys the address; starting it again shows the same address
- [ ] Unlink removes the switch; no playitd.exe remains in Task Manager after the app quits
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npx prettier --check src/renderer/src/pages/tabs/ConnectTab.tsx src/renderer/src/pages/ServerDetail.tsx docs/smoke-test.md && npm test && npm run build`
Expected: all pass. If Prettier reports differences, run `npx prettier --write` on those files first.

```bash
git add src/renderer/src/pages/tabs/ConnectTab.tsx src/renderer/src/pages/ServerDetail.tsx docs/smoke-test.md
git commit -m "feat: share servers through playit.gg from the Connect tab"
```
