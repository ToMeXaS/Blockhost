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
      if (res.status === 401) {
        throw new AppError(
          'PLAYIT_UNAUTHORIZED',
          'playit.gg no longer accepts the saved key. Link your playit.gg account again.',
          { status: 401 }
        )
      }
      if (res.status === 403) {
        throw new AppError('PLAYIT_FORBIDDEN', 'playit.gg did not allow this request (HTTP 403)', {
          status: 403
        })
      }
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
    if (envelope.status !== 'error') {
      if (res.status === 401) {
        throw new AppError(
          'PLAYIT_UNAUTHORIZED',
          'playit.gg no longer accepts the saved key. Link your playit.gg account again.',
          { status: 401 }
        )
      }
      if (res.status === 403) {
        throw new AppError('PLAYIT_FORBIDDEN', 'playit.gg did not allow this request (HTTP 403)', {
          status: 403
        })
      }
      throw new AppError(
        'PLAYIT_API',
        `playit.gg returned an unexpected response (HTTP ${res.status})`
      )
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
