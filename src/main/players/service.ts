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
const LIST_RESYNC_THROTTLE_MS = 30_000

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
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly lastListSentAt = new Map<string, number>()

  constructor(deps: PlayerServiceDeps) {
    this.deps = deps
    this.tracker = new PlayerTracker((serverId) => this.deps.emit({ serverId }))
  }

  async getPlayers(serverId: string): Promise<PlayerLists> {
    const { dir } = this.deps.store.get(serverId)
    if (this.deps.processes.status(serverId) === 'running') this.maybeResyncList(serverId)
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
    await this.enqueue(serverId, () => this.editStopped(serverId, dir, action))
    return this.getPlayers(serverId)
  }

  /**
   * Serialises stopped-path edits for a server so a slow lookup/read in one
   * edit cannot be clobbered by, or clobber, a concurrent one; also ensures
   * each caller observes rejections independently of the others in the queue.
   */
  private enqueue<T>(serverId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(serverId) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    this.queues.set(
      serverId,
      run.then(
        () => undefined,
        () => undefined
      )
    )
    return run
  }

  private async editStopped(
    serverId: string,
    dir: string,
    action: Exclude<PlayerAction, { type: 'kick' }>
  ): Promise<void> {
    if (action.type === 'setWhitelistEnabled') {
      this.assertStillEditable(serverId)
      await updateProperties(dir, { 'white-list': String(action.enabled) })
    } else {
      await this.editList(serverId, dir, action)
    }
  }

  /**
   * The status can change between when an edit started (e.g. during a slow
   * Mojang lookup) and when it is about to write; re-check right before the
   * write so a server that started in the meantime cannot have its load of
   * the files clobbered by a stale edit.
   */
  private assertStillEditable(serverId: string): void {
    const status = this.deps.processes.status(serverId)
    if (status !== 'stopped' && status !== 'crashed') {
      throw new AppError('SERVER_BUSY', 'The server started while saving; try again')
    }
  }

  onStatus(event: ServerStatusEvent): void {
    const { serverId, status } = event
    if (status === 'starting' || status === 'running') this.startWatching(serverId)
    if (status === 'stopped' || status === 'crashed') {
      this.stopWatching(serverId)
      this.tracker.reset(serverId)
      this.lastListSentAt.delete(serverId)
    }
  }

  onLog(event: ServerLogEvent): void {
    this.tracker.handleLines(event.serverId, event.lines)
  }

  private async editList(serverId: string, dir: string, action: FileAction): Promise<void> {
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
    if (next) {
      this.assertStillEditable(serverId)
      await writeList(dir, list, next)
    }
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

  /**
   * Nobody is online right after `Done (…)!`, so resyncing then never helps,
   * and some plugins (e.g. EssentialsX) suppress the join/leave log lines the
   * tracker otherwise relies on. Resync instead whenever someone looks at the
   * tab, throttled so repeated refreshes don't spam the console.
   */
  private maybeResyncList(serverId: string): void {
    const now = (this.deps.now?.() ?? new Date()).getTime()
    const last = this.lastListSentAt.get(serverId) ?? 0
    if (now - last < LIST_RESYNC_THROTTLE_MS) return
    this.lastListSentAt.set(serverId, now)
    try {
      this.deps.processes.sendCommand(serverId, 'list')
    } catch {
      // The server exited between the status check and now; nothing to resync.
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
