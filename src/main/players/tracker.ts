// One or more "[...]" logger groups, then ": " — chat lines continue with "<name>".
const PREFIX = String.raw`^(?:\[[^\]]*\]\s*)+:\s`
const NAME = '[A-Za-z0-9_]{3,16}'
const JOIN = new RegExp(`${PREFIX}(${NAME})(?: \\(formerly known as ${NAME}\\))? joined the game$`)
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
