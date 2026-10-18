import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerRecord, ServerStatus, TunnelStatus } from '../../shared/types'
import { AppError } from '../errors'
import { ServerStore } from '../servers/store'
import { tempDir } from '../test-utils'
import { UNLINKED_MESSAGE } from './agent'
import { TUNNEL_LIMIT_MESSAGE, type PlayitTunnel } from './api'
import { DISABLED_LOCAL_PORT, TunnelService, tunnelName } from './service'

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

  it('shows the tunnel limit message, does not retry it on the poll, but recovers on retry', async () => {
    vi.useFakeTimers()
    const { service, api, up } = await setup()
    api.createTunnel.mockRejectedValueOnce(
      new AppError('PLAYIT_TUNNEL_LIMIT', TUNNEL_LIMIT_MESSAGE)
    )
    await service.setShared(ID, true)
    await up(ID)
    expect(service.status(ID)).toMatchObject({ state: 'error', message: TUNNEL_LIMIT_MESSAGE })
    const callsBeforePoll = api.createTunnel.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.createTunnel.mock.calls.length).toBe(callsBeforePoll)
    const after = await service.retry(ID)
    expect(after.state).toBe('connecting')
    expect(api.createTunnel).toHaveBeenCalledTimes(2)
  })

  it('recovers from a transient rundata error on the next poll', async () => {
    vi.useFakeTimers()
    const { service, api, up } = await setup()
    api.rundata.mockRejectedValueOnce(new AppError('NETWORK', 'Could not reach playit.gg'))
    await service.setShared(ID, true)
    await up(ID)
    expect(service.status(ID)).toMatchObject({
      state: 'error',
      message: 'Could not reach playit.gg'
    })
    expect(api.createTunnel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30_000)
    await service.whenIdle()
    expect(service.status(ID).state).not.toBe('error')
    expect(api.createTunnel).toHaveBeenCalledTimes(1)
  })

  it('clears an error phase when the server stops and restarts', async () => {
    const { service, api, up, statuses } = await setup()
    api.rundata.mockRejectedValueOnce(new AppError('NETWORK', 'offline'))
    await service.setShared(ID, true)
    await up(ID)
    expect(service.status(ID).state).toBe('error')
    statuses.set(ID, 'stopped')
    service.onServerStatus({ serverId: ID, status: 'stopped' })
    await service.whenIdle()
    statuses.set(ID, 'running')
    service.onServerStatus({ serverId: ID, status: 'running' })
    await service.whenIdle()
    expect(service.status(ID).state).not.toBe('error')
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

  it('restarts the agent when it stops unexpectedly while a server stays shared', async () => {
    const { service, agent, up } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    expect(agent.start).toHaveBeenCalledTimes(1)
    service.onAgentEvent({ state: 'stopped' })
    await service.whenIdle()
    expect(agent.start).toHaveBeenCalledTimes(2)
  })

  it('retry also restarts the agent when the last event was "stopped"', async () => {
    const { service, agent, up } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    service.onAgentEvent({ state: 'stopped' })
    await service.whenIdle()
    expect(agent.start).toHaveBeenCalledTimes(2)
    await service.retry(ID)
    expect(agent.retry).toHaveBeenCalledTimes(1)
  })

  it('disabling one of two shared servers blanks its tunnel without stopping the agent', async () => {
    const { service, agent, api, store, up } = await setup()
    await service.setShared(ID, true)
    await service.setShared(ID2, true)
    await up(ID)
    await up(ID2)
    const tunnelId = store.get(ID).tunnel?.tunnelId
    expect(tunnelId).toBeDefined()
    await service.setShared(ID, false)
    expect(api.setTunnelPort).toHaveBeenCalledWith('k3y', tunnelId, DISABLED_LOCAL_PORT)
    expect(agent.stop).not.toHaveBeenCalled()

    await service.setShared(ID, true)
    await up(ID)
    expect(api.setTunnelPort).toHaveBeenCalledWith('k3y', tunnelId, 25565)
  })

  it('does not fail setShared when disabling fails to repoint the tunnel', async () => {
    const { service, api, up } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    api.setTunnelPort.mockRejectedValueOnce(new Error('offline'))
    await expect(service.setShared(ID, false)).resolves.toMatchObject({ state: 'off' })
  })

  it('keeps the relink message after a further status event', async () => {
    const { service, api, up } = await setup()
    await service.setShared(ID, true)
    api.rundata.mockRejectedValueOnce(new AppError('PLAYIT_UNAUTHORIZED', UNLINKED_MESSAGE))
    await up(ID)
    expect(service.status(ID)).toMatchObject({ state: 'error', message: UNLINKED_MESSAGE })
    service.onServerStatus({ serverId: ID, status: 'running' })
    await service.whenIdle()
    expect(service.status(ID)).toMatchObject({ state: 'error', message: UNLINKED_MESSAGE })
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
    const { service, account, store, up } = await setup()
    await service.setShared(ID, true)
    await up(ID)
    expect(store.get(ID).tunnel?.tunnelId).toBe('t1')
    service.onAgentEvent({ state: 'error', unauthorized: true, message: UNLINKED_MESSAGE })
    await service.whenIdle()
    expect(account.unlink).toHaveBeenCalled()
    expect(store.get(ID).tunnel).toEqual({ enabled: true })
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
