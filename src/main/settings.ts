import { readFile, rename } from 'node:fs/promises'
import { writeFileAtomic } from './util/fs'

export interface AppSettings {
  /** Where backups go; absent means `<dataDir>/backups`. */
  backupsDir?: string
}

/** settings.json: app-wide preferences. Reads are from memory; writes are serialized. */
export class SettingsStore {
  private readonly file: string
  private settings: AppSettings = {}
  private writing: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    try {
      const data = JSON.parse(text) as Record<string, unknown>
      this.settings = typeof data.backupsDir === 'string' ? { backupsDir: data.backupsDir } : {}
    } catch {
      await rename(this.file, `${this.file}.corrupt-${Date.now()}`)
      this.settings = {}
    }
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  /** `null` goes back to the default folder. */
  setBackupsDir(dir: string | null): Promise<void> {
    this.settings = dir === null ? {} : { ...this.settings, backupsDir: dir }
    return this.save()
  }

  private save(): Promise<void> {
    const json = JSON.stringify({ version: 1, ...this.settings }, null, 2)
    this.writing = this.writing.catch(() => {}).then(() => writeFileAtomic(this.file, json))
    return this.writing
  }
}
