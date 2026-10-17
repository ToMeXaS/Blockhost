import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './util/fs'

interface CacheEntry {
  savedAt: number
  value: unknown
}

/** Small on-disk JSON cache keyed by string (we use URLs). */
export class JsonCache {
  private readonly dir: string
  private readonly now: () => number

  constructor(dir: string, now: () => number = Date.now) {
    this.dir = dir
    this.now = now
  }

  async getFresh(key: string, maxAgeMs: number): Promise<unknown | undefined> {
    const entry = await this.read(key)
    return entry && this.now() - entry.savedAt <= maxAgeMs ? entry.value : undefined
  }

  async getStale(key: string): Promise<unknown | undefined> {
    return (await this.read(key))?.value
  }

  async set(key: string, value: unknown): Promise<void> {
    const entry: CacheEntry = { savedAt: this.now(), value }
    await writeFileAtomic(this.file(key), JSON.stringify(entry))
  }

  private file(key: string): string {
    return join(this.dir, `${createHash('sha1').update(key).digest('hex')}.json`)
  }

  private async read(key: string): Promise<CacheEntry | undefined> {
    try {
      return JSON.parse(await readFile(this.file(key), 'utf8')) as CacheEntry
    } catch {
      return undefined
    }
  }
}
