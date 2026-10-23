import { readFile, rename } from 'node:fs/promises'
import { writeFileAtomic } from './util/fs'

export interface AppSettings {
  /** Where backups go; absent means `<dataDir>/backups`. */
  backupsDir?: string
  /** Check for, download and install updates in the background; absent means on. */
  autoUpdate?: boolean
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
      const settings: AppSettings = {}
      if (typeof data.backupsDir === 'string') settings.backupsDir = data.backupsDir
      if (typeof data.autoUpdate === 'boolean') settings.autoUpdate = data.autoUpdate
      this.settings = settings
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
    const next = { ...this.settings }
    if (dir === null) delete next.backupsDir
    else next.backupsDir = dir
    this.settings = next
    return this.save()
  }

  setAutoUpdate(on: boolean): Promise<void> {
    this.settings = { ...this.settings, autoUpdate: on }
    return this.save()
  }

  private save(): Promise<void> {
    const json = JSON.stringify({ version: 1, ...this.settings }, null, 2)
    this.writing = this.writing.catch(() => {}).then(() => writeFileAtomic(this.file, json))
    return this.writing
  }
}
