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
import { TUNNEL_LIMIT_MESSAGE, type PlayitApi, type PlayitTunnel, type RunData } from './api'
import type { PlayitdBinary } from './binary'

export const ADDRESS_POLL_MS = 30_000
/** Local port written to a tunnel whose server has sharing turned off, so nothing listens. */
export const DISABLED_LOCAL_PORT = 1
const NOT_LINKED_MESSAGE = 'Link your playit.gg account first.'

type Phase =
  | { state: 'downloading'; percent?: number }
  | { state: 'needs-setup' }
  | { state: 'error'; message: string; permanent: boolean }
  | { state: 'ready' }

const PERMANENT_MESSAGES = new Set([UNLINKED_MESSAGE, NOT_LINKED_MESSAGE, TUNNEL_LIMIT_MESSAGE])
const DISABLED_TUNNEL_PREFIX = 'playit.gg has disabled this tunnel'

function isPermanent(message: string): boolean {
  return PERMANENT_MESSAGES.has(message) || message.startsWith(DISABLED_TUNNEL_PREFIX)
}

export function tunnelName(serverName: string): string {
  return `Blockhost ${serverName}`
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
    .trim()
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
      // Sync first so the agent stops at once when nothing else is shared; the blank
      // below is best effort and may wait on playit.gg.
      await this.sync()
      if (!enabled && rec.tunnel?.tunnelId) {
        const tunnelId = rec.tunnel.tunnelId
        try {
          const secret = await this.deps.account.secret()
          if (secret) await this.deps.api.setTunnelPort(secret, tunnelId, DISABLED_LOCAL_PORT)
        } catch (err) {
          this.log(`could not blank playit tunnel ${tunnelId}: ${messageOf(err)}`)
        }
      }
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
      if (
        this.agentRunning &&
        (this.agentEvent.state === 'error' || this.agentEvent.state === 'stopped')
      ) {
        await this.deps.agent.retry()
      }
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
    if (event.state === 'stopped' && this.agentRunning) {
      void this.enqueue(async () => {
        this.agentRunning = false
        this.clearPoll()
        await this.sync()
      }).catch((err) => this.log(messageOf(err)))
      return
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
    for (const rec of this.deps.store.list()) {
      if (!this.isUp(rec.id)) this.phases.delete(rec.id)
    }
    const active = this.active()
    if (active.length === 0) {
      this.stopAgent()
      this.emitAll()
      return
    }
    if (!(await this.deps.account.isLinked())) {
      for (const rec of active) {
        const existing = this.phases.get(rec.id)
        if (
          existing?.state === 'error' &&
          existing.permanent &&
          existing.message === UNLINKED_MESSAGE
        ) {
          continue
        }
        this.phases.set(rec.id, { state: 'error', message: NOT_LINKED_MESSAGE, permanent: true })
      }
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
          this.phases.set(rec.id, {
            state: 'error',
            message: messageOf(err),
            permanent: isPermanent(messageOf(err))
          })
        this.emitAll()
        return
      }
      for (const rec of active) {
        const existing = this.phases.get(rec.id)
        if (existing?.state === 'downloading') this.phases.delete(rec.id)
        else if (existing?.state === 'error' && !existing.permanent) this.phases.delete(rec.id)
      }
      // The poll runs sync(), so a start refused below is tried again on the next tick.
      this.startPoll()
      if (!(await this.secureInactive(active))) return
      this.agentRunning = true
      await this.deps.agent.start()
    }
    await this.refresh()
  }

  private startPoll(): void {
    if (this.poll) return
    this.poll = setInterval(() => {
      void this.enqueue(() => this.sync()).catch((err) => this.log(messageOf(err)))
    }, this.deps.pollMs ?? ADDRESS_POLL_MS)
  }

  /**
   * Before playitd starts, every claimed tunnel whose server is not actively shared must
   * already point at the disabled port, or the agent would forward it to whatever listens
   * there. Fails closed: returns false (with error phases set) unless that is confirmed.
   */
  private async secureInactive(active: ServerRecord[]): Promise<boolean> {
    let reason: string
    try {
      const secret = await this.deps.account.secret()
      if (!secret) {
        reason = NOT_LINKED_MESSAGE
      } else {
        const run = await this.deps.api.rundata(secret)
        const failure = await this.blankInactive(run, secret, active)
        if (failure === null) return true
        reason = failure
      }
    } catch (err) {
      if (isCode(err, 'PLAYIT_UNAUTHORIZED')) {
        await this.handleUnauthorized()
        return false
      }
      reason = messageOf(err)
    }
    const message = `Could not secure your other playit tunnels before sharing: ${reason}`
    for (const rec of active) {
      const existing = this.phases.get(rec.id)
      if (existing?.state === 'error' && existing.permanent) continue
      this.phases.set(rec.id, { state: 'error', message, permanent: false })
    }
    this.emitAll()
    return false
  }

  private clearPoll(): void {
    clearInterval(this.poll)
    this.poll = undefined
  }

  private stopAgent(): void {
    this.clearPoll()
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
        this.phases.set(rec.id, { state: 'error', message: NOT_LINKED_MESSAGE, permanent: true })
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
      const message = messageOf(err)
      for (const rec of active) {
        const existing = this.phases.get(rec.id)
        if (existing?.state === 'ready') continue
        if (existing?.state === 'error' && existing.permanent) continue
        this.phases.set(rec.id, { state: 'error', message, permanent: isPermanent(message) })
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
    await this.blankInactive(run, secret, active)
    for (const rec of active) {
      const existing = this.phases.get(rec.id)
      if (existing?.state === 'error' && existing.permanent) continue
      try {
        await this.resolveTunnel(rec, run, secret, claimed)
      } catch (err) {
        if (isCode(err, 'PLAYIT_UNAUTHORIZED')) {
          await this.handleUnauthorized()
          return
        }
        const message = messageOf(err)
        this.phases.set(rec.id, { state: 'error', message, permanent: isPermanent(message) })
      }
    }
    this.emitAll()
  }

  /**
   * playitd forwards every tunnel on the agent, so a tunnel whose server is not actively
   * shared must not point at a real port: another server could be listening there.
   * Tries every tunnel and returns the first failure message, or null when all are blanked;
   * a failure is retried on the next refresh.
   */
  private async blankInactive(
    run: RunData,
    secret: string,
    active: ServerRecord[]
  ): Promise<string | null> {
    const activeIds = new Set(active.map((r) => r.id))
    let failure: string | null = null
    for (const rec of this.deps.store.list()) {
      const tunnelId = rec.tunnel?.tunnelId
      if (!tunnelId || activeIds.has(rec.id)) continue
      const tunnel = run.tunnels.find((t) => t.id === tunnelId)
      if (!tunnel || tunnel.localPort === DISABLED_LOCAL_PORT) continue
      try {
        await this.deps.api.setTunnelPort(secret, tunnelId, DISABLED_LOCAL_PORT)
      } catch (err) {
        this.log(`could not blank playit tunnel ${tunnelId}: ${messageOf(err)}`)
        failure ??= messageOf(err)
      }
    }
    return failure
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
        message: `${DISABLED_TUNNEL_PREFIX}: ${tunnel.disabledReason}`,
        permanent: true
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
      if (!rec.tunnel) continue
      await this.deps.store.update(rec.id, { tunnel: { enabled: rec.tunnel.enabled } })
      if (rec.tunnel.enabled) {
        this.phases.set(rec.id, { state: 'error', message: UNLINKED_MESSAGE, permanent: true })
      }
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
