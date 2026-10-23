// One or more "[...]" logger groups, then ": " — chat lines continue with "<name>".
// Paper 26.x logs system messages as "System chat: Steve joined the game".
const PREFIX = String.raw`^(?:\[[^\]]*\]\s*)+:\s(?:System chat: )?`
const NAME = '[A-Za-z0-9_]{3,16}'
const JOIN = new RegExp(`${PREFIX}(${NAME})(?: \\(formerly known as ${NAME}\\))? joined the game$`)
const LEAVE = new RegExp(`${PREFIX}(${NAME}) left the game$`)
const LIST = new RegExp(
  `${PREFIX}There are (\\d+) (?:of a max of|out of maximum) \\d+ players online[:.]?\\s*(.*)$`
)
const NAME_ONLY = new RegExp(`^${NAME}$`)
// Reply to `data get entity <name> Dimension`: a quoted id since 1.16, a number before.
const DIMENSION = new RegExp(`${PREFIX}(${NAME}) has the following entity data: "?([^"]+)"?$`)
const NO_ENTITY = new RegExp(`${PREFIX}No entity was found$`)
const LEGACY_DIMENSIONS: Record<string, string> = {
  '0': 'minecraft:overworld',
  '-1': 'minecraft:the_nether',
  '1': 'minecraft:the_end'
}

/** True for the reply to `list`. */
export function isListReply(line: string): boolean {
  return LIST.test(line)
}

/** The command that asks the server which dimension a player is in. */
export const dimensionCommand = (name: string): string => `data get entity ${name} Dimension`

/** True for every line a {@link dimensionCommand} prints. */
export function isDimensionReply(line: string): boolean {
  return DIMENSION.test(line) || NO_ENTITY.test(line)
}

interface Session {
  name: string
  /** Epoch ms the player joined, or was first seen in a /list reply. */
  since: number
  /** Dimension id such as "minecraft:the_nether", once the server has told us. */
  dimension?: string
}

export class PlayerTracker {
  private readonly onChange: (serverId: string) => void
  private readonly now: () => number
  /** serverId → lower-case name → session */
  private readonly sets = new Map<string, Map<string, Session>>()

  constructor(onChange: (serverId: string) => void, now: () => number = Date.now) {
    this.onChange = onChange
    this.now = now
  }

  online(serverId: string): string[] {
    return [...(this.sets.get(serverId)?.values() ?? [])]
      .map((s) => s.name)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  }

  /** Display name → epoch ms the player came online. */
  onlineSince(serverId: string): Record<string, number> {
    return Object.fromEntries(
      [...(this.sets.get(serverId)?.values() ?? [])].map((s) => [s.name, s.since])
    )
  }

  /** Display name → dimension id, for players whose dimension is known. */
  dimensions(serverId: string): Record<string, string> {
    return Object.fromEntries(
      [...(this.sets.get(serverId)?.values() ?? [])].flatMap((s) =>
        s.dimension ? [[s.name, s.dimension]] : []
      )
    )
  }

  /** Records the answer to a {@link dimensionCommand}. */
  handleDimensionReply(serverId: string, line: string): void {
    const match = DIMENSION.exec(line)
    if (!match) return
    const session = this.sets.get(serverId)?.get(match[1].toLowerCase())
    const dimension = LEGACY_DIMENSIONS[match[2]] ?? match[2]
    if (!session || session.dimension === dimension) return
    session.dimension = dimension
    this.onChange(serverId)
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
      if (set.get(key)?.name === join[1]) return false
      set.set(key, { name: join[1], since: this.now() })
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
    const same =
      names.length === set.size && names.every((n) => set.get(n.toLowerCase())?.name === n)
    if (same) return false
    const now = this.now()
    const next = new Map(
      names.map((n): [string, Session] => {
        const key = n.toLowerCase()
        const prev = set.get(key)
        return [key, { name: n, since: prev?.since ?? now, dimension: prev?.dimension }]
      })
    )
    this.sets.set(serverId, next)
    return true
  }

  private set(serverId: string): Map<string, Session> {
    let set = this.sets.get(serverId)
    if (!set) {
      set = new Map()
      this.sets.set(serverId, set)
    }
    return set
  }
}
