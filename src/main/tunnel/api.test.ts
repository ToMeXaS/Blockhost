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

  it('maps bare 401/403 responses to auth errors', async () => {
    const api401 = createPlayitApi(
      (async () => new Response('<html>', { status: 401 })) as unknown as typeof fetch,
      'https://api.test'
    )
    await expect(api401.rundata('s')).rejects.toMatchObject({
      code: 'PLAYIT_UNAUTHORIZED',
      message: expect.stringContaining('no longer accepts')
    })

    const api403 = createPlayitApi(
      (async () => new Response('<html>', { status: 403 })) as unknown as typeof fetch,
      'https://api.test'
    )
    await expect(api403.rundata('s')).rejects.toMatchObject({
      code: 'PLAYIT_FORBIDDEN',
      message: expect.stringContaining('HTTP 403')
    })
  })

  it('maps 401/403 with unparsable or invalid JSON bodies to auth errors', async () => {
    const api401empty = createPlayitApi(
      (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
      'https://api.test'
    )
    await expect(api401empty.rundata('s')).rejects.toMatchObject({
      code: 'PLAYIT_UNAUTHORIZED'
    })

    const api200junk = createPlayitApi(
      (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch,
      'https://api.test'
    )
    await expect(api200junk.rundata('s')).rejects.toMatchObject({
      code: 'PLAYIT_API',
      message: expect.stringContaining('HTTP 200')
    })
  })

  it('prefers well-formed envelope error codes over HTTP status codes', async () => {
    const { api } = fakeFetch({ status: 401, body: { status: 'error', data: { type: 'auth', message: 'ScopeNotAllowed' } } })
    await expect(api.rundata('s')).rejects.toMatchObject({ code: 'PLAYIT_FORBIDDEN' })
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
