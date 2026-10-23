import type { StatsPoint } from '../../shared/types'

/** One hour at one point every 5 seconds. */
export const HISTORY_CAPACITY = 720

export class StatsHistory {
  private readonly capacity: number
  private readonly series = new Map<string, StatsPoint[]>()

  constructor(capacity = HISTORY_CAPACITY) {
    this.capacity = capacity
  }

  push(serverId: string, point: StatsPoint): void {
    let list = this.series.get(serverId)
    if (!list) {
      list = []
      this.series.set(serverId, list)
    }
    list.push(point)
    if (list.length > this.capacity) list.splice(0, list.length - this.capacity)
  }

  points(serverId: string): StatsPoint[] {
    return [...(this.series.get(serverId) ?? [])]
  }

  clear(serverId: string): void {
    this.series.delete(serverId)
  }
}
