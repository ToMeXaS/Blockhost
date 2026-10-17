/** Collects items and delivers them in one call at most every `ms` milliseconds. */
export class Batcher<T> {
  private items: T[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly ms: number
  private readonly onFlush: (items: T[]) => void

  constructor(ms: number, onFlush: (items: T[]) => void) {
    this.ms = ms
    this.onFlush = onFlush
  }

  push(item: T): void {
    this.items.push(item)
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.ms)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.items.length === 0) return
    const items = this.items
    this.items = []
    this.onFlush(items)
  }
}
